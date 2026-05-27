import { notFound, redirect } from "next/navigation";
import { ImageGallery } from "@/components/case/ImageGallery";
import { PriorityBadge, StatusBadge } from "@/components/case/Badges";
import { currentUser } from "@/lib/auth/guards";
import { getCaseImages, getCaseView } from "@/lib/db/queries/cases";

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

  const canUpload =
    contentVisible && (c.status === "submitted" || c.status === "assigned" || c.status === "in_review");
  const images = await getCaseImages(id);

  return (
    <div className="flex flex-col gap-8">
      {/* Header band */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-lg font-semibold">{c.caseNumber}</h1>
          <StatusBadge status={c.status} />
          <PriorityBadge priority={c.priority} />
          {c.needsMoreMaterial && (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
              Needs more material
            </span>
          )}
        </div>
      </header>

      {/* Patient & clinical card */}
      <section className="rounded-lg border border-border p-5">
        <h2 className="mb-4 text-sm font-medium text-muted-foreground">
          Patient & clinical
        </h2>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Patient MRN">{view.patientRefDisplay}</Field>
          <Field label="Age">{c.age}</Field>
          <Field label="Sex">{c.sex}</Field>
          <Field label="Specimen">{c.specimenType.replace(/_/g, " ")}</Field>
          <Field label="Created by">{view.createdByName ?? "—"}</Field>
          <Field label="Assigned to">{view.assignedToName ?? "Unassigned"}</Field>
          <Field label="Consent">
            {c.consentConfirmed
              ? new Date(c.consentAt).toLocaleString()
              : "Not confirmed"}
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

      {/* Images */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-muted-foreground">
          Slide images ({images.length})
        </h2>
        <ImageGallery
          caseId={id}
          images={images}
          canUpload={canUpload}
          canDeleteAsUploader={c.status === "submitted" && contentVisible}
          currentUserId={user.id}
        />
      </section>
    </div>
  );
}
