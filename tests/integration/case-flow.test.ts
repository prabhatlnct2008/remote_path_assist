import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createId } from "@paralleldrive/cuid2";
import { logEvent } from "@/lib/audit";
import { verifyChain } from "@/lib/audit/verify";
import { decrypt, encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import {
  caseEvents,
  caseSequences,
  cases,
  users,
} from "@/lib/db/schema";

// Runs against file:test.db (set in vitest.config env).
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  // Clean slate, children first.
  await db.delete(caseEvents);
  await db.delete(cases);
  await db.delete(caseSequences);
  await db.delete(users);
});

afterAll(async () => {
  await db.delete(caseEvents);
  await db.delete(cases);
  await db.delete(caseSequences);
  await db.delete(users);
});

async function nextCaseNumber(): Promise<string> {
  const year = new Date().getFullYear();
  return db.transaction(async (tx) => {
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
  });
}

describe("case creation flow (integration)", () => {
  it("generates sequential, zero-padded case numbers", async () => {
    const a = await nextCaseNumber();
    const b = await nextCaseNumber();
    const year = new Date().getFullYear();
    expect(a).toBe(`AIIMS-PATH-${year}-00001`);
    expect(b).toBe(`AIIMS-PATH-${year}-00002`);
  });

  it("creates a case with encrypted PII and a CASE_CREATED audit row", async () => {
    const [requester] = await db
      .insert(users)
      .values({ name: "Dr. R", email: `r-${createId()}@aiims.edu`, role: "requester", active: true })
      .returning();

    const now = Date.now();
    const created = await db.transaction(async (tx) => {
      const caseNumber = await nextCaseNumberTx(tx);
      const [row] = await tx
        .insert(cases)
        .values({
          caseNumber,
          patientRef: encrypt("MRN-7788"),
          age: 54,
          sex: "F",
          clinicalHistory: encrypt("2cm breast mass, ER+/PR+"),
          specimenType: "biopsy",
          priority: "urgent",
          status: "submitted",
          consentConfirmed: true,
          consentAt: now,
          createdBy: requester.id,
        })
        .returning();
      await logEvent(tx, {
        caseId: row.id,
        actorId: requester.id,
        actorKind: "user",
        eventType: "CASE_CREATED",
        payload: { caseNumber: row.caseNumber, specimenType: "biopsy", priority: "urgent" },
        occurredAt: now,
      });
      return row;
    });

    const fetched = await db.query.cases.findFirst({ where: eq(cases.id, created.id) });
    expect(fetched).toBeTruthy();
    // Stored ciphertext is not plaintext; decrypt round-trips.
    expect(fetched!.patientRef).not.toContain("MRN-7788");
    expect(decrypt(fetched!.patientRef)).toBe("MRN-7788");
    expect(decrypt(fetched!.clinicalHistory)).toBe("2cm breast mass, ER+/PR+");

    // Audit payload must not leak PII (PRODUCT §10.6).
    const events = await db.select().from(caseEvents).where(eq(caseEvents.caseId, created.id));
    expect(events).toHaveLength(1);
    expect(events[0].payloadJson).not.toContain("MRN-7788");
    expect(events[0].payloadJson).not.toContain("breast mass");
  });

  it("chains multiple events and verifies the chain", async () => {
    const [u] = await db
      .insert(users)
      .values({ name: "Dr. U", email: `u-${createId()}@aiims.edu`, role: "requester", active: true })
      .returning();
    const [c] = await db
      .insert(cases)
      .values({
        caseNumber: `AIIMS-PATH-9999-00001`,
        patientRef: encrypt("x"),
        age: 1,
        sex: "M",
        clinicalHistory: encrypt("y"),
        specimenType: "biopsy",
        priority: "routine",
        status: "submitted",
        consentConfirmed: true,
        consentAt: Date.now(),
        createdBy: u.id,
      })
      .returning();

    await db.transaction(async (tx) => {
      await logEvent(tx, { caseId: c.id, actorId: u.id, actorKind: "user", eventType: "CASE_CREATED", payload: { a: 1 }, occurredAt: 1000 });
    });
    await db.transaction(async (tx) => {
      await logEvent(tx, { caseId: c.id, actorId: u.id, actorKind: "user", eventType: "IMAGE_UPLOADED", payload: { filename: "slide.tiff" }, occurredAt: 2000 });
    });

    const result = await verifyChain(c.id);
    expect(result.valid).toBe(true);
    expect(result.eventCount).toBe(2);

    // Tamper with a stored payload → verification fails.
    await db
      .update(caseEvents)
      .set({ payloadJson: JSON.stringify({ a: 999 }) })
      .where(eq(caseEvents.caseId, c.id));
    const after = await verifyChain(c.id);
    expect(after.valid).toBe(false);
  });
});

// helper that takes a tx (mirrors actions/cases.ts nextCaseNumber)
async function nextCaseNumberTx(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]): Promise<string> {
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
