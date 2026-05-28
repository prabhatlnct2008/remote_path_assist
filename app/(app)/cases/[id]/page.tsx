import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BriefCard } from "@/components/ai/BriefCard";
import { ChatSidebar } from "@/components/ai/ChatSidebar";
import { PriorityBadge, StatusBadge } from "@/components/case/Badges";
import { CaseActions } from "@/components/case/CaseActions";
import { CommentsPanel } from "@/components/case/CommentsPanel";
import { ImageGallery } from "@/components/case/ImageGallery";
import { currentUser } from "@/lib/auth/guards";
import { maybeOpenCase } from "@/lib/cases/transitions";
import { getCommentThreads } from "@/lib/db/queries/comments";
import { getCaseImages, getCaseView } from "@/lib/db/queries/cases";
import { getActiveConsultants } from "@/lib/db/queries/users";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect("/login");

  const view = await getCaseView(user, id);
  if (!view) notFound();
  const { case: c, contentVisible } = view;

  // First open by the assigned consultant transitions assigned → in_review.
  const status = await maybeOpenCase(id, user, c.status, c.assignedTo);

  const isAssignedConsultant = user.role === "consultant" && c.assignedTo === user.id;
  const canUpload =
    contentVisible && ["submitted", "assigned", "in_review"].includes(status);
  const canComment = contentVisible && status !== "signed_out";

  const [images, threads] = await Promise.all([
    getCaseImages(id),
    contentVisible ? getCommentThreads(id) : Promise.resolve([]),
  ]);
  const consultants =
    user.role === "admin" || isAssignedConsultant ? await getActiveConsultants() : [];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3 border-b border-border pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-lg font-semibold">{c.caseNumber}</h1>
            <StatusBadge status={status} />
            <PriorityBadge priority={c.priority} />
            {c.needsMoreMaterial && (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                Needs more material
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            {isAssignedConsultant && ["in_review", "reported"].includes(status) && (
              <Link href={`/cases/${id}/report`} className="text-sm text-primary hover:underline">
                Draft report
              </Link>
            )}
            {status === "signed_out" && contentVisible && (
              <Link href={`/cases/${id}/report`} className="text-sm text-primary hover:underline">
                View report
              </Link>
            )}
            {status === "signed_out" && contentVisible && c.signedPdfUrl && (
              <a
                href={c.signedPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white"
              >
                Download signed report
              </a>
            )}
            <Link href={`/cases/${id}/audit`} className="text-sm text-primary hover:underline">
              Audit trail
            </Link>
          </div>
        </div>
        <CaseActions
          caseId={id}
          status={status}
          role={user.role}
          isAssignedConsultant={isAssignedConsultant}
          needsMoreMaterial={c.needsMoreMaterial}
          consultants={consultants.map((x) => ({ id: x.id, name: x.name ?? x.email, subspecialty: x.subspecialty }))}
        />
      </header>

      {isAssignedConsultant && (
        <BriefCard caseId={id} status={c.aiBriefStatus} brief={c.aiBriefMd} />
      )}

      <section className="rounded-lg border border-border p-5">
        <h2 className="mb-4 text-sm font-medium text-muted-foreground">Patient & clinical</h2>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Patient MRN">{view.patientRefDisplay}</Field>
          <Field label="Age">{c.age}</Field>
          <Field label="Sex">{c.sex}</Field>
          <Field label="Specimen">{c.specimenType.replace(/_/g, " ")}</Field>
          <Field label="Created by">{view.createdByName ?? "—"}</Field>
          <Field label="Assigned to">{view.assignedToName ?? "Unassigned"}</Field>
          <Field label="Consent">
            {c.consentConfirmed ? new Date(c.consentAt).toLocaleString() : "Not confirmed"}
          </Field>
        </dl>
        <div className="mt-5">
          <dt className="text-xs text-muted-foreground">Clinical history</dt>
          <dd className="mt-1 whitespace-pre-wrap text-sm">
            {contentVisible
              ? view.clinicalHistory
              : "Restricted — clinical content is not visible to administrators."}
          </dd>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            Slide images ({images.length})
          </h2>
          {contentVisible && images.length > 0 && (
            <Link href={`/cases/${id}/viewer`} className="text-sm text-primary hover:underline">
              Open viewer →
            </Link>
          )}
        </div>
        <ImageGallery
          caseId={id}
          images={images}
          canUpload={canUpload}
          canDeleteAsUploader={status === "submitted" && contentVisible}
          currentUserId={user.id}
        />
      </section>

      {contentVisible && (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium text-muted-foreground">Comments</h2>
          <CommentsPanel
            caseId={id}
            threads={threads}
            currentUserId={user.id}
            canComment={canComment}
          />
        </section>
      )}

      {isAssignedConsultant && <ChatSidebar caseId={id} />}
    </div>
  );
}
