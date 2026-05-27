import Link from "next/link";
import { PriorityBadge, StatusBadge } from "@/components/case/Badges";
import { currentUser } from "@/lib/auth/guards";
import { getWorklist } from "@/lib/db/queries/cases";
import { relativeTime, slaLabel } from "@/lib/utils/time";

const EMPTY_STATE: Record<string, { title: string; cta: boolean }> = {
  requester: { title: "You haven't created any cases yet.", cta: true },
  consultant: { title: "No cases assigned to you yet.", cta: false },
  admin: { title: "No cases in the system yet.", cta: true },
};

export default async function WorklistPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; priority?: string; needs?: string }>;
}) {
  const user = await currentUser();
  // Layout guarantees an active, named user; narrow for type-safety.
  if (!user) return null;

  const sp = await searchParams;
  const filters = {
    search: sp.q,
    statuses: sp.status ? sp.status.split(",") : undefined,
    priorities: sp.priority ? sp.priority.split(",") : undefined,
    needsMore: sp.needs === "1",
  };
  const rows = await getWorklist(user.id, user.role, filters);
  const empty = EMPTY_STATE[user.role];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Worklist</h1>
        {(user.role === "requester" || user.role === "admin") && (
          <Link
            href="/cases/new"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            New case
          </Link>
        )}
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Search</label>
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder={user.role === "admin" ? "Case number or MRN" : "Case number"}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Status</label>
          <select name="status" defaultValue={sp.status ?? ""} className="rounded-md border border-border bg-background px-3 py-1.5 text-sm">
            <option value="">All</option>
            <option value="submitted">Submitted</option>
            <option value="assigned">Assigned</option>
            <option value="in_review">In review</option>
            <option value="reported">Reported</option>
            <option value="signed_out">Signed out</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Priority</label>
          <select name="priority" defaultValue={sp.priority ?? ""} className="rounded-md border border-border bg-background px-3 py-1.5 text-sm">
            <option value="">All</option>
            <option value="stat">STAT</option>
            <option value="urgent">Urgent</option>
            <option value="routine">Routine</option>
          </select>
        </div>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="needs" value="1" defaultChecked={sp.needs === "1"} />
          Needs material
        </label>
        <button className="rounded-md border border-border px-4 py-1.5 text-sm hover:bg-muted">
          Apply
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">{empty.title}</p>
          {empty.cta && (
            <Link href="/cases/new" className="text-sm text-primary hover:underline">
              Create your first case
            </Link>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Case</th>
                <th className="px-4 py-2 font-medium">Age/Sex</th>
                <th className="px-4 py-2 font-medium">Specimen</th>
                <th className="px-4 py-2 font-medium">Priority</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">SLA</th>
                <th className="px-4 py-2 font-medium">Created</th>
                <th className="px-4 py-2 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const sla = r.slaDueAt ? slaLabel(r.slaDueAt) : null;
                return (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-2">
                      <Link href={`/cases/${r.id}`} className="font-mono text-primary hover:underline">
                        {r.caseNumber}
                      </Link>
                      {r.needsMoreMaterial && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                          needs material
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {r.age}/{r.sex}
                    </td>
                    <td className="px-4 py-2">{r.specimenType.replace(/_/g, " ")}</td>
                    <td className="px-4 py-2">
                      <PriorityBadge priority={r.priority} />
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-2">
                      {sla ? (
                        <span className={sla.breached ? "text-red-600" : "text-muted-foreground"}>
                          {sla.text}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{relativeTime(r.createdAt)}</td>
                    <td className="px-4 py-2 text-muted-foreground">{relativeTime(r.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
