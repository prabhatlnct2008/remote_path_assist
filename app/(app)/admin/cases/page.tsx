import Link from "next/link";
import { PriorityBadge, StatusBadge } from "@/components/case/Badges";
import { getAdminCases } from "@/lib/db/queries/admin";
import { relativeTime } from "@/lib/utils/time";

export default async function AdminCasesPage() {
  const rows = await getAdminCases();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold tracking-tight">All cases (metadata)</h1>
      <p className="text-sm text-muted-foreground">
        Patient content is hidden from administrators. Open a case to assign or
        reassign it.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Case</th>
              <th className="px-4 py-2 font-medium">Priority</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Assigned to</th>
              <th className="px-4 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                <td className="px-4 py-2">
                  <Link href={`/cases/${r.id}`} className="font-mono text-primary hover:underline">
                    {r.caseNumber}
                  </Link>
                </td>
                <td className="px-4 py-2"><PriorityBadge priority={r.priority} /></td>
                <td className="px-4 py-2"><StatusBadge status={r.status} /></td>
                <td className="px-4 py-2">{r.assigneeName ?? "Unassigned"}</td>
                <td className="px-4 py-2 text-muted-foreground">{relativeTime(r.createdAt)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                  No cases yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
