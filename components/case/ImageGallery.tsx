import Image from "next/image";
import { deleteImageForm } from "@/actions/images";
import { UploadWidget } from "@/components/case/UploadWidget";
import type { ImageRow } from "@/lib/db/queries/cases";
import { storageMode } from "@/lib/storage";
import { formatBytes, initials, relativeTime } from "@/lib/utils/time";

export function ImageGallery({
  caseId,
  images,
  canUpload,
  canDeleteAsUploader,
  currentUserId,
}: {
  caseId: string;
  images: ImageRow[];
  canUpload: boolean;
  canDeleteAsUploader: boolean;
  currentUserId: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      {canUpload && <UploadWidget caseId={caseId} mode={storageMode()} />}

      {images.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          Add slide images to start the consultation.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-4">
          {images.map((img) => (
            <li
              key={img.id}
              className="w-44 overflow-hidden rounded-lg border border-border"
            >
              <div className="relative h-32 w-full bg-muted">
                <Image
                  src={img.blobUrl}
                  alt={img.filename}
                  fill
                  sizes="176px"
                  className="object-cover"
                />
              </div>
              <div className="flex flex-col gap-0.5 p-2 text-xs">
                <span className="truncate font-medium" title={img.filename}>
                  {img.filename}
                </span>
                <span className="text-muted-foreground">
                  {initials(img.uploaderName)} · {formatBytes(img.sizeBytes)} ·{" "}
                  {relativeTime(img.uploadedAt)}
                </span>
                {canDeleteAsUploader && img.uploadedBy === currentUserId && (
                  <form action={deleteImageForm}>
                    <input type="hidden" name="imageId" value={img.id} />
                    <button className="mt-1 text-left text-red-600 hover:underline">
                      Delete
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
