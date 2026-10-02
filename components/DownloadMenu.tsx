"use client";

import { useEffect, useRef, useState } from "react";
import type { Object3D } from "three";

import { slugify } from "@/lib/types";

interface DownloadMenuProps {
  /** The original `.glb` bytes, exactly as the provider produced them. */
  glbBlob: Blob | null;
  /** Loaded three.js scene, used for the derived OBJ/STL exports. */
  scene: Object3D | null;
  /** Prompt the model came from, used for the filename. */
  prompt: string;
}

type Format = "glb" | "obj" | "stl";

const FORMATS: { id: Format; label: string; hint: string }[] = [
  { id: "glb", label: "GLB", hint: "Original file, with materials" },
  { id: "obj", label: "OBJ", hint: "Geometry + UVs, widely supported" },
  { id: "stl", label: "STL", hint: "Binary mesh, for 3D printing" },
];

/** Triggers a browser download for `data` without leaking the object URL. */
function saveBlob(data: Blob, filename: string): void {
  const url = URL.createObjectURL(data);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function DownloadMenu({
  glbBlob,
  scene,
  prompt,
}: DownloadMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const disabled = !glbBlob;
  const slug = slugify(prompt);

  async function download(format: Format) {
    setError(null);
    setBusy(format);
    try {
      if (format === "glb") {
        if (!glbBlob) throw new Error("No model loaded.");
        saveBlob(glbBlob, `model-${slug}.glb`);
      } else {
        if (!scene) throw new Error("The model is still loading.");

        if (format === "obj") {
          // Imported lazily so the exporters stay out of the initial bundle.
          const { OBJExporter } = await import(
            "three/examples/jsm/exporters/OBJExporter.js"
          );
          const text = new OBJExporter().parse(scene);
          saveBlob(
            new Blob([text], { type: "model/obj" }),
            `model-${slug}.obj`,
          );
        } else {
          const { STLExporter } = await import(
            "three/examples/jsm/exporters/STLExporter.js"
          );
          const view = new STLExporter().parse(scene, { binary: true });
          saveBlob(
            new Blob([view], { type: "model/stl" }),
            `model-${slug}.stl`,
          );
        }
      }
      setOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Export failed, please retry.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
          />
        </svg>
        Download
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && !disabled && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-20 mb-2 w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-xl shadow-black/40"
        >
          {FORMATS.map((format) => (
            <button
              key={format.id}
              type="button"
              role="menuitem"
              disabled={busy !== null}
              onClick={() => void download(format.id)}
              className="flex w-full flex-col items-start gap-0.5 border-b border-slate-800 px-3 py-2.5 text-left transition last:border-b-0 hover:bg-slate-800 disabled:opacity-50"
            >
              <span className="flex items-center gap-2 text-sm font-medium text-slate-100">
                {format.label}
                {busy === format.id && (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400" />
                )}
              </span>
              <span className="text-xs text-slate-500">{format.hint}</span>
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
    </div>
  );
}
