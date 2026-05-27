import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-6 text-center">
      <span className="rounded-full border border-border px-3 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        AIIMS Delhi · Pathology
      </span>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        PathConsult
      </h1>
      <p className="max-w-prose text-balance text-muted-foreground">
        A remote pathology consultation platform. Residents submit cases with
        slide images and clinical context; consultants review, annotate, and
        sign out reports — with an AI co-pilot that never makes the diagnosis.
      </p>
      <Link
        href="/login"
        className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        Sign in
      </Link>
    </main>
  );
}
