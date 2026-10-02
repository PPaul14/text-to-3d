"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Object3D } from "three";

import DownloadMenu from "@/components/DownloadMenu";
import PromptForm from "@/components/PromptForm";
import StatusBar, { type Phase } from "@/components/StatusBar";
import {
  PROVIDER_LABELS,
  type GenerateResponse,
  type HistoryItem,
  type ProviderId,
  type StatusResponse,
  validatePrompt,
} from "@/lib/types";

// three.js touches `window` at module scope, so the viewer is client-only.
const ModelViewer = dynamic(() => import("@/components/ModelViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex min-w-0 flex-1 items-center justify-center rounded-xl border border-slate-800 bg-slate-950">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-700 border-t-sky-400" />
    </div>
  ),
});

const MAX_HISTORY = 5;
/** How long the client keeps polling a pending provider task. */
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 3_000;

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [glbBlob, setGlbBlob] = useState<Blob | null>(null);
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [activePrompt, setActivePrompt] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  /** Mirrors the loaded scene into state so DownloadMenu re-renders with it. */
  const [scene, setScene] = useState<Object3D | null>(null);

  /** Guards against a slow in-flight request overwriting a newer one. */
  const runIdRef = useRef(0);
  const blobUrlRef = useRef<string | null>(null);

  // Keep a ref in step with the current blob URL so cleanup never captures a
  // stale value, and revoke the previous URL whenever it changes.
  useEffect(() => {
    const previous = blobUrlRef.current;
    blobUrlRef.current = blobUrl;
    if (previous && previous !== blobUrl) {
      URL.revokeObjectURL(previous);
    }
  }, [blobUrl]);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  const handleSceneReady = useCallback((next: Object3D | null) => {
    setScene(next);
  }, []);

  /** Downloads a provider URL through the proxy and shows it in the viewer. */
  const loadModel = useCallback(
    async (modelUrl: string, runId: number): Promise<void> => {
      setPhase("loading");
      setMessage(null);

      const response = await fetch(
        `/api/proxy?url=${encodeURIComponent(modelUrl)}`,
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? "Could not download the model file.");
      }

      const blob = await response.blob();
      if (runIdRef.current !== runId) return;

      setGlbBlob(blob);
      setBlobUrl(URL.createObjectURL(blob));
      setPhase("ready");
    },
    [],
  );

  /** Polls `/api/status` until the provider task finishes. */
  const pollUntilDone = useCallback(
    async (
      taskId: string,
      pollProvider: ProviderId,
      runId: number,
    ): Promise<string> => {
      const deadline = Date.now() + POLL_TIMEOUT_MS;

      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        if (runIdRef.current !== runId) throw new Error("superseded");

        const response = await fetch(
          `/api/status?id=${encodeURIComponent(taskId)}&provider=${pollProvider}`,
        );
        const status = (await response.json()) as StatusResponse;

        if (status.status === "succeeded" && status.modelUrl) {
          return status.modelUrl;
        }
        if (status.status === "failed") {
          throw new Error(status.error ?? "Generation failed.");
        }
        setMessage(
          typeof status.progress === "number" && status.progress > 0
            ? `${Math.round(status.progress)}% complete`
            : "Still working...",
        );
      }

      throw new Error("Generation timed out. Please try again.");
    },
    [],
  );

  const generate = useCallback(
    async (rawPrompt: string) => {
      const validation = validatePrompt(rawPrompt);
      if (!validation.ok) {
        setPhase("error");
        setError(validation.error);
        setDetail(null);
        return;
      }

      const runId = ++runIdRef.current;
      const started = Date.now();

      setPhase("generating");
      setError(null);
      setDetail(null);
      setMessage(null);
      setActivePrompt(validation.prompt);

      // Surface elapsed time so a slow Space does not look frozen.
      const ticker = setInterval(() => {
        if (runIdRef.current !== runId) return;
        setMessage(`${Math.round((Date.now() - started) / 1000)}s elapsed`);
      }, 1_000);

      try {
        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: validation.prompt }),
        });

        const payload = (await response.json()) as GenerateResponse;
        if (runIdRef.current !== runId) return;

        if (!response.ok || "error" in payload) {
          const apiError =
            "error" in payload ? payload : { error: "Generation failed." };
          throw Object.assign(new Error(apiError.error), {
            detail: "detail" in apiError ? apiError.detail : undefined,
          });
        }

        let modelUrl: string;
        if ("pending" in payload && payload.pending) {
          setProvider(payload.provider);
          setModel(payload.model);
          modelUrl = await pollUntilDone(
            payload.taskId,
            payload.provider,
            runId,
          );
        } else {
          setProvider(payload.provider);
          setModel(payload.model);
          modelUrl = payload.modelUrl;
        }

        await loadModel(modelUrl, runId);
        if (runIdRef.current !== runId) return;

        const usedProvider: ProviderId =
          "provider" in payload ? payload.provider : "huggingface";
        const usedModel = "model" in payload ? payload.model : "";

        setHistory((previous) => {
          const entry: HistoryItem = {
            id: `${runId}-${Date.now()}`,
            prompt: validation.prompt,
            modelUrl,
            provider: usedProvider,
            model: usedModel,
            createdAt: Date.now(),
          };
          return [entry, ...previous].slice(0, MAX_HISTORY);
        });
      } catch (cause) {
        if (runIdRef.current !== runId) return;
        if (cause instanceof Error && cause.message === "superseded") return;

        setPhase("error");
        setError(
          cause instanceof Error
            ? cause.message
            : "Something went wrong. Please try again.",
        );
        setDetail(
          cause instanceof Error && "detail" in cause
            ? ((cause as { detail?: string }).detail ?? null)
            : null,
        );
      } finally {
        clearInterval(ticker);
      }
    },
    [loadModel, pollUntilDone],
  );

  /** Re-opens a model from history without re-running generation. */
  const replay = useCallback(
    async (item: HistoryItem) => {
      const runId = ++runIdRef.current;
      setActivePrompt(item.prompt);
      setProvider(item.provider);
      setModel(item.model);
      setError(null);
      setDetail(null);

      try {
        await loadModel(item.modelUrl, runId);
      } catch (cause) {
        if (runIdRef.current !== runId) return;
        setPhase("error");
        setError(
          cause instanceof Error
            ? `${cause.message} The provider may have already deleted this file.`
            : "Could not reload that model.",
        );
      }
    },
    [loadModel],
  );

  const isGenerating = phase === "generating" || phase === "loading";

  return (
    <div className="flex min-h-dvh flex-col bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3.5 sm:px-6">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 text-sm font-bold">
            3D
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-tight">
              Text-to-3D Studio
            </h1>
            <p className="hidden text-xs text-slate-500 sm:block">
              Describe an object, get an interactive 3D model
            </p>
          </div>
          <a
            href="https://huggingface.co/spaces/hysts/Shap-E"
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto hidden rounded-md border border-slate-800 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-slate-600 hover:text-slate-200 sm:block"
          >
            Powered by Shap-E
          </a>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-4 sm:px-6 lg:flex-row lg:gap-6">
        <aside className="flex w-full flex-col gap-4 lg:w-80 lg:shrink-0">
          <PromptForm
            prompt={prompt}
            onPromptChange={setPrompt}
            onSubmit={() => void generate(prompt)}
            isGenerating={isGenerating}
          />

          <StatusBar
            phase={phase}
            message={message}
            error={error}
            detail={detail}
            provider={provider}
            model={model}
          />

          <DownloadMenu
            glbBlob={glbBlob}
            scene={scene}
            prompt={activePrompt}
          />

          {history.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Recent generations
              </h2>
              <ul className="flex flex-col gap-1.5">
                {history.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => void replay(item)}
                      disabled={isGenerating}
                      className="group flex w-full items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-2 text-left transition hover:border-slate-600 disabled:opacity-50"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        className="h-3.5 w-3.5 shrink-0 text-slate-600 group-hover:text-sky-400"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4"
                        />
                      </svg>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-slate-200">
                          {item.prompt}
                        </span>
                        <span className="block text-[10px] text-slate-600">
                          {PROVIDER_LABELS[item.provider]}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>

        {/*
          `flex` matters here: the viewer fills its parent with `h-full`, and a
          percentage height cannot resolve against a parent that only has a
          `min-height`. Making this a flex container stretches the child to the
          full 60vh instead of letting it collapse to the canvas's intrinsic size.
        */}
        <section className="flex min-h-[60vh] flex-1 lg:min-h-0">
          <ModelViewer src={blobUrl} onSceneReady={handleSceneReady} />
        </section>
      </main>
    </div>
  );
}
