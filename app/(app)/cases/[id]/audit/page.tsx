import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/guards";
import { verifyChain } from "@/lib/audit/verify";
import { db } from "@/lib/db/client";
import { caseEvents, users } from "@/lib/db/schema";
import { getCaseView } from "@/lib/db/queries/cases";
import { relativeTime } from "@/lib/utils/time";

export default async function AuditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect("/login");

  // Requester (own), consultant (assigned), and admin may view the trail (§13).
  const view = await getCaseView(user, id);
  if (!view) notFound();

  const events = await db
    .select({
      id: caseEvents.id,
      actorKind: caseEvents.actorKind,
      actorName: users.name,
      eventType: caseEvents.eventType,
      occurredAt: caseEvents.occurredAt,
      hash: caseEvents.hash,
    })
    .from(caseEvents)
    .leftJoin(users, eq(users.id, caseEvents.actorId))
    .where(eq(caseEvents.caseId, id))
    .orderBy(asc(caseEvents.occurredAt), asc(caseEvents.id));

  const result = await verifyChain(id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-mono text-lg font-semibold">{view.case.caseNumber} · Audit trail</h1>
        <Link href={`/cases/${id}`} className="text-sm text-primary hover:underline">
          ← Back to case
        </Link>
      </div>

      <div
        className={`rounded-md px-4 py-3 text-sm ${
          result.valid ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"
        }`}
      >
        {result.valid
          ? `✓ Chain verified — ${result.eventCount} events, intact.`
          : `✗ Chain verification failed at event ${result.firstBreakAt}.`}
      </div>

      <ol className="flex flex-col gap-2">
        {events.map((e, i) => {
          // Valid up to this point if the overall chain is valid, or the break
          // is at a later event than this one.
          const okUpToHere =
            result.valid || (result.firstBreakAt ? e.id !== result.firstBreakAt && i < eventsBreakIndex(events, result.firstBreakAt) : true);
          return (
            <li key={e.id} className="flex items-center gap-3 rounded-md border border-border px-4 py-2 text-sm">
              <span className={okUpToHere ? "text-green-600" : "text-red-600"}>
                {okUpToHere ? "✓" : "✗"}
              </span>
              <span className="font-mono text-xs">{e.eventType}</span>
              <span className="text-muted-foreground">
                {e.actorKind === "ai" ? "AI" : e.actorKind === "system" ? "system" : e.actorName ?? "user"}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">{relativeTime(e.occurredAt)}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{e.hash.slice(0, 12)}…</span>
            </li>
          );
        })}
        {events.length === 0 && (
          <li className="text-sm text-muted-foreground">No events recorded.</li>
        )}
      </ol>
    </div>
  );
}

function eventsBreakIndex(events: { id: string }[], breakId: string): number {
  const idx = events.findIndex((e) => e.id === breakId);
  return idx === -1 ? events.length : idx;
}
