"use client";

import "@annotorious/openseadragon/annotorious-openseadragon.css";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createAnnotation,
  deleteAnnotation,
  updateAnnotation,
} from "@/actions/annotations";
import { ANNOTATION_COLORS } from "@/lib/constants";
import type { AnnotationRow } from "@/lib/db/queries/annotations";

export interface ViewerImage {
  id: string;
  url: string;
  filename: string;
}

type Tool = "move" | "rectangle" | "polygon";

/**
 * OpenSeadragon viewer + Annotorious overlay (PRODUCT §5.4, §6). OSD and
 * Annotorious are imported lazily inside the effect so they stay out of the
 * route's initial bundle. Annotation create/update/delete are persisted via
 * Server Actions; an id map links Annotorious ids to our DB rows.
 *
 * NOTE: drawing/zoom interactions are not verifiable in this headless build
 * environment; the wiring follows the documented OSD/Annotorious APIs.
 */
export function Viewer({
  images,
  initialIndex,
  annotationsByImage,
  canAnnotate,
}: {
  images: ViewerImage[];
  initialIndex: number;
  annotationsByImage: Record<string, AnnotationRow[]>;
  canAnnotate: boolean;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const annoRef = useRef<any>(null);
  const idMap = useRef<Map<string, string>>(new Map()); // annotoriousId -> dbId
  const [index, setIndex] = useState(initialIndex);
  const [tool, setTool] = useState<Tool>("move");
  const [color, setColor] = useState<(typeof ANNOTATION_COLORS)[number]>(ANNOTATION_COLORS[0]);
  const [visible, setVisible] = useState(true);

  const current = images[index];

  // (Re)initialize OSD + Annotorious when the current image changes.
  useEffect(() => {
    let destroyed = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let viewer: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let anno: any;

    (async () => {
      const OpenSeadragon = (await import("openseadragon")).default;
      const { createOSDAnnotator } = await import("@annotorious/openseadragon");
      if (destroyed || !containerRef.current) return;

      viewer = OpenSeadragon({
        element: containerRef.current,
        tileSources: { type: "image", url: current.url },
        showNavigationControl: false,
        gestureSettingsMouse: { clickToZoom: false },
        crossOriginPolicy: "Anonymous",
      });
      viewerRef.current = viewer;

      anno = createOSDAnnotator(viewer);
      annoRef.current = anno;

      const rows = annotationsByImage[current.id] ?? [];
      idMap.current = new Map();
      const loaded = rows
        .map((r) => {
          try {
            const a = JSON.parse(r.geometryJson);
            if (a?.id) idMap.current.set(a.id, r.id);
            return a;
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      anno.setAnnotations(loaded);

      if (canAnnotate) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        anno.on("createAnnotation", async (a: any) => {
          const res = await createAnnotation({
            imageId: current.id,
            geometryJson: JSON.stringify(a),
            color,
          });
          if (res.ok) {
            idMap.current.set(a.id, res.data.id);
            router.refresh();
          }
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        anno.on("updateAnnotation", async (a: any) => {
          const dbId = idMap.current.get(a.id);
          if (dbId) await updateAnnotation({ id: dbId, geometryJson: JSON.stringify(a) });
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        anno.on("deleteAnnotation", async (a: any) => {
          const dbId = idMap.current.get(a.id);
          if (dbId) {
            await deleteAnnotation({ id: dbId });
            idMap.current.delete(a.id);
            router.refresh();
          }
        });
      }
    })();

    return () => {
      destroyed = true;
      try {
        anno?.destroy();
      } catch {}
      try {
        viewer?.destroy();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.id]);

  // Apply tool / visibility changes.
  useEffect(() => {
    const anno = annoRef.current;
    if (!anno) return;
    if (tool === "move") anno.setDrawingEnabled?.(false);
    else {
      anno.setDrawingEnabled?.(true);
      anno.setDrawingTool?.(tool);
    }
  }, [tool]);

  useEffect(() => {
    annoRef.current?.setVisible?.(visible);
  }, [visible]);

  // Keyboard shortcuts (PRODUCT §5.4).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const v = viewerRef.current;
      switch (e.key.toLowerCase()) {
        case "f":
        case "r":
          v?.viewport?.goHome();
          break;
        case "[":
          setIndex((i) => Math.max(0, i - 1));
          break;
        case "]":
          setIndex((i) => Math.min(images.length - 1, i + 1));
          break;
        case "a":
          setVisible((s) => !s);
          break;
        case "+":
        case "=":
          v?.viewport?.zoomBy(1.2);
          v?.viewport?.applyConstraints();
          break;
        case "-":
          v?.viewport?.zoomBy(0.8);
          v?.viewport?.applyConstraints();
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [images.length]);

  const btn = "rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted";
  const active = "bg-primary text-white border-primary";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {current.filename} ({index + 1}/{images.length})
        </span>
        <span className="mx-2 h-4 w-px bg-border" />
        <button className={btn} onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
          ‹ Prev
        </button>
        <button
          className={btn}
          onClick={() => setIndex((i) => Math.min(images.length - 1, i + 1))}
          disabled={index === images.length - 1}
        >
          Next ›
        </button>
        <button className={btn} onClick={() => viewerRef.current?.viewport?.goHome()}>
          Fit (F)
        </button>
        <button className={btn} onClick={() => setVisible((s) => !s)}>
          {visible ? "Hide" : "Show"} annotations (A)
        </button>
        {canAnnotate && (
          <>
            <span className="mx-2 h-4 w-px bg-border" />
            <button className={`${btn} ${tool === "move" ? active : ""}`} onClick={() => setTool("move")}>
              Move
            </button>
            <button
              className={`${btn} ${tool === "rectangle" ? active : ""}`}
              onClick={() => setTool("rectangle")}
            >
              Rectangle
            </button>
            <button
              className={`${btn} ${tool === "polygon" ? active : ""}`}
              onClick={() => setTool("polygon")}
            >
              Polygon
            </button>
            <div className="flex items-center gap-1">
              {ANNOTATION_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  aria-label={`color ${c}`}
                  className={`h-5 w-5 rounded-full border ${color === c ? "ring-2 ring-offset-1" : ""}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </>
        )}
      </div>
      <div
        ref={containerRef}
        className="h-[70vh] w-full rounded-lg border border-border bg-black"
      />
    </div>
  );
}
