"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, fail, ok } from "@/lib/action";
import { logEvent } from "@/lib/audit";
import { canUserAccessCase, requireActiveUser } from "@/lib/auth/guards";
import { getParticipants, resolveMentions } from "@/lib/cases/participants";
import { db } from "@/lib/db/client";
import { comments } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";

const EDIT_WINDOW_MS = 5 * 60 * 1000;

const PostInput = z.object({
  caseId: z.string().min(1),
  body: z.string().trim().min(1, "Comment can't be empty").max(8000),
  parentId: z.string().optional(),
});

export async function postComment(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const guard = await requireActiveUser();
  if (!guard.ok) return fail(guard.error.code);
  const parsed = PostInput.safeParse({
    caseId: formData.get("caseId"),
    body: formData.get("body"),
    parentId: formData.get("parentId") || undefined,
  });
  if (!parsed.success) return fail("BAD_INPUT", undefined, parsed.error.issues);
  const { caseId, body, parentId } = parsed.data;

  // Only content participants may comment (PRODUCT §13; admins excluded).
  const access = await canUserAccessCase(guard.user.id, guard.user.role, caseId);
  if (!access || !access.contentVisible) return fail("FORBIDDEN");
  if (access.case.status === "signed_out") return fail("BAD_STATUS");

  // One level of nesting only (PRODUCT §7.1).
  if (parentId) {
    const parent = await db.query.comments.findFirst({ where: eq(comments.id, parentId) });
    if (!parent || parent.caseId !== caseId || parent.parentId) return fail("BAD_PARENT");
  }

  const now = Date.now();
  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(comments)
      .values({
        caseId,
        authorId: guard.user.id,
        actorKind: "user",
        body,
        parentId: parentId ?? null,
        editLockedAt: now + EDIT_WINDOW_MS,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: comments.id });
    await logEvent(tx, {
      caseId,
      actorId: guard.user.id,
      actorKind: "user",
      eventType: "COMMENT_POSTED",
      payload: { commentId: row.id, parentId: parentId ?? null },
      occurredAt: now,
    });
    return row;
  });

  // Notifications (PRODUCT §12): mentions to mentioned users; otherwise all
  // participants except the author.
  const participants = await getParticipants(caseId);
  const mentioned = resolveMentions(body, participants).filter((p) => p.id !== guard.user.id);
  const link = `${env.APP_URL}/cases/${caseId}`;
  if (mentioned.length > 0) {
    for (const p of mentioned) {
      await sendEmail({
        to: p.email,
        subject: `${guard.user.name ?? "Someone"} mentioned you on case`,
        text: `You were mentioned in a comment.\n\n${link}`,
        html: `<p>You were mentioned in a comment.</p><p><a href="${link}">Open case</a></p>`,
      });
    }
  } else {
    for (const p of participants) {
      if (p.id === guard.user.id) continue;
      await sendEmail({
        to: p.email,
        subject: `New comment on case`,
        text: `A new comment was posted.\n\n${link}`,
        html: `<p>A new comment was posted.</p><p><a href="${link}">Open case</a></p>`,
      });
    }
  }

  revalidatePath(`/cases/${caseId}`);
  return ok(created);
}

export async function editComment(formData: FormData): Promise<ActionResult> {
  const guard = await requireActiveUser();
  if (!guard.ok) return fail(guard.error.code);
  const id = String(formData.get("commentId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (body.length < 1 || body.length > 8000) return fail("BAD_INPUT");

  const c = await db.query.comments.findFirst({ where: eq(comments.id, id) });
  if (!c || c.deletedAt) return fail("NOT_FOUND");
  if (c.authorId !== guard.user.id) return fail("FORBIDDEN");
  // Editable only within 5 minutes (PRODUCT §7.5).
  if (!c.editLockedAt || c.editLockedAt < Date.now()) return fail("EDIT_WINDOW_CLOSED");

  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx.update(comments).set({ body, updatedAt: now }).where(eq(comments.id, id));
    await logEvent(tx, {
      caseId: c.caseId,
      actorId: guard.user.id,
      actorKind: "user",
      eventType: "COMMENT_EDITED",
      payload: { commentId: id },
      occurredAt: now,
    });
  });
  revalidatePath(`/cases/${c.caseId}`);
  return ok(undefined);
}

export async function deleteComment(formData: FormData): Promise<ActionResult> {
  const guard = await requireActiveUser();
  if (!guard.ok) return fail(guard.error.code);
  const id = String(formData.get("commentId") ?? "");
  const c = await db.query.comments.findFirst({ where: eq(comments.id, id) });
  if (!c || c.deletedAt) return fail("NOT_FOUND");
  if (c.authorId !== guard.user.id) return fail("FORBIDDEN");

  // Soft delete: tombstone with a [deleted] body (PRODUCT §7.5).
  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx
      .update(comments)
      .set({ deletedAt: now, body: "[deleted]", updatedAt: now })
      .where(eq(comments.id, id));
    await logEvent(tx, {
      caseId: c.caseId,
      actorId: guard.user.id,
      actorKind: "user",
      eventType: "COMMENT_DELETED",
      payload: { commentId: id },
      occurredAt: now,
    });
  });
  revalidatePath(`/cases/${c.caseId}`);
  return ok(undefined);
}
