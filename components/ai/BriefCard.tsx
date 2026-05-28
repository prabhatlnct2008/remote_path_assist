import { regenerateBriefForm } from "@/actions/ai";
import { BriefAutoRefresh } from "@/components/ai/BriefAutoRefresh";
import { Markdown } from "@/components/case/Markdown";

export function BriefCard({
  caseId,
  status,
  brief,
}: {
  caseId: string;
  status: "idle" | "generating" | "ready" | "error" | null;
  brief: string | null;
}) {
  return (
    <section className="rounded-lg border border-violet-200 bg-violet-50/40 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-medium text-violet-900">
          AI pre-review brief
          <span className="rounded-full bg-violet-200 px-2 py-0.5 text-xs text-violet-800">
            AI-generated
          </span>
        </h2>
        {(status === "ready" || status === "error" || status === "idle") && (
          <form action={regenerateBriefForm}>
            <input type="hidden" name="caseId" value={caseId} />
            <button className="text-xs text-violet-700 hover:underline">
              {status === "ready" ? "Regenerate" : "Generate"}
            </button>
          </form>
        )}
      </div>

      {status === "generating" && (
        <div className="flex items-center gap-2 text-sm text-violet-700">
          <span className="h-2 w-2 animate-pulse rounded-full bg-violet-500" />
          Brief generating…
          <BriefAutoRefresh />
        </div>
      )}
      {status === "error" && (
        <p className="text-sm text-red-600">Brief generation failed. Try regenerating.</p>
      )}
      {status === "ready" && brief && <Markdown>{brief}</Markdown>}
      {(status === "idle" || status === null) && !brief && (
        <p className="text-sm text-muted-foreground">
          A brief will be generated when the case is assigned.
        </p>
      )}
    </section>
  );
}
