"use server";

import { createHash } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, fail, ok } from "@/lib/action";
import { generateDraft, type DraftOutput } from "@/lib/ai/draft";
import { generateEmbedding } from "@/lib/ai/embeddings";
import { logEvent } from "@/lib/audit";
import { verifyChain } from "@/lib/audit/verify";
import { canUserAccessCase, requireRole } from "@/lib/auth/guards";
import { hashSigningPassword, verifySigningPassword } from "@/lib/auth/signing";
import { decrypt, encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { annotations, cases, comments, reports, users } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { renderReportPdf } from "@/lib/pdf/report";
import { putObject } from "@/lib/storage";

// ── signing password ─────────────────────────────────────────────────────────
const PASSWORD_RE = { min: 8 };

export async function setSigningPassword(formData: FormData): Promise<ActionResult> {
  const guard = await requireRole("consultant");
  if (!guard.ok) return fail(guard.error.code);
  const password = String(formData.get("password") ?? "");
  if (password.length < PASSWORD_RE.min) return fail("WEAK_PASSWORD", "At least 8 characters.");
  const hashed = await hashSigningPassword(password);
  await db.update(users).set({ signingPassword: hashed, updatedAt: Date.now() }).where(eq(users.id, guard.user.id));
  return ok(undefined);
}

// ── draft persistence ─────────────────────────────────────────────────────────
const SaveInput = z.object({
  caseId: z.string().min(1),
  microscopy: z.string().max(20000).default(""),
  diagnosis: z.string().max(20000).default(""),
  differential: z.string().max(20000).default(""),
  recommendations: z.string().max(20000).default(""),
  additionalNotes: z.string().max(20000).default(""),
  ihcJson: z.string().default("[]"),
});

async function loadOrCreateDraft(caseId: string) {
  const existing = await db.query.reports.findFirst({
    where: and(eq(reports.caseId, caseId), eq(reports.status, "draft")),
    orderBy: [desc(reports.version)],
  });
  if (existing) return existing;
  const [created] = await db
    .insert(reports)
    .values({ caseId, status: "draft", version: 1 })
    .returning();
  return created;
}

export async function saveReportDraft(formData: FormData): Promise<ActionResult> {
  const guard = await requireRole("consultant");
  if (!guard.ok) return fail(guard.error.code);
  const parsed = SaveInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail("BAD_INPUT", undefined, parsed.error.issues);
  const input = parsed.data;

  const access = await canUserAccessCase(guard.user.id, "consultant", input.caseId);
  if (!access || access.case.assignedTo !== guard.user.id) return fail("FORBIDDEN");
  const c = access.case;
  if (c.status !== "in_review" && c.status !== "reported") return fail("BAD_STATUS");

  const now = Date.now();
  await db.transaction(async (tx) => {
    const draft = await loadOrCreateDraft(input.caseId);
    await tx
      .update(reports)
      .set({
        microscopy: encrypt(input.microscopy),
        diagnosis: encrypt(input.diagnosis),
        differential: encrypt(input.differential),
        recommendations: encrypt(input.recommendations),
        bodyMd: encrypt(input.additionalNotes),
        ihcJson: input.ihcJson,
        updatedAt: now,
      })
      .where(eq(reports.id, draft.id));

    const firstDraft = c.status === "in_review";
    if (firstDraft) {
      await tx.update(cases).set({ status: "reported", updatedAt: now }).where(eq(cases.id, input.caseId));
    }
    await logEvent(tx, {
      caseId: input.caseId,
      actorId: guard.user.id,
      actorKind: "user",
      eventType: firstDraft ? "REPORT_DRAFTED" : "REPORT_AUTO_SAVED",
      payload: { reportId: draft.id },
      occurredAt: now,
    });
  });

  revalidatePath(`/cases/${input.caseId}`);
  return ok(undefined);
}

// ── AI draft ───────────────────────────────────────────────────────────────────
export async function draftReport(formData: FormData): Promise<ActionResult<DraftOutput>> {
  const guard = await requireRole("consultant");
  if (!guard.ok) return fail(guard.error.code);
  const caseId = String(formData.get("caseId") ?? "");

  const access = await canUserAccessCase(guard.user.id, "consultant", caseId);
  if (!access || access.case.assignedTo !== guard.user.id) return fail("FORBIDDEN");
  const c = access.case;

  // Context: history, brief, annotation labels (all images), recent comments.
  const annLabels = (
    await db
      .select({ label: annotations.label })
      .from(annotations)
      .where(and(eq(annotations.caseId, caseId), isNull(annotations.deletedAt)))
  )
    .map((a) => a.label)
    .filter((l): l is string => Boolean(l));
  const recentComments = (
    await db
      .select({ body: comments.body, kind: comments.actorKind })
      .from(comments)
      .where(and(eq(comments.caseId, caseId), isNull(comments.deletedAt)))
      .orderBy(desc(comments.createdAt))
      .limit(8)
  ).map((x) => x.body);

  const result = await generateDraft({
    age: c.age,
    sex: c.sex,
    specimenType: c.specimenType,
    priority: c.priority,
    clinicalHistory: decrypt(c.clinicalHistory),
    brief: c.aiBriefMd,
    annotationLabels: annLabels,
    recentComments,
  });
  if (!result) return fail("AI_UNAVAILABLE", "AI is not configured.");

  const now = Date.now();
  await db.transaction(async (tx) => {
    const draft = await loadOrCreateDraft(caseId);
    await tx
      .update(reports)
      .set({
        microscopy: encrypt(result.data.microscopy),
        diagnosis: encrypt(result.data.diagnosis),
        differential: encrypt(result.data.differential),
        recommendations: encrypt(result.data.recommendations),
        ihcJson: JSON.stringify(result.data.ihc),
        aiDraftMd: encrypt(result.rawJson),
        updatedAt: now,
      })
      .where(eq(reports.id, draft.id));
    await logEvent(tx, {
      caseId,
      actorId: null,
      actorKind: "ai",
      eventType: "AI_DRAFT_GENERATED",
      payload: {
        tokensIn: result.usage?.inputTokens ?? null,
        tokensOut: result.usage?.outputTokens ?? null,
      },
      occurredAt: now,
    });
  });

  revalidatePath(`/cases/${caseId}`);
  return ok(result.data);
}

// ── signout ──────────────────────────────────────────────────────────────────
const wrongAttempts = new Map<string, number[]>();
const LOCK_WINDOW_MS = 10 * 60 * 1000;
const LOCK_MS = 30 * 60 * 1000;
const MAX_WRONG = 3;

export async function signOutReport(formData: FormData): Promise<ActionResult> {
  const guard = await requireRole("consultant");
  if (!guard.ok) return fail(guard.error.code);
  const caseId = String(formData.get("caseId") ?? "");
  const password = String(formData.get("password") ?? "");

  const access = await canUserAccessCase(guard.user.id, "consultant", caseId);
  if (!access || access.case.assignedTo !== guard.user.id) return fail("FORBIDDEN");
  const c = access.case;
  if (c.status !== "reported") return fail("BAD_STATUS");

  const me = await db.query.users.findFirst({ where: eq(users.id, guard.user.id) });
  if (!me?.signingPassword) return fail("NO_SIGNING_PASSWORD");
  if (me.signingLockedUntil && me.signingLockedUntil > Date.now()) return fail("LOCKED");

  const report = await db.query.reports.findFirst({
    where: eq(reports.caseId, caseId),
    orderBy: [desc(reports.version)],
  });
  if (!report) return fail("NO_REPORT");
  const microscopy = decrypt(report.microscopy);
  const diagnosis = decrypt(report.diagnosis);
  if (!microscopy.trim() || !diagnosis.trim()) return fail("INCOMPLETE");

  // Verify the signing password with brute-force lockout (PRODUCT §9.3, §10.8).
  if (!(await verifySigningPassword(me.signingPassword, password))) {
    const now = Date.now();
    const recent = (wrongAttempts.get(me.id) ?? []).filter((t) => now - t < LOCK_WINDOW_MS);
    recent.push(now);
    wrongAttempts.set(me.id, recent);
    if (recent.length >= MAX_WRONG) {
      await db.update(users).set({ signingLockedUntil: now + LOCK_MS }).where(eq(users.id, me.id));
      wrongAttempts.delete(me.id);
      await db.transaction(async (tx) => {
        await logEvent(tx, {
          caseId, actorId: me.id, actorKind: "user", eventType: "REPORT_SIGN_LOCKED", payload: {}, occurredAt: now,
        });
      });
      return fail("LOCKED");
    }
    return fail("WRONG_PASSWORD");
  }
  wrongAttempts.delete(me.id);

  const signedAt = Date.now();
  const differential = decrypt(report.differential);
  const recommendations = decrypt(report.recommendations);
  const additionalNotes = decrypt(report.bodyMd);
  const ihc = safeIhc(report.ihcJson);

  const signaturePayload = JSON.stringify({
    caseId, microscopy, diagnosis, differential, recommendations, additionalNotes, ihc,
    signerId: me.id, signedAt,
  });
  const signatureHash = createHash("sha256").update(signaturePayload).digest("hex");

  // Snapshot + lock the report, chain REPORT_SIGNED, flip the case (one tx).
  await db.transaction(async (tx) => {
    await tx
      .update(reports)
      .set({
        status: "signed",
        version: report.version + 1,
        signedAt,
        signedBy: me.id,
        signatureHash,
        updatedAt: signedAt,
      })
      .where(eq(reports.id, report.id));
    await tx
      .update(cases)
      .set({ status: "signed_out", signedOutBy: me.id, signedOutAt: signedAt, updatedAt: signedAt })
      .where(eq(cases.id, caseId));
    await logEvent(tx, {
      caseId, actorId: me.id, actorKind: "user", eventType: "REPORT_SIGNED",
      payload: { reportVersion: report.version + 1, signatureHash },
      occurredAt: signedAt,
    });
  });

  // Embedding for similarity search (PRODUCT §10.4).
  try {
    await generateEmbedding(caseId);
  } catch {
    // non-fatal
  }

  // PDF → storage → case.signed_pdf_url.
  try {
    const chain = await verifyChain(caseId);
    const pdf = await renderReportPdf({
      caseNumber: c.caseNumber,
      createdAt: c.createdAt,
      signedAt,
      signerName: me.name || me.email,
      signerCredentials: me.subspecialty,
      age: c.age,
      sex: c.sex,
      specimenType: c.specimenType,
      clinicalHistory: decrypt(c.clinicalHistory),
      microscopy, diagnosis, differential, recommendations, additionalNotes, ihc,
      audit: {
        eventCount: chain.eventCount,
        rootHash: chain.rootHash ?? "0".repeat(64),
        signerHash: signatureHash,
      },
    });
    const { url } = await putObject(`${caseId}/report-v${report.version + 1}.pdf`, pdf, "application/pdf");
    await db.update(cases).set({ signedPdfUrl: url }).where(eq(cases.id, caseId));
  } catch {
    // PDF can be regenerated; case is already signed out.
  }

  // Notify the requester (PRODUCT §12).
  const creator = await db.query.users.findFirst({ where: eq(users.id, c.createdBy) });
  if (creator) {
    await sendEmail({
      to: creator.email,
      subject: `Your report is ready: case ${c.caseNumber}`,
      text: `The signed report for ${c.caseNumber} is ready.\n\n${env.APP_URL}/cases/${caseId}`,
      html: `<p>The signed report for <strong>${c.caseNumber}</strong> is ready.</p><p><a href="${env.APP_URL}/cases/${caseId}">View case</a></p>`,
    });
  }

  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/cases");
  return ok(undefined);
}

function safeIhc(json: string): DraftOutput["ihc"] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
