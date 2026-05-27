"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, fail, ok } from "@/lib/action";
import { logEvent } from "@/lib/audit";
import { canUserAccessCase, requireActiveUser, requireRole } from "@/lib/auth/guards";
import { SLA_MS } from "@/lib/constants";
import { db } from "@/lib/db/client";
import { cases, comments, users } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { generateBrief } from "@/lib/ai/brief";

function caseLink(caseId: string) {
  return `${env.APP_URL}/cases/${caseId}`;
}

const AssignInput = z.object({
  caseId: z.string().min(1),
  consultantId: z.string().min(1),
});

/** Admin assigns a submitted case to a consultant (PRODUCT §8.1). */
export async function assignCase(formData: FormData): Promise<ActionResult> {
  const guard = await requireRole("admin");
  if (!guard.ok) return fail(guard.error.code);
  const parsed = AssignInput.safeParse({
    caseId: formData.get("caseId"),
    consultantId: formData.get("consultantId"),
  });
  if (!parsed.success) return fail("BAD_INPUT");
  const { caseId, consultantId } = parsed.data;

  const c = await db.query.cases.findFirst({ where: eq(cases.id, caseId) });
  if (!c) return fail("NOT_FOUND");
  if (c.status !== "submitted") return fail("BAD_STATUS");

  const consultant = await db.query.users.findFirst({
    where: and(eq(users.id, consultantId), eq(users.role, "consultant"), eq(users.active, true)),
  });
  if (!consultant) return fail("INVALID_CONSULTANT");

  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx
      .update(cases)
      .set({
        assignedTo: consultantId,
        assignedAt: now,
        status: "assigned",
        slaDueAt: now + SLA_MS[c.priority],
        aiBriefStatus: "idle",
        updatedAt: now,
      })
      .where(eq(cases.id, caseId));
    await logEvent(tx, {
      caseId,
      actorId: guard.user.id,
      actorKind: "user",
      eventType: "CASE_ASSIGNED",
      payload: { consultantId },
      occurredAt: now,
    });
  });

  await sendEmail({
    to: consultant.email,
    subject: `New case assigned: ${c.caseNumber}`,
    text: `A new case has been assigned to you: ${c.caseNumber}\n\n${caseLink(caseId)}`,
    html: `<p>A new case has been assigned to you: <strong>${c.caseNumber}</strong></p><p><a href="${caseLink(caseId)}">Open case</a></p>`,
  });

  // Kick off the pre-review brief without blocking the response (ARCH §8.1).
  void generateBrief(caseId);

  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/cases");
  return ok(undefined);
}

const ReassignInput = z.object({
  caseId: z.string().min(1),
  consultantId: z.string().min(1),
  reason: z.string().trim().min(1, "Reason is required").max(500),
});

/** Current consultant or admin reassigns; case returns to `assigned`, work
 *  preserved, both consultants notified (PRODUCT §4.10). */
