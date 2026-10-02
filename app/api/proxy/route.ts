import type { NextRequest } from "next/server";

import { isAllowedProxyHost } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Refuse absurdly large responses rather than streaming them to the browser. */
const MAX_BYTES = 100 * 1024 * 1024;

function error(message: string, status: number): Response {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Streams a generated model file back to the browser.
 *
 * Provider hosts do not send permissive CORS headers, so the viewer cannot
 * fetch them directly. This route re-serves the bytes same-origin. Only the
 * provider hosts in `ALLOWED_PROXY_HOSTS` are reachable, which keeps the route
 * from being used as an open proxy / SSRF pivot.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const target = request.nextUrl.searchParams.get("url");
  if (!target) {
    return error("Missing `url` query parameter.", 400);
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return error("`url` is not a valid URL.", 400);
  }

  if (parsed.protocol !== "https:") {
    return error("Only https URLs may be proxied.", 400);
  }

  if (!isAllowedProxyHost(parsed.hostname)) {
    return error(`Host "${parsed.hostname}" is not allowed.`, 403);
  }

  let upstream: Response;
  try {
    upstream = await fetch(parsed.toString(), {
      headers: {
        // Gated Space files need the token; it never reaches the client.
        ...(process.env.HF_TOKEN?.trim() && parsed.hostname.endsWith("hf.space")
          ? { Authorization: `Bearer ${process.env.HF_TOKEN.trim()}` }
          : {}),
        Accept: "*/*",
      },
      signal: AbortSignal.timeout(45_000),
      redirect: "follow",
    });
  } catch (cause) {
    const message =
      cause instanceof Error && /timed out|abort/i.test(cause.message)
        ? "The model file took too long to download."
        : "Could not download the model file.";
    return error(message, 502);
  }

  if (!upstream.ok || !upstream.body) {
    return error(
      `Upstream returned HTTP ${upstream.status} for the model file.`,
      502,
    );
  }

  const length = Number(upstream.headers.get("content-length") ?? "0");
  if (length > MAX_BYTES) {
    return error("The model file is too large to proxy.", 413);
  }

  const filename = parsed.pathname.split("/").pop() || "model.glb";
  const headers = new Headers({
    // `.glb` files are glTF binary; the providers often send octet-stream.
    "Content-Type": /\.gltf$/i.test(filename)
      ? "model/gltf+json"
      : "model/gltf-binary",
    "Content-Disposition": `inline; filename="${filename.replace(/"/g, "")}"`,
    // Immutable provider URLs, so let the browser keep them for an hour.
    "Cache-Control": "public, max-age=3600",
    "Access-Control-Allow-Origin": "*",
  });
  const upstreamLength = upstream.headers.get("content-length");
  if (upstreamLength) {
    headers.set("Content-Length", upstreamLength);
  }

  return new Response(upstream.body, { status: 200, headers });
}
