import type { ProviderResult, StatusResponse } from "@/lib/types";

const MESHY_BASE = "https://api.meshy.ai/openapi/v2/text-to-3d";

/** True when a Meshy key is configured, so the route can skip the provider. */
export function isMeshyConfigured(): boolean {
  return Boolean(process.env.MESHY_API_KEY?.trim());
}

function authHeaders(): HeadersInit {
  const key = process.env.MESHY_API_KEY?.trim();
  if (!key) {
    throw new Error("MESHY_API_KEY is not configured");
  }
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

interface MeshyTaskResponse {
  result?: string;
  id?: string;
  status?: string;
  progress?: number;
  model_urls?: { glb?: string; fbx?: string; obj?: string; usdz?: string };
  task_error?: { message?: string };
  message?: string;
}

/** Starts a preview (geometry-only) text-to-3D task and returns its id. */
export async function startMeshyTask(prompt: string): Promise<string> {
  const response = await fetch(MESHY_BASE, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      mode: "preview",
      prompt,
      art_style: "realistic",
      should_remesh: true,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const payload = (await response.json().catch(() => ({}))) as MeshyTaskResponse;

  if (!response.ok) {
    throw new Error(
      payload.message ??
        `Meshy rejected the request (HTTP ${response.status}).`,
    );
  }

  // v2 returns the new task id in `result`; older payloads used `id`.
  const taskId = payload.result ?? payload.id;
  if (!taskId) {
    throw new Error("Meshy did not return a task id.");
  }
  return taskId;
}

/** Fetches one task's current state. */
export async function getMeshyStatus(taskId: string): Promise<StatusResponse> {
  const response = await fetch(`${MESHY_BASE}/${encodeURIComponent(taskId)}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(20_000),
  });

  const payload = (await response.json().catch(() => ({}))) as MeshyTaskResponse;

  if (!response.ok) {
    return {
      status: "failed",
      error: payload.message ?? `Meshy returned HTTP ${response.status}.`,
    };
  }

  switch (payload.status) {
    case "SUCCEEDED": {
      const modelUrl = payload.model_urls?.glb;
      if (!modelUrl) {
        return { status: "failed", error: "Meshy returned no GLB URL." };
      }
      return { status: "succeeded", modelUrl, progress: 100 };
    }
    case "FAILED":
    case "CANCELED":
      return {
        status: "failed",
        error: payload.task_error?.message ?? "Meshy task failed.",
      };
    default:
      return { status: "pending", progress: payload.progress ?? 0 };
  }
}

/**
 * Starts a task and polls until it finishes or `budgetMs` runs out.
 *
 * Returns `{ kind: "task" }` when the budget expires while the task is still
 * running, so the client can keep polling `/api/status` past the serverless
 * function's own time limit.
 */
export async function generateWithMeshy(
  prompt: string,
  budgetMs: number,
): Promise<ProviderResult> {
  const deadline = Date.now() + budgetMs;
  const taskId = await startMeshyTask(prompt);

  while (Date.now() < deadline - 5_000) {
    await new Promise((resolve) => setTimeout(resolve, 3_000));

    const status = await getMeshyStatus(taskId);
    if (status.status === "succeeded" && status.modelUrl) {
      return { kind: "model", modelUrl: status.modelUrl, model: "meshy-preview" };
    }
    if (status.status === "failed") {
      throw new Error(status.error ?? "Meshy task failed.");
    }
  }

  return { kind: "task", taskId, model: "meshy-preview" };
}
