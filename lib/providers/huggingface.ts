import { Client } from "@gradio/client";

import type { ProviderResult } from "@/lib/types";

/**
 * Text-to-3D Hugging Face Spaces, tried in order.
 *
 * Each entry's endpoint name and parameter names come from the Space's live
 * Gradio schema, which `node scripts/inspect-space.mjs <id>` prints. The
 * `/text-to-3d` endpoint of `hysts/Shap-E` returns a single Gradio `FileData`
 * for a `Model3d` component, whose `url` points at a `.glb`.
 */
interface SpaceConfig {
  /** `owner/name` of the Space. */
  id: string;
  /** Named Gradio endpoint, including the leading slash. */
  endpoint: string;
  /** Builds the payload, keyed by the Space's declared `parameter_name`s. */
  build: (prompt: string) => Record<string, string | number | boolean>;
}

const SPACES: SpaceConfig[] = [
  {
    id: "hysts/Shap-E",
    endpoint: "/text-to-3d",
    // Schema: prompt (Textbox), seed (Slider, default 0),
    // guidance_scale (Slider, default 15), num_inference_steps (Slider, 64).
    build: (prompt) => ({
      prompt,
      seed: 0,
      guidance_scale: 15,
      num_inference_steps: 64,
    }),
  },
];

/** Gradio's `FileData` payload for file-producing components. */
interface GradioFileData {
  path?: string;
  url?: string | null;
  orig_name?: string | null;
  mime_type?: string | null;
}

function isFileData(value: unknown): value is GradioFileData {
  return (
    typeof value === "object" &&
    value !== null &&
    ("url" in value || "path" in value)
  );
}

/**
 * Pulls the first model URL out of a Gradio result payload.
 *
 * Shap-E returns `[{ url, path, orig_name }]`, but sibling Spaces wrap the
 * file in an array or nest it one level deeper, so this walks the structure
 * instead of assuming `data[0].url`.
 */
export function extractModelUrl(data: unknown, spaceId: string): string | null {
  const queue: unknown[] = [data];
  const origin = spaceOrigin(spaceId);

  while (queue.length > 0) {
    const node = queue.shift();

    if (typeof node === "string") {
      if (/\.(glb|gltf)(\?|$)/i.test(node)) {
        return node.startsWith("http") ? node : toAbsolute(node, origin);
      }
      continue;
    }

    if (Array.isArray(node)) {
      queue.push(...node);
      continue;
    }

    if (isFileData(node)) {
      if (typeof node.url === "string" && node.url.length > 0) {
        return node.url.startsWith("http")
          ? node.url
          : toAbsolute(node.url, origin);
      }
      if (typeof node.path === "string" && node.path.length > 0) {
        // Gradio 5+/6 serve raw server paths under `/gradio_api/file=`.
        return `${origin}/gradio_api/file=${node.path}`;
      }
      continue;
    }

    if (typeof node === "object" && node !== null) {
      queue.push(...Object.values(node));
    }
  }

  return null;
}

/** `owner/name` -> `https://owner-name.hf.space`. */
function spaceOrigin(spaceId: string): string {
  const subdomain = spaceId.replace(/[/_.]/g, "-").toLowerCase();
  return `https://${subdomain}.hf.space`;
}

function toAbsolute(pathOrUrl: string, origin: string): string {
  return `${origin}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

/** Rejects after `ms`, so a sleeping Space cannot hang the request. */
function timeout(ms: number, label: string): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
      ms,
    ).unref?.();
  });
}

/** Turns provider failures into messages that are useful to an end user. */
function describeSpaceError(error: unknown, spaceId: string): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/timed out/i.test(message)) {
    return `${spaceId} did not respond in time (it may be waking up or busy).`;
  }
  if (/queue|full/i.test(message)) {
    return `${spaceId} has a full queue right now.`;
  }
  if (/sleep|paused|503|not running/i.test(message)) {
    return `${spaceId} is asleep or paused.`;
  }
  if (/gpu|quota|exceeded/i.test(message)) {
    return `${spaceId} has exhausted its GPU quota.`;
  }
  if (/401|403|token|authoriz/i.test(message)) {
    return `${spaceId} rejected the credentials (check HF_TOKEN).`;
  }
  if (/fetch failed|network|ENOTFOUND|ECONNRESET|ETIMEDOUT/i.test(message)) {
    return `Could not reach ${spaceId}.`;
  }
  return `${spaceId} failed: ${message}`;
}

/**
 * Generates a model on one Space.
 *
 * `budgetMs` caps both the connect and the predict so the caller keeps enough
 * of the serverless window to try the next provider.
 */
async function generateOnSpace(
  space: SpaceConfig,
  prompt: string,
  budgetMs: number,
): Promise<ProviderResult> {
  const token = process.env.HF_TOKEN?.trim();

  const client = await Promise.race([
    Client.connect(space.id, {
      // The SDK types the token as a template literal `hf_${string}`.
      hf_token: token ? (token as `hf_${string}`) : undefined,
    }),
    timeout(Math.min(budgetMs, 20_000), `Connecting to ${space.id}`),
  ]);

  const result = await Promise.race([
    client.predict(space.endpoint, space.build(prompt)),
    timeout(budgetMs, `Generating on ${space.id}`),
  ]);

  const modelUrl = extractModelUrl(
    (result as { data?: unknown }).data,
    space.id,
  );
  if (!modelUrl) {
    throw new Error("the Space returned no model file");
  }

  return { kind: "model", modelUrl, model: space.id };
}

/**
 * Tries each configured Space in turn.
 *
 * Throws an `Error` whose message lists every attempt, so `/api/generate` can
 * surface something actionable instead of a bare 502.
 */
export async function generateWithHuggingFace(
  prompt: string,
  budgetMs: number,
): Promise<ProviderResult> {
  const failures: string[] = [];
  const deadline = Date.now() + budgetMs;

  // Each Space gets two shots: connecting to a ZeroGPU Space intermittently
  // fails with a bare `fetch failed` that succeeds immediately on retry.
  for (const space of SPACES) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 8_000) {
        failures.push("Ran out of time before all providers were tried.");
        throw new Error(failures.join(" "));
      }

      try {
        return await generateOnSpace(space, prompt, remaining);
      } catch (error) {
        const transient = isTransient(error);
        // Only a transient fault is worth a second attempt; a full queue or an
        // exhausted GPU quota will not clear in a few seconds.
        if (attempt === 2 || !transient) {
          failures.push(describeSpaceError(error, space.id));
          break;
        }
      }
    }
  }

  throw new Error(failures.join(" "));
}

/** Network-level faults that commonly succeed on an immediate retry. */
function isTransient(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|502|504/i.test(
    message,
  );
}

/** Exposed for the README and for `/api/generate`'s diagnostics. */
export const HUGGINGFACE_SPACES = SPACES.map((space) => space.id);
