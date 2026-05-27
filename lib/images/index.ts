import { and, eq, isNull } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { logEvent } from "@/lib/audit";
import { canUserAccessCase, type SessionUser } from "@/lib/auth/guards";
import {
  IMAGE_CONTENT_TYPES,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_PER_CASE,
  UPLOADABLE_STATUSES,
} from "@/lib/constants";
import { db } from "@/lib/db/client";
import { cases, images } from "@/lib/db/schema";

export type UploadCheck =
  | { ok: true }
  | { ok: false; code: string };

/**
 * Server-side guard shared by both upload paths: the user must be a content
 * participant (not an admin), the case status must permit uploads, and the
 * case must be under the per-case image limit (PRODUCT §5.1, §5.2, §13).
 */
export async function checkCanUpload(
  user: SessionUser,
  caseId: string,
): Promise<UploadCheck> {
  const access = await canUserAccessCase(user.id, user.role, caseId);
  if (!access || !access.contentVisible) return { ok: false, code: "FORBIDDEN" };
  if (!UPLOADABLE_STATUSES.includes(access.case.status)) {
    return { ok: false, code: "STATUS_LOCKED" };
  }
  const current = await db
    .select({ id: images.id })
    .from(images)
    .where(and(eq(images.caseId, caseId), isNull(images.deletedAt)));
  if (current.length >= IMAGE_MAX_PER_CASE) return { ok: false, code: "TOO_MANY_IMAGES" };
  return { ok: true };
}

export function isAllowedContentType(ct: string): boolean {
  return (IMAGE_CONTENT_TYPES as readonly string[]).includes(ct);
}

const TYPE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/tiff": "tiff",
  "image/webp": "webp",
};

export function extForType(ct: string): string {
  return TYPE_EXT[ct] ?? "bin";
}

export function isAllowedSize(bytes: number): boolean {
  return bytes > 0 && bytes <= IMAGE_MAX_BYTES;
}

export interface RegisterImageInput {
  caseId: string;
  filename: string;
  blobUrl: string;
  blobPathname: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  width?: number;
  height?: number;
}

/**
 * Records an uploaded image: inserts the row, logs IMAGE_UPLOADED, clears the
 * needs_more_material flag, and bumps the case timestamp — all in one tx
 * (ARCHITECTURE §6.4, §13.1). Returns the new image id.
 */
export async function registerImage(input: RegisterImageInput): Promise<{ id: string }> {
  const now = Date.now();
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(images)
      .values({
        caseId: input.caseId,
        filename: input.filename,
        blobUrl: input.blobUrl,
        blobPathname: input.blobPathname,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        width: input.width ?? null,
        height: input.height ?? null,
        uploadedBy: input.uploadedBy,
        uploadedAt: now,
      })
      .returning({ id: images.id });

    await tx
      .update(cases)
      .set({ needsMoreMaterial: false, updatedAt: now })
      .where(eq(cases.id, input.caseId));

    await logEvent(tx, {
      caseId: input.caseId,
      actorId: input.uploadedBy,
      actorKind: "user",
      eventType: "IMAGE_UPLOADED",
      payload: {
        imageId: row.id,
        filename: input.filename,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
      },
      occurredAt: now,
    });
    return row;
  });

  revalidateTag(`cases:detail:${input.caseId}`);
  return result;
}
