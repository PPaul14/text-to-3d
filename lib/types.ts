/** Shared types for the text-to-3D pipeline. */

/** Identifier for the backend that produced a model. */
export type ProviderId = "huggingface" | "meshy";

/** Human-readable provider labels shown in the UI. */
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  huggingface: "Hugging Face",
  meshy: "Meshy AI",
};

/** A successful generation, as returned by `POST /api/generate`. */
export interface GenerateSuccess {
  /** Absolute URL of the generated `.glb`, on the provider's own host. */
  modelUrl: string;
  /** Which backend produced the model. */
  provider: ProviderId;
  /** Specific model/Space that ran, e.g. `hysts/Shap-E`. */
  model: string;
  /**
   * Set when the provider needs polling rather than returning a finished
   * model: the client should poll `GET /api/status?id=&provider=` instead of
   * using `modelUrl`.
   */
  pending?: false;
}

/**
 * A generation that was started but will outrun the serverless time budget.
 * The client polls `/api/status` until it resolves.
 */
export interface GeneratePending {
  pending: true;
  /** Provider-side task id to poll with. */
  taskId: string;
  provider: ProviderId;
  model: string;
}

/** Error envelope used by every API route in this app. */
export interface ApiError {
  error: string;
  /** Optional operator-facing detail; safe to show, never contains secrets. */
  detail?: string;
}

export type GenerateResponse = GenerateSuccess | GeneratePending | ApiError;

/** Status payload from `GET /api/status`. */
export interface StatusResponse {
  status: "pending" | "succeeded" | "failed";
  /** Present once `status === "succeeded"`. */
  modelUrl?: string;
  /** 0-100 when the provider reports it. */
  progress?: number;
  error?: string;
}

/** One entry in the client-side generation history. */
export interface HistoryItem {
  id: string;
  prompt: string;
  modelUrl: string;
  provider: ProviderId;
  model: string;
  createdAt: number;
}

/** What a provider module returns to the `/api/generate` route. */
export type ProviderResult =
  | { kind: "model"; modelUrl: string; model: string }
  | { kind: "task"; taskId: string; model: string };

/** Maximum accepted prompt length, enforced on both client and server. */
export const MAX_PROMPT_LENGTH = 300;

/** Hosts `/api/proxy` is allowed to stream from. */
export const ALLOWED_PROXY_HOSTS = [
  "huggingface.co",
  "hf.space",
  "meshy.ai",
] as const;

/**
 * True when `hostname` is an allowed host or a subdomain of one.
 * Subdomain matching is required because Spaces serve files from
 * `<space>.hf.space` and Meshy from `assets.meshy.ai`.
 */
export function isAllowedProxyHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED_PROXY_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

/** Validation result for a user-supplied prompt. */
export type PromptValidation =
  | { ok: true; prompt: string }
  | { ok: false; error: string };

/** Validates and normalises a prompt. Shared by the route and the form. */
export function validatePrompt(input: unknown): PromptValidation {
  if (typeof input !== "string") {
    return { ok: false, error: "Prompt must be a string." };
  }
  const prompt = input.trim();
  if (prompt.length === 0) {
    return { ok: false, error: "Please describe the object you want to generate." };
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return {
      ok: false,
      error: `Prompt is too long (${prompt.length}/${MAX_PROMPT_LENGTH} characters).`,
    };
  }
  return { ok: true, prompt };
}

/** Filesystem-safe slug used for download filenames. */
export function slugify(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "model";
}
