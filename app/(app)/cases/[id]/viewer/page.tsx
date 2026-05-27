import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CaseViewer } from "@/components/viewer/CaseViewer";
import { currentUser } from "@/lib/auth/guards";
import { getAnnotations, type AnnotationRow } from "@/lib/db/queries/annotations";
import { getCaseImages, getCaseView } from "@/lib/db/queries/cases";

export default async function ViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect("/login");

  const view = await getCaseView(user, id);
  if (!view) notFound();
  // Admins have no content access (PRODUCT §13).
  if (!view.contentVisible) notFound();

  const images = await getCaseImages(id);
  const annotationsByImage: Record<string, AnnotationRow[]> = {};
  await Promise.all(
    images.map(async (img) => {
      annotationsByImage[img.id] = await getAnnotations(img.id);
    }),
  );

  const canAnnotate = view.case.status !== "signed_out";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-mono text-lg font-semibold">{view.case.caseNumber} · Viewer</h1>
        <Link href={`/cases/${id}`} className="text-sm text-primary hover:underline">
          ← Back to case
        </Link>
      </div>

      {images.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          No images to view yet.
        </p>
      ) : (
        <CaseViewer
          images={images.map((i) => ({ id: i.id, url: i.blobUrl, filename: i.filename }))}
          initialIndex={0}
          annotationsByImage={annotationsByImage}
          canAnnotate={canAnnotate}
        />
      )}
    </div>
  );
}
