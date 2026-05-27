"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, fail, ok } from "@/lib/action";
import { logEvent } from "@/lib/audit";
import { canUserAccessCase, requireActiveUser } from "@/lib/auth/guards";
import { ANNOTATION_COLORS, ANNOTATION_LABEL_MAX } from "@/lib/constants";
import { db } from "@/lib/db/client";
import { annotations, images } from "@/lib/db/schema";

function validGeometry(json: string): boolean {
  try {
    const v = JSON.parse(json);
    return typeof v === "object" && v !== null;
  } catch {
    return false;
  }
}

const CreateInput = z.object({
  imageId: z.string().min(1),
  geometryJson: z.string().refine(validGeometry, "Invalid geometry"),
  label: z.string().max(ANNOTATION_LABEL_MAX).optional(),
  color: z.enum(ANNOTATION_COLORS).default(ANNOTATION_COLORS[0]),
});

export async function createAnnotation(
  input: z.input<typeof CreateInput>,
): Promise<ActionResult<{ id: string }>> {
  const guard = await requireActiveUser();
  if (!guard.ok) return fail(guard.error.code);
  const parsed = CreateInput.safeParse(input);
  if (!parsed.success) return fail("BAD_INPUT", undefined, parsed.error.issues);

  const image = await db.query.images.findFirst({ where: eq(images.id, parsed.data.imageId) });
  if (!image) return fail("NOT_FOUND");

  const access = await canUserAccessCase(guard.user.id, guard.user.role, image.caseId);
  if (!access || !access.contentVisible) return fail("FORBIDDEN");
  if (access.case.status === "signed_out") return fail("BAD_STATUS");

  const now = Date.now();
  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(annotations)
      .values({
        imageId: parsed.data.imageId,
        caseId: image.caseId,
        authorId: guard.user.id,
        geometryJson: parsed.data.geometryJson,
        label: parsed.data.label ?? null,
        color: parsed.data.color,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: annotations.id });
    await logEvent(tx, {
      caseId: image.caseId,
      actorId: guard.user.id,
      actorKind: "user",
      eventType: "ANNOTATION_CREATED",
      payload: { annotationId: row.id, imageId: parsed.data.imageId },
      occurredAt: now,
    });
    return row;
  });

  revalidatePath(`/cases/${image.caseId}`);
  return ok(created);
}

const UpdateInput = z.object({
  id: z.string().min(1),
  geometryJson: z.string().refine(validGeometry, "Invalid geometry").optional(),
  label: z.string().max(ANNOTATION_LABEL_MAX).nullable().optional(),
  color: z.enum(ANNOTATION_COLORS).optional(),
});

export async function updateAnnotation(
  input: z.input<typeof UpdateInput>,
): Promise<ActionResult> {
  const guard = await requireActiveUser();
  if (!guard.ok) return fail(guard.error.code);
  const parsed = UpdateInput.safeParse(input);
  if (!parsed.success) return fail("BAD_INPUT", undefined, parsed.error.issues);

  const ann = await db.query.annotations.findFirst({ where: eq(annotations.id, parsed.data.id) });
  if (!ann || ann.deletedAt) return fail("NOT_FOUND");
  // Only the author edits their own annotation (PRODUCT §6.3).
  if (ann.authorId !== guard.user.id) return fail("FORBIDDEN");

  const access = await canUserAccessCase(guard.user.id, guard.user.role, ann.caseId);
  if (!access) return fail("FORBIDDEN");
  if (access.case.status === "signed_out") return fail("BAD_STATUS");

  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx
      .update(annotations)
      .set({
        ...(parsed.data.geometryJson ? { geometryJson: parsed.data.geometryJson } : {}),
        ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
        ...(parsed.data.color ? { color: parsed.data.color } : {}),
        updatedAt: now,
      })
      .where(eq(annotations.id, parsed.data.id));
    await logEvent(tx, {
      caseId: ann.caseId,
      actorId: guard.user.id,
      actorKind: "user",
      eventType: "ANNOTATION_UPDATED",
      payload: { annotationId: ann.id },
      occurredAt: now,
    });
  });

  revalidatePath(`/cases/${ann.caseId}`);
  return ok(undefined);
}

export async function deleteAnnotation(input: { id: string }): Promise<ActionResult> {
  const guard = await requireActiveUser();
  if (!guard.ok) return fail(guard.error.code);
  const ann = await db.query.annotations.findFirst({ where: eq(annotations.id, input.id) });
  if (!ann || ann.deletedAt) return fail("NOT_FOUND");

  const access = await canUserAccessCase(guard.user.id, guard.user.role, ann.caseId);
  if (!access) return fail("FORBIDDEN");
  if (access.case.status === "signed_out") return fail("BAD_STATUS");

  // Author may delete their own; an assigned consultant may delete any (§6.3).
  const isAuthor = ann.authorId === guard.user.id;
  const isAssignedConsultant =
    guard.user.role === "consultant" && access.case.assignedTo === guard.user.id;
  if (!isAuthor && !isAssignedConsultant) return fail("FORBIDDEN");

  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx.update(annotations).set({ deletedAt: now }).where(eq(annotations.id, ann.id));
    await logEvent(tx, {
      caseId: ann.caseId,
      actorId: guard.user.id,
      actorKind: "user",
      eventType: "ANNOTATION_DELETED",
      payload: { annotationId: ann.id, byConsultant: isAssignedConsultant && !isAuthor },
      occurredAt: now,
    });
  });

  revalidatePath(`/cases/${ann.caseId}`);
  return ok(undefined);
}
