import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ReportEditor } from "@/components/report/ReportEditor";
import { Markdown } from "@/components/case/Markdown";
import { currentUser } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getCaseView } from "@/lib/db/queries/cases";
import { getLatestReport } from "@/lib/db/queries/reports";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect("/login");

  const view = await getCaseView(user, id);
  if (!view) notFound();
  const c = view.case;

  // Only the assigned consultant edits the report (PRODUCT §9.2/§13).
  const isAssignedConsultant = user.role === "consultant" && c.assignedTo === user.id;
  if (!isAssignedConsultant) notFound();

  const report = await getLatestReport(id);
  const me = await db.query.users.findFirst({ where: eq(users.id, user.id) });
  const hasSigningPassword = Boolean(me?.signingPassword);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-mono text-lg font-semibold">{c.caseNumber} · Report</h1>
        <Link href={`/cases/${id}`} className="text-sm text-primary hover:underline">
          ← Back to case
        </Link>
      </div>

      {c.status === "signed_out" ? (
        <SignedReadOnly report={report} />
      ) : (
        <ReportEditor caseId={id} initial={report} hasSigningPassword={hasSigningPassword} />
      )}
    </div>
  );
}

function SignedReadOnly({ report }: { report: Awaited<ReturnType<typeof getLatestReport>> }) {
  if (!report) return <p className="text-sm text-muted-foreground">No report.</p>;
  const sections: [string, string][] = [
    ["Microscopy", report.microscopy],
    ["Diagnosis", report.diagnosis],
    ["Differential considerations", report.differential],
    ["Recommendations", report.recommendations],
    ["Additional notes", report.additionalNotes],
  ];
  return (
    <div className="flex flex-col gap-5">
      <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
        Signed{report.signedAt ? ` on ${new Date(report.signedAt).toLocaleString()}` : ""}. This report is locked.
      </p>
      {sections.map(([label, text]) =>
        text?.trim() ? (
          <div key={label}>
            <h2 className="text-sm font-medium text-muted-foreground">{label}</h2>
            <Markdown>{text}</Markdown>
          </div>
        ) : null,
      )}
      {report.ihc.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">IHC results</h2>
          <ul className="text-sm">
            {report.ihc.map((i, idx) => (
              <li key={idx}>
                {i.stain}: {i.result}
                {i.notes ? ` — ${i.notes}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
