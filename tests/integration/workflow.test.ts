import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createId } from "@paralleldrive/cuid2";
import { verifyChain } from "@/lib/audit/verify";
import type { SessionUser } from "@/lib/auth/guards";
import { maybeOpenCase } from "@/lib/cases/transitions";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { caseEvents, cases, comments, users } from "@/lib/db/schema";
import { getCommentThreads } from "@/lib/db/queries/comments";

let consultant: SessionUser;
let requester: SessionUser;
let caseId: string;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  await db.delete(caseEvents);
  await db.delete(comments);
  await db.delete(cases);
  await db.delete(users);

  const [con] = await db
    .insert(users)
    .values({ name: "Con", email: `con-${createId()}@x.in`, role: "consultant", active: true })
    .returning();
  const [req] = await db
    .insert(users)
    .values({ name: "Req", email: `req-${createId()}@x.in`, role: "requester", active: true })
    .returning();
  consultant = { id: con.id, email: con.email, role: "consultant", active: true };
  requester = { id: req.id, email: req.email, role: "requester", active: true };

  const [c] = await db
    .insert(cases)
    .values({
      caseNumber: "AIIMS-PATH-4000-00001",
      patientRef: encrypt("MRN"),
      age: 50,
      sex: "M",
      clinicalHistory: encrypt("hx"),
      specimenType: "biopsy",
      priority: "routine",
      status: "assigned",
      assignedTo: con.id,
      assignedAt: Date.now(),
      consentConfirmed: true,
      consentAt: Date.now(),
      createdBy: req.id,
    })
    .returning();
  caseId = c.id;
});

afterAll(async () => {
  await db.delete(caseEvents);
  await db.delete(comments);
  await db.delete(cases);
  await db.delete(users);
});

describe("status machine: open transition", () => {
  it("transitions assigned → in_review on first open by the assigned consultant", async () => {
    const status = await maybeOpenCase(caseId, consultant, "assigned", consultant.id);
    expect(status).toBe("in_review");
    const c = await db.query.cases.findFirst({ where: eq(cases.id, caseId) });
    expect(c?.status).toBe("in_review");
    const events = await db.select().from(caseEvents).where(eq(caseEvents.caseId, caseId));
    expect(events.map((e) => e.eventType)).toContain("CASE_OPENED");
    expect((await verifyChain(caseId)).valid).toBe(true);
  });

  it("does not transition for a non-assigned user", async () => {
    // requester opening an 'assigned' case is a no-op
    const status = await maybeOpenCase(caseId, requester, "assigned", consultant.id);
    expect(status).toBe("assigned");
  });

  it("is idempotent — a second open logs no new CASE_OPENED", async () => {
    const before = (await db.select().from(caseEvents).where(eq(caseEvents.caseId, caseId))).length;
    await maybeOpenCase(caseId, consultant, "assigned", consultant.id); // status already in_review in DB
    const after = (await db.select().from(caseEvents).where(eq(caseEvents.caseId, caseId))).length;
    expect(after).toBe(before);
  });
});

describe("comment threading (1 level)", () => {
  it("nests replies under their root", async () => {
    const now = Date.now();
    const [root] = await db
      .insert(comments)
      .values({ caseId, authorId: requester.id, actorKind: "user", body: "root", createdAt: now, updatedAt: now })
      .returning();
    await db
      .insert(comments)
      .values({ caseId, authorId: consultant.id, actorKind: "user", body: "reply", parentId: root.id, createdAt: now + 1, updatedAt: now + 1 });
    await db
      .insert(comments)
      .values({ caseId, authorId: null, actorKind: "ai", body: "ai note", createdAt: now + 2, updatedAt: now + 2 });

    const threads = await getCommentThreads(caseId);
    expect(threads).toHaveLength(2); // root + ai (both top-level)
    const rootThread = threads.find((t) => t.body === "root");
    expect(rootThread?.replies.map((r) => r.body)).toEqual(["reply"]);
    expect(threads.some((t) => t.actorKind === "ai")).toBe(true);
  });
});
