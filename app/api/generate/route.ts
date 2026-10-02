import type { NextRequest } from "next/server";

import {
  generateWithHuggingFace,
  HUGGINGFACE_SPACES,
} from "@/lib/providers/huggingface";
import { generateWithMeshy, isMeshyConfigured } from "@/lib/providers/meshy";
import {
  type GenerateResponse,
  type ProviderId,
  validatePrompt,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Wall-clock budget for the whole handler, kept under `maxDuration` so the
 * route always returns a JSON error instead of being killed mid-flight by the
 * platform.
 */
const TOTAL_BUDGET_MS = 55_000;
/** Reserved for the Hugging Face Spaces before Meshy gets the remainder. */
const HUGGINGFACE_BUDGET_MS = 40_000;

function json(body: GenerateResponse, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  const started = Date.now();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Request body must be JSON." }, 400);
  }

  const prompt = (body as { prompt?: unknown } | null)?.prompt;
  const validation = validatePrompt(prompt);
  if (!validation.ok) {
    return json({ error: validation.error }, 400);
  }

  const failures: string[] = [];

  // 1. Hugging Face Spaces (free, no key required for public Spaces).
  try {
    const result = await generateWithHuggingFace(
      validation.prompt,
      Math.min(HUGGINGFACE_BUDGET_MS, TOTAL_BUDGET_MS - (Date.now() - started)),
    );
    if (result.kind === "model") {
      return json(
        {
          modelUrl: result.modelUrl,
          provider: "huggingface" satisfies ProviderId,
          model: result.model,
          pending: false,
        },
        200,
      );
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  // 2. Meshy, only when a key is present.
  if (isMeshyConfigured()) {
    const remaining = TOTAL_BUDGET_MS - (Date.now() - started);
    try {
      const result = await generateWithMeshy(validation.prompt, remaining);
      if (result.kind === "model") {
        return json(
          {
            modelUrl: result.modelUrl,
            provider: "meshy" satisfies ProviderId,
            model: result.model,
            pending: false,
          },
          200,
        );
      }
      // Still running: hand the task to the client to poll.
      return json(
        {
          pending: true,
          taskId: result.taskId,
          provider: "meshy" satisfies ProviderId,
          model: result.model,
        },
        200,
      );
    } catch (error) {
      failures.push(
        `Meshy: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    failures.push(
      "Meshy was skipped because MESHY_API_KEY is not set.",
    );
  }

  return json(
    {
      error:
        "Could not generate a 3D model right now. The free Hugging Face Space may be asleep, busy, or out of GPU quota — please try again in a moment.",
      detail: failures.join(" "),
    },
    502,
  );
}

/** Lightweight health/diagnostics view, handy after deploying. */
export async function GET(): Promise<Response> {
  return Response.json(
    {
      ok: true,
      spaces: HUGGINGFACE_SPACES,
      hfTokenConfigured: Boolean(process.env.HF_TOKEN?.trim()),
      meshyConfigured: isMeshyConfigured(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
