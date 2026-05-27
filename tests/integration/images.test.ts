import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createId } from "@paralleldrive/cuid2";

// registerImage calls revalidateTag, which needs a request scope we don't have.
vi.mock("next/cache", () => ({ revalidateTag: () => {}, revalidatePath: () => {} }));
// guards imports next-auth (pulls in next/server, unresolvable here); the
// resource guard under test takes explicit args and doesn't use the session.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));

import { verifyChain } from "@/lib/audit/verify";
import type { SessionUser } from "@/lib/auth/guards";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { caseEvents, cases, images, users } from "@/lib/db/schema";
import { checkCanUpload, registerImage } from "@/lib/images";

let requester: SessionUser;
let consultant: SessionUser;
let caseId: string;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  await db.delete(caseEvents);
  await db.delete(images);
  await db.delete(cases);
  await db.delete(users);

  const [r] = await db
    .insert(users)
    .values({ name: "Req", email: `req-${createId()}@x.in`, role: "requester", active: true })
    .returning();
  const [c2] = await db
    .insert(users)
    .values({ name: "Con", email: `con-${createId()}@x.in`, role: "consultant", active: true })
    .returning();
  requester = { id: r.id, email: r.email, role: "requester", active: true };
  consultant = { id: c2.id, email: c2.email, role: "consultant", active: true };

  const [c] = await db
    .insert(cases)
    .values({
      caseNumber: `AIIMS-PATH-3000-00001`,
      patientRef: encrypt("MRN"),
      age: 40,
      sex: "F",
      clinicalHistory: encrypt("hx"),
      specimenType: "biopsy",
      priority: "routine",
      status: "submitted",
      needsMoreMaterial: true,
      consentConfirmed: true,
      consentAt: Date.now(),
      createdBy: r.id,
    })
    .returning();
  caseId = c.id;
});

afterAll(async () => {
  await db.delete(caseEvents);
  await db.delete(images);
  await db.delete(cases);
  await db.delete(users);
});

describe("image upload authorization + registration", () => {
  it("allows the case owner to upload", async () => {
    expect(await checkCanUpload(requester, caseId)).toEqual({ ok: true });
  });

  it("denies a non-participant consultant", async () => {
    expect(await checkCanUpload(consultant, caseId)).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("registers an image, clears needs_more_material, and logs IMAGE_UPLOADED", async () => {
    const { id } = await registerImage({
      caseId,
      filename: "slide.png",
      blobUrl: "/api/files/x/slide.png",
      blobPathname: "x/slide.png",
      contentType: "image/png",
      sizeBytes: 1234,
      uploadedBy: requester.id,
    });

    const img = await db.query.images.findFirst({ where: eq(images.id, id) });
    expect(img?.filename).toBe("slide.png");

    const c = await db.query.cases.findFirst({ where: eq(cases.id, caseId) });
    expect(c?.needsMoreMaterial).toBe(false);

    const events = await db.select().from(caseEvents).where(eq(caseEvents.caseId, caseId));
    expect(events.map((e) => e.eventType)).toContain("IMAGE_UPLOADED");
    expect((await verifyChain(caseId)).valid).toBe(true);
  });

  it("denies uploads once the case is locked (signed_out)", async () => {
    await db.update(cases).set({ status: "signed_out" }).where(eq(cases.id, caseId));
    expect(await checkCanUpload(requester, caseId)).toEqual({ ok: false, code: "STATUS_LOCKED" });
  });
});
