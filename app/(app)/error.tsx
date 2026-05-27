"use client";

import Link from "next/link";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-24 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        Couldn&apos;t load this page. You can retry, or head back to the worklist.
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white"
        >
          Retry
        </button>
        <Link href="/cases" className="rounded-md border border-border px-4 py-2 text-sm">
          Back to worklist
        </Link>
      </div>
    </div>
  );
}
