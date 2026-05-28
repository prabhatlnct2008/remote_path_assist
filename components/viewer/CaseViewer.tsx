"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { Viewer as ViewerType } from "@/components/viewer/Viewer";

// Heavy OSD + Annotorious bundle is loaded only on the viewer route (ssr:false).
const Viewer = dynamic(() => import("@/components/viewer/Viewer").then((m) => m.Viewer), {
  ssr: false,
  loading: () => (
    <div className="flex h-[70vh] w-full items-center justify-center rounded-lg border border-border bg-black/90 text-sm text-white/70">
      Loading viewer…
    </div>
  ),
});

export function CaseViewer(props: ComponentProps<typeof ViewerType>) {
  return <Viewer {...props} />;
}
