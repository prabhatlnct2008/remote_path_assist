"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Polls for brief completion while it's generating (PRODUCT §10.1). */
export function BriefAutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}