export async function reassignCase(formData: FormData): Promise<ActionResult> {
  const guard = await requireActiveUser();
  if (!guard.ok) return fail(guard.error.code);
  const parsed = ReassignInput.safeParse({
    caseId: formData.get("caseId"),
    consultantId: formData.get("consultantId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return fail("BAD_INPUT", undefined, parsed.error.issues);
  const { caseId, consultantId, reason } = parsed.data;

  const c = await db.query.cases.findFirst({ where: eq(cases.id, caseId) });
  if (!c) return fail("NOT_FOUND");
  if (c.status === "signed_out") return fail("BAD_STATUS");
  // Only the current consultant or an admin may reassign.
  const allowed = guard.user.role === "admin" || c.assignedTo === guard.user.id;
  if (!allowed) return fail("FORBIDDEN");

  const next = await db.query.users.findFirst({
    where: and(eq(users.id, consultantId), eq(users.role, "consultant"), eq(users.active, true)),
  });
  if (!next) return fail("INVALID_CONSULTANT");

  const prevId = c.assignedTo;
  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx
      .update(cases)
      .set({
        assignedTo: consultantId,
        assignedAt: now,
        status: "assigned",
        slaDueAt: now + SLA_MS[c.priority],
        updatedAt: now,
      })
      .where(eq(cases.id, caseId));
    await logEvent(tx, {
      caseId,
      actorId: guard.user.id,
      actorKind: "user",
      eventType: "CASE_REASSIGNED",
      payload: { from: prevId, to: consultantId, reason },
      occurredAt: now,
    });
  });

  const recipients = new Set<string>([next.email]);
  if (prevId) {
    const prev = await db.query.users.findFirst({ where: eq(users.id, prevId) });
    if (prev) recipients.add(prev.email);
  }
  for (const to of recipients) {
    await sendEmail({
      to,
      subject: `Case ${c.caseNumber} has been reassigned`,
      text: `Case ${c.caseNumber} has been reassigned.\nReason: ${reason}\n\n${caseLink(caseId)}`,
      html: `<p>Case <strong>${c.caseNumber}</strong> has been reassigned.</p><p>Reason: ${reason}</p><p><a href="${caseLink(caseId)}">Open case</a></p>`,
    });
  }

  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/cases");
  return ok(undefined);
}

const FlagInput = z.object({
  caseId: z.string().min(1),
  comment: z.string().trim().min(1, "Please describe what's needed").max(500),
});

/** Assigned consultant flags that more material is needed (PRODUCT §4.6). */
export async function flagNeedsMoreMaterial(formData: FormData): Promise<ActionResult> {
  const guard = await requireRole("consultant");
  if (!guard.ok) return fail(guard.error.code);
  const parsed = FlagInput.safeParse({
    caseId: formData.get("caseId"),
    comment: formData.get("comment"),
  });
  if (!parsed.success) return fail("BAD_INPUT", undefined, parsed.error.issues);
  const { caseId, comment } = parsed.data;

  const access = await canUserAccessCase(guard.user.id, "consultant", caseId);
  if (!access) return fail("FORBIDDEN");
  const c = access.case;
  if (c.status === "signed_out") return fail("BAD_STATUS");

  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx
      .update(cases)
      .set({ needsMoreMaterial: true, updatedAt: now })
      .where(eq(cases.id, caseId));
    await tx.insert(comments).values({
      caseId,
      authorId: guard.user.id,
      actorKind: "user",
      body: `**More material requested:** ${comment}`,
      editLockedAt: now + 5 * 60 * 1000,
    });
    await logEvent(tx, {
      caseId,
      actorId: guard.user.id,
      actorKind: "user",
      eventType: "CASE_FLAGGED_NEEDS_MATERIAL",
      payload: { comment },
      occurredAt: now,
    });
  });

  // Notify the requester (PRODUCT §12).
  const creator = await db.query.users.findFirst({ where: eq(users.id, c.createdBy) });
  if (creator) {
    await sendEmail({
      to: creator.email,
      subject: `Additional material requested for case ${c.caseNumber}`,
      text: `Additional material has been requested for ${c.caseNumber}:\n\n${comment}\n\n${caseLink(caseId)}`,
      html: `<p>Additional material requested for <strong>${c.caseNumber}</strong>:</p><blockquote>${comment}</blockquote><p><a href="${caseLink(caseId)}">Open case</a></p>`,
    });
  }

  revalidatePath(`/cases/${caseId}`);
  return ok(undefined);
}

/** Manually clears the needs-more-material flag (consultant). */
export async function unflagNeedsMoreMaterial(formData: FormData): Promise<ActionResult> {
  const guard = await requireRole("consultant");
  if (!guard.ok) return fail(guard.error.code);
  const caseId = String(formData.get("caseId") ?? "");
  const access = await canUserAccessCase(guard.user.id, "consultant", caseId);
  if (!access) return fail("FORBIDDEN");

  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx.update(cases).set({ needsMoreMaterial: false, updatedAt: now }).where(eq(cases.id, caseId));
    await logEvent(tx, {
      caseId,
      actorId: guard.user.id,
      actorKind: "user",
      eventType: "CASE_UNFLAGGED",
      payload: {},
      occurredAt: now,
    });
  });
  revalidatePath(`/cases/${caseId}`);
  return ok(undefined);
}
