import { generateText } from "ai";
import { eq } from "drizzle-orm";
import { logEvent } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { cases } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import { BRIEF_TASK, buildCaseContext, GUARDRAILS } from "./prompts";
import { hasAnthropic, model } from "./clients";
import { loadBriefImages } from "./images";

/**
 * Generates the pre-review brief (PRODUCT §10.1, ARCHITECTURE §8.1). Invoked
 * fire-and-forget from assignCase. `generating` status acts as the lock so a
 * second invocation while one is in flight is a no-op. The patient_ref is
 * never read here (PRODUCT §10.7).
 */
export async function generateBrief(caseId: string): Promise<void> {
  const c = await db.query.cases.findFirst({ where: eq(cases.id, caseId) });
  if (!c) return;
  if (c.aiBriefStatus === "generating") return; // already running

  if (!hasAnthropic()) {
    await db.update(cases).set({ aiBriefStatus: "error" }).where(eq(cases.id, caseId));
    return;
  }

  await db.update(cases).set({ aiBriefStatus: "generating" }).where(eq(cases.id, caseId));
  const started = Date.now();

  try {
    const context = buildCaseContext({
      age: c.age,
      sex: c.sex,
      specimenType: c.specimenType,
      priority: c.priority,
      clinicalHistory: decrypt(c.clinicalHistory),
    });
    const imgs = await loadBriefImages(caseId, 4);

    const { text, usage } = await generateText({
      model,
      system: GUARDRAILS,
      maxOutputTokens: 800,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `${context}\n\n${BRIEF_TASK}` },
            ...imgs.map((i) => ({ type: "image" as const, image: i.base64, mediaType: i.mediaType })),
          ],
        },
      ],
    });

    await db
      .update(cases)
      .set({ aiBriefMd: text, aiBriefStatus: "ready", updatedAt: Date.now() })
      .where(eq(cases.id, caseId));

    await db.transaction(async (tx) => {
      await logEvent(tx, {
        caseId,
        actorId: null,
        actorKind: "ai",
        eventType: "AI_BRIEF_GENERATED",
        payload: {
          tokensIn: usage?.inputTokens ?? null,
          tokensOut: usage?.outputTokens ?? null,
          latencyMs: Date.now() - started,
        },
        occurredAt: Date.now(),
      });
    });
  } catch {
    await db.update(cases).set({ aiBriefStatus: "error" }).where(eq(cases.id, caseId));
    await db.transaction(async (tx) => {
      await logEvent(tx, {
        caseId,
        actorId: null,
        actorKind: "ai",
        eventType: "AI_BRIEF_FAILED",
        payload: { latencyMs: Date.now() - started },
        occurredAt: Date.now(),
      });
    });
  }
}
