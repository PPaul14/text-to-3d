import type { NextRequest } from "next/server";

import { getMeshyStatus, isMeshyConfigured } from "@/lib/providers/meshy";
import type { StatusResponse } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Polled by the client for providers whose jobs outlive a single serverless
 * invocation. Only Meshy needs this today; the Spaces return inline.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const id = request.nextUrl.searchParams.get("id");
  const provider = request.nextUrl.searchParams.get("provider") ?? "meshy";

  if (!id) {
    return Response.json(
      { status: "failed", error: "Missing `id` query parameter." } satisfies StatusResponse,
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (provider !== "meshy") {
    return Response.json(
      {
        status: "failed",
        error: `Provider "${provider}" does not support polling.`,
      } satisfies StatusResponse,
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!isMeshyConfigured()) {
    return Response.json(
      { status: "failed", error: "MESHY_API_KEY is not configured." } satisfies StatusResponse,
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const status = await getMeshyStatus(id);
    return Response.json(status satisfies StatusResponse, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        status: "failed",
        error: error instanceof Error ? error.message : "Status check failed.",
      } satisfies StatusResponse,
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
