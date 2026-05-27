import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createId } from "@paralleldrive/cuid2";
import { generateBrief } from "@/lib/ai/brief";
import { embed, searchSimilarCases } from "@/lib/ai/embeddings";
import { hasAnthropic, hasVoyage } from "@/lib/ai/clients";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { caseEvents, cases, users } from "@/lib/db/schema";

let caseId: string;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  await db.delete(caseEvents);
  await db.delete(cases);
  await db.delete(users);
  const [u] = await db
    .insert(users)
    .values({ name: "C", email: `c-${createId()}@x.in`, role: "consultant", active: true })
    .returning();
  const [c] = await db
    .insert(cases)
    .values({
      caseNumber: "AIIMS-PATH-5000-00001",
      patientRef: encrypt("MRN"),
      age: 60,
      sex: "F",
      clinicalHistory: encrypt("history"),
      specimenType: "biopsy",
      priority: "routine",
      status: "assigned",
      assignedTo: u.id,
      consentConfirmed: true,
      consentAt: Date.now(),
      createdBy: u.id,
      aiBriefStatus: "idle",
    })
    .returning();
  caseId = c.id;
});

afterAll(async () => {
  await db.delete(caseEvents);
  await db.delete(cases);
  await db.delete(users);
});

describe("AI graceful degradation (no keys configured)", () => {
  it("test env has no AI keys", () => {
    expect(hasAnthropic()).toBe(false);
    expect(hasVoyage()).toBe(false);
  });

  it("generateBrief sets status=error without throwing when AI is unconfigured", async () => {
    await expect(generateBrief(caseId)).resolves.toBeUndefined();
    const c = await db.query.cases.findFirst({ where: eq(cases.id, caseId) });
    expect(c?.aiBriefStatus).toBe("error");
  });

  it("embed returns null and similarity search returns [] without Voyage", async () => {
    expect(await embed("anything", "query")).toBeNull();
    const results = await searchSimilarCases([0, 0, 0], { id: "x", role: "consultant" }, 5);
    expect(results).toEqual([]);
  });
});
