"use server";

import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { type ActionResult, fail, ok } from "@/lib/action";
import { logEvent, type Tx } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guards";
import { PRIORITIES, SPECIMEN_TYPES } from "@/lib/constants";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { caseSequences, cases } from "@/lib/db/schema";
import { currentKeyVersion } from "@/lib/env";

const CreateCaseInput = z.object({
  patientRef: z.string().trim().min(1, "Patient MRN is required").max(64),
  age: z.coerce.number().int().min(0).max(120),
  sex: z.enum(["M", "F", "Other"]),
  specimenType: z.enum(SPECIMEN_TYPES),
  priority: z.enum(PRIORITIES).default("routine"),
  clinicalHistory: z.string().trim().min(1, "Clinical history is required").max(4000),
  consent: z.coerce.boolean().refine((v) => v === true, {
    message: "Patient consent must be confirmed to create a case.",
  }),
});

/** Atomically allocates the next case number for the current year. The
 *  case_sequences upsert + SQLite write serialization make this race-safe. */
async function nextCaseNumber(tx: Tx): Promise<string> {
  const year = new Date().getFullYear();
  await tx
    .insert(caseSequences)
    .values({ year, lastNumber: 1 })
    .onConflictDoUpdate({
      target: caseSequences.year,
      set: { lastNumber: sql`${caseSequences.lastNumber} + 1` },
    });
  const [row] = await tx
    .select({ n: caseSequences.lastNumber })
    .from(caseSequences)
    .where(eq(caseSequences.year, year));
  return `AIIMS-PATH-${year}-${String(row.n).padStart(5, "0")}`;
}

export async function createCase(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const guard = await requireRole("requester", "admin");
  if (!guard.ok) return fail(guard.error.code);

  const parsed = CreateCaseInput.safeParse({
    patientRef: formData.get("patientRef"),
    age: formData.get("age"),
    sex: formData.get("sex"),
    specimenType: formData.get("specimenType"),
    priority: formData.get("priority"),
    clinicalHistory: formData.get("clinicalHistory"),
    consent: formData.get("consent") === "on" || formData.get("consent") === "true",
  });
  if (!parsed.success) return fail("BAD_INPUT", undefined, parsed.error.issues);
  const input = parsed.data;

  const now = Date.now();
  const created = await db.transaction(async (tx) => {
    const caseNumber = await nextCaseNumber(tx);
    const [row] = await tx
      .insert(cases)
      .values({
        caseNumber,
        patientRef: encrypt(input.patientRef),
        age: input.age,
        sex: input.sex,
        clinicalHistory: encrypt(input.clinicalHistory),
        specimenType: input.specimenType,
        priority: input.priority,
        status: "submitted",
        consentConfirmed: true,
        consentAt: now,
        createdBy: guard.user.id,
        encryptionKeyVersion: currentKeyVersion(),
      })
      .returning({ id: cases.id, caseNumber: cases.caseNumber });

    // Audit payload carries NO patient content (PRODUCT §10.6).
    await logEvent(tx, {
      caseId: row.id,
      actorId: guard.user.id,
      actorKind: "user",
      eventType: "CASE_CREATED",
      payload: {
        caseNumber: row.caseNumber,
        specimenType: input.specimenType,
        priority: input.priority,
      },
      occurredAt: now,
    });
    return row;
  });

  revalidateTag(`cases:user:${guard.user.id}`);
  return ok({ id: created.id });
}
