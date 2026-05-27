import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createId } from "@paralleldrive/cuid2";
import { hashSigningPassword, verifySigningPassword } from "@/lib/auth/signing";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { cases, reports, users } from "@/lib/db/schema";
import { getLatestReport } from "@/lib/db/queries/reports";
import { renderReportPdf } from "@/lib/pdf/report";

let caseId: string;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  await db.delete(reports);
  await db.delete(cases);
  await db.delete(users);
  const [u] = await db
    .insert(users)
    .values({ name: "C", email: `c-${createId()}@x.in`, role: "consultant", active: true })
    .returning();
  const [c] = await db
    .insert(cases)
    .values({
      caseNumber: "AIIMS-PATH-6000-00001",
      patientRef: encrypt("MRN"),
      age: 50,
      sex: "F",
      clinicalHistory: encrypt("hx"),
      specimenType: "biopsy",
      priority: "routine",
      status: "reported",
      consentConfirmed: true,
      consentAt: Date.now(),
      createdBy: u.id,
    })
    .returning();
  caseId = c.id;
});

afterAll(async () => {
  await db.delete(reports);
  await db.delete(cases);
  await db.delete(users);
});

describe("signing password (argon2id)", () => {
  it("verifies correct and rejects incorrect", async () => {
    const h = await hashSigningPassword("correct horse battery");
    expect(h).toMatch(/^\$argon2id\$/);
    expect(await verifySigningPassword(h, "correct horse battery")).toBe(true);
    expect(await verifySigningPassword(h, "wrong")).toBe(false);
  });
});

describe("report read decrypts fields", () => {
  it("round-trips encrypted report fields via getLatestReport", async () => {
    await db.insert(reports).values({
      caseId,
      version: 1,
      status: "draft",
      microscopy: encrypt("Cellular spindle-cell lesion."),
      diagnosis: encrypt("Favor benign."),
      differential: encrypt(""),
      recommendations: encrypt(""),
      bodyMd: encrypt("note"),
      ihcJson: JSON.stringify([{ stain: "CD34", result: "positive" }]),
    });
    const r = await getLatestReport(caseId);
    expect(r?.microscopy).toBe("Cellular spindle-cell lesion.");
    expect(r?.diagnosis).toBe("Favor benign.");
    expect(r?.additionalNotes).toBe("note");
    expect(r?.ihc[0]).toEqual({ stain: "CD34", result: "positive" });
  });
});

describe("PDF rendering", () => {
  it("produces a valid PDF buffer", async () => {
    const buf = await renderReportPdf({
      caseNumber: "AIIMS-PATH-6000-00001",
      createdAt: Date.now(),
      signedAt: Date.now(),
      signerName: "Dr. Test",
      signerCredentials: "breast",
      age: 50,
      sex: "F",
      specimenType: "biopsy",
      clinicalHistory: "history",
      microscopy: "micro",
      diagnosis: "dx",
      differential: "",
      recommendations: "",
      additionalNotes: "",
      ihc: [{ stain: "CD34", result: "positive" }],
      audit: { eventCount: 3, rootHash: "0".repeat(64), signerHash: "a".repeat(64) },
    });
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
