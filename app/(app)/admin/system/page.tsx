import { getSystemStats } from "@/lib/db/queries/admin";
import { formatBytes, relativeTime } from "@/lib/utils/time";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

export default async function AdminSystemPage() {
  const s = await getSystemStats();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold tracking-tight">System</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Active sessions" value={s.activeSessions} />
        <Stat label="Image storage" value={formatBytes(s.storageBytes)} />
        <Stat label="AI events (month)" value={s.aiEventsThisMonth} />
        <Stat label="Est. AI cost (month)" value={`$${s.estimatedAiCostUsd}`} />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Cases by status</h2>
        <div className="flex flex-wrap gap-3">
          {s.casesByStatus.map((c) => (
            <div key={c.status} className="rounded-md border border-border px-3 py-2 text-sm">
              <span className="font-medium">{c.n}</span>{" "}
              <span className="text-muted-foreground">{c.status}</span>
            </div>
          ))}
          {s.casesByStatus.length === 0 && (
            <span className="text-sm text-muted-foreground">No cases.</span>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">
          Recent errors (failed AI / signout locks)
        </h2>
        {s.recentErrors.length === 0 ? (
          <p className="text-sm text-muted-foreground">None recorded.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {s.recentErrors.map((e, i) => (
              <li key={i} className="flex justify-between rounded-md border border-border px-3 py-1.5">
                <span className="font-mono text-xs">{e.eventType}</span>
                <span className="text-muted-foreground">{relativeTime(e.occurredAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
