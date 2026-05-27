import Link from "next/link";
import { currentUser } from "@/lib/auth/guards";
import { getWorklist } from "@/lib/db/queries/cases";

const EMPTY_STATE: Record<string, { title: string; cta: boolean }> = {
  requester: { title: "You haven't created any cases yet.", cta: true },
  consultant: { title: "No cases assigned to you yet.", cta: false },
  admin: { title: "No cases in the system yet.", cta: true },
};

export default async function WorklistPage() {
  const user = await currentUser();
  // Layout guarantees an active, named user; narrow for type-safety.
  if (!user) return null;

  const rows = await getWorklist(user.id, user.role);
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
        <p className="text-sm text-muted-foreground">{rows.length} case(s).</p>
      )}
    </div>
  );
}
