"use server";

import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { type ActionResult, fail, ok } from "@/lib/action";
import { logEvent } from "@/lib/audit";
import { requireActiveUser } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import { cases, images } from "@/lib/db/schema";
import { deleteObject } from "@/lib/storage";

/**
 * Soft-deletes an image. Only the uploader may delete, and only while the case
 * is still in `submitted` (PRODUCT §5.5). Logs IMAGE_DELETED.
 */
export async function deleteImage(formData: FormData): Promise<ActionResult> {
  const guard = await requireActiveUser();
  if (!guard.ok) return fail(guard.error.code);

  const imageId = String(formData.get("imageId") ?? "");
  const image = await db.query.images.findFirst({ where: eq(images.id, imageId) });
  if (!image || image.deletedAt) return fail("NOT_FOUND");
  if (image.uploadedBy !== guard.user.id) return fail("FORBIDDEN");

  const c = await db.query.cases.findFirst({ where: eq(cases.id, image.caseId) });
  if (!c) return fail("NOT_FOUND");
  if (c.status !== "submitted") return fail("STATUS_LOCKED");

  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx.update(images).set({ deletedAt: now }).where(eq(images.id, imageId));
    await tx.update(cases).set({ updatedAt: now }).where(eq(cases.id, image.caseId));
    await logEvent(tx, {
      caseId: image.caseId,
      actorId: guard.user.id,
      actorKind: "user",
      eventType: "IMAGE_DELETED",
      payload: { imageId, filename: image.filename },
      occurredAt: now,
    });
  });

  // Remove the underlying object (best-effort; row is already tombstoned).
  await deleteObject({ url: image.blobUrl, pathname: image.blobPathname });

  revalidateTag(`cases:detail:${image.caseId}`);
  return ok(undefined);
}

/** Void-returning wrapper for use as a plain <form action>. */
export async function deleteImageForm(formData: FormData): Promise<void> {
  await deleteImage(formData);
}
