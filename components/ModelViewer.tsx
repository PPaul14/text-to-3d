"use client";

import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls, Stage, useGLTF, useProgress } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Mesh, MeshStandardMaterial, type Object3D } from "three";

interface ModelViewerProps {
  /** Same-origin blob URL for the `.glb`, or `null` before the first model. */
  src: string | null;
  /** Receives the loaded three.js scene so exporters can read it. */
  onSceneReady: (scene: Object3D | null) => void;
}

/**
 * Makes a generated mesh renderable.
 *
 * Shap-E exports a point-cloud-derived mesh with two quirks that make it
 * invisible in a standard PBR setup, both fixed here:
 *
 *  - **No vertex normals.** Without them a `MeshStandardMaterial` has no
 *    surface orientation to light, so the mesh renders black.
 *  - **`metalness: 1, roughness: 1`.** A fully metallic surface has no diffuse
 *    response, so it only shows a blurred environment reflection — which is
 *    near black against a dark background.
 *
 * Both are corrected only for untextured, vertex-coloured meshes, so a
 * properly authored model (e.g. from Meshy) keeps its own materials.
 */
function prepareScene(root: Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;

    child.castShadow = true;
    child.receiveShadow = true;

    if (!child.geometry.getAttribute("normal")) {
      child.geometry.computeVertexNormals();
    }

    const material = child.material;
    if (Array.isArray(material) || !(material instanceof MeshStandardMaterial)) {
      return;
    }

    const isUntexturedVertexColored =
      material.vertexColors && !material.map && !material.metalnessMap;

    if (isUntexturedVertexColored && material.metalness === 1) {
      // Keep a trace of sheen, but let the vertex colours drive the look.
      material.metalness = 0.05;
      material.roughness = 0.75;
      material.needsUpdate = true;
    }
  });
}

/** Loads the glTF and hands its scene up for exporting. */
function Model({
  src,
  onSceneReady,
}: {
  src: string;
  onSceneReady: (scene: Object3D | null) => void;
}) {
  const { scene } = useGLTF(src);

  // Clone so repeated mounts never reparent or re-edit the cached original.
  const object = useMemo(() => {
    const clone = scene.clone(true);
    prepareScene(clone);
    return clone;
  }, [scene]);

  // Each generation gets a fresh blob URL, so drei would otherwise cache every
  // model for the lifetime of the tab.
  useEffect(() => {
    return () => {
      useGLTF.clear(src);
    };
  }, [src]);

  useEffect(() => {
    onSceneReady(object);
    return () => onSceneReady(null);
  }, [object, onSceneReady]);

  return <primitive object={object} />;
}

/**
 * Progress overlay, rendered as plain DOM rather than drei's `<Html>`.
 *
 * `<Html>` mounts a second React root inside the canvas, which React 19 warns
 * about when it unmounts mid-render as the Suspense boundary resolves.
 */
function LoadingOverlay() {
  const { active, progress } = useProgress();
  if (!active) return null;

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/60">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-sky-400" />
      <p className="text-xs font-medium tabular-nums text-slate-300">
        Loading model {Math.round(progress)}%
      </p>
    </div>
  );
}

/** Empty state shown before the first successful generation. */
function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-12 w-12 text-slate-700"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 3 3 7.5v9L12 21l9-4.5v-9L12 3Zm0 0v18m9-13.5-9 4.5-9-4.5"
        />
      </svg>
      <p className="text-sm font-medium text-slate-400">
        Your 3D model will appear here
      </p>
      <p className="max-w-xs text-xs text-slate-600">
        Describe an object on the left and press Generate.
      </p>
    </div>
  );
}

export default function ModelViewer({ src, onSceneReady }: ModelViewerProps) {
  const [autoRotate, setAutoRotate] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  /** Bumped to remount <Stage>, which re-frames the camera on the model. */
  const [resetKey, setResetKey] = useState(0);

  // Keying on `src` as well means a new model re-frames the camera on mount,
  // without an effect that would cascade an extra render.
  const stageKey = `${src ?? "none"}:${resetKey}`;

  return (
    <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
      {src ? (
        <>
          <Canvas
            // "percentage" maps to PCFShadowMap; three removed PCFSoftShadowMap,
            // which is what the bare `shadows` default would request.
            shadows="percentage"
            dpr={[1, 2]}
            camera={{ position: [0, 0.8, 4], fov: 45 }}
            gl={{ preserveDrawingBuffer: true }}
          >
            <color attach="background" args={["#020617"]} />

            {/*
              Lighting is self-contained: drei's `environment` presets stream an
              HDR from a third-party CDN, which would leave models unlit on any
              network that blocks it.
            */}
            <hemisphereLight args={["#bcd4ff", "#1e293b", 1.1]} />
            <directionalLight position={[4, 6, 3]} intensity={1.6} castShadow />
            <directionalLight position={[-5, 2, -3]} intensity={0.5} />

            <Suspense fallback={null}>
              <Stage
                key={stageKey}
                intensity={0.35}
                environment={null}
                shadows={{ type: "contact", opacity: 0.55, blur: 2.5 }}
                adjustCamera={1.1}
              >
                <Model src={src} onSceneReady={onSceneReady} />
              </Stage>
            </Suspense>

            {showGrid && (
              <Grid
                position={[0, -0.01, 0]}
                args={[20, 20]}
                cellSize={0.5}
                cellThickness={0.6}
                cellColor="#1e293b"
                sectionSize={2.5}
                sectionThickness={1}
                sectionColor="#334155"
                fadeDistance={26}
                fadeStrength={1.2}
                infiniteGrid
                followCamera={false}
              />
            )}

            <OrbitControls
              makeDefault
              enableZoom
              enableRotate
              enablePan
              autoRotate={autoRotate}
              autoRotateSpeed={1.1}
              minDistance={0.5}
              maxDistance={40}
              // three's defaults map one finger to orbit and two to pinch-zoom
              // and pan, which is the desired touch behaviour.
            />
          </Canvas>

          <LoadingOverlay />
        </>
      ) : (
        <EmptyState />
      )}

      {src && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-2 p-3">
          <p className="hidden rounded-md bg-slate-900/70 px-2 py-1 text-[11px] text-slate-400 backdrop-blur sm:block">
            Drag to rotate &middot; scroll to zoom &middot; right-drag to pan
          </p>
          <div className="pointer-events-auto ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => setShowGrid((value) => !value)}
              aria-pressed={showGrid}
              className="rounded-md border border-slate-700 bg-slate-900/80 px-2.5 py-1.5 text-xs font-medium text-slate-300 backdrop-blur transition hover:border-slate-500 hover:text-white"
            >
              Grid: {showGrid ? "on" : "off"}
            </button>
            <button
              type="button"
              onClick={() => setAutoRotate((value) => !value)}
              aria-pressed={autoRotate}
              className="rounded-md border border-slate-700 bg-slate-900/80 px-2.5 py-1.5 text-xs font-medium text-slate-300 backdrop-blur transition hover:border-slate-500 hover:text-white"
            >
              Auto-rotate: {autoRotate ? "on" : "off"}
            </button>
            <button
              type="button"
              onClick={() => setResetKey((key) => key + 1)}
              className="rounded-md border border-slate-700 bg-slate-900/80 px-2.5 py-1.5 text-xs font-medium text-slate-300 backdrop-blur transition hover:border-slate-500 hover:text-white"
            >
              Reset view
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
