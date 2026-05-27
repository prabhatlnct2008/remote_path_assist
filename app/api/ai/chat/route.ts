import { streamText, type ModelMessage } from "ai";
import { hasAnthropic, model } from "@/lib/ai/clients";
import { embed, searchSimilarCases, type SimilarCase } from "@/lib/ai/embeddings";
import { buildCaseContext, CHAT_SYSTEM_PREAMBLE } from "@/lib/ai/prompts";
import { logEvent } from "@/lib/audit";
import { canUserAccessCase, currentUser } from "@/lib/auth/guards";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { comments } from "@/lib/db/schema";

export const maxDuration = 60;

// Case chat (PRODUCT §10.2, ARCHITECTURE §8.2): auth → embed → retrieve →
// build context → stream. Each turn persists Q + A as comments and logs
// AI_CHAT_TURN. Only the assigned consultant may chat.
export async function POST(req: Request): Promise<Response> {
  if (!hasAnthropic()) {
    return new Response("AI is not configured.", { status: 503 });
  }

  const { caseId, messages } = (await req.json()) as {
    caseId: string;
    messages: { role: "user" | "assistant"; content: string }[];
  };

  const user = await currentUser();
  if (!user) return new Response("Unauthenticated", { status: 401 });
  if (user.role !== "consultant") return new Response("Forbidden", { status: 403 });

  const access = await canUserAccessCase(user.id, user.role, caseId);
  if (!access || !access.contentVisible) return new Response("Forbidden", { status: 403 });
  const c = access.case;

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const question = lastUser?.content ?? "";

  // Augment with similar signed-out cases the user can access.
  let similar: SimilarCase[] = [];
  try {
    const qv = await embed(question, "query");
    if (qv) similar = await searchSimilarCases(qv, user, 5);
  } catch {
    // retrieval is best-effort
  }

  const context = buildCaseContext({
    age: c.age,
    sex: c.sex,
    specimenType: c.specimenType,
    priority: c.priority,
    clinicalHistory: decrypt(c.clinicalHistory),
    brief: c.aiBriefMd,
  });
  const similarBlock = similar.length
    ? similar.map((s) => `- [${s.caseNumber}] (cosine distance ${s.distance.toFixed(3)})`).join("\n")
    : "(none found)";
  const system = `${CHAT_SYSTEM_PREAMBLE}\n\n${context}\n\n## Retrieved similar prior cases\n${similarBlock}`;

  const result = streamText({
    model,
    system,
    messages: messages as ModelMessage[],
    async onFinish({ text, usage }) {
      const now = Date.now();
      await db.transaction(async (tx) => {
        await tx.insert(comments).values({
          caseId,
          authorId: user.id,
          actorKind: "user",
          body: question,
          createdAt: now,
          updatedAt: now,
          editLockedAt: now,
        });
        await tx.insert(comments).values({
          caseId,
          authorId: null,
          actorKind: "ai",
          body: text,
          aiMetadata: JSON.stringify({
            model: "chat",
            retrieved_case_ids: similar.map((s) => s.caseId),
            tokens_in: usage?.inputTokens ?? null,
            tokens_out: usage?.outputTokens ?? null,
          }),
          createdAt: now + 1,
          updatedAt: now + 1,
        });
        await logEvent(tx, {
          caseId,
          actorId: null,
          actorKind: "ai",
          eventType: "AI_CHAT_TURN",
          payload: {
            tokensIn: usage?.inputTokens ?? null,
            tokensOut: usage?.outputTokens ?? null,
            retrieved: similar.map((s) => s.caseNumber),
          },
          occurredAt: now + 1,
        });
      });
    },
  });

  return result.toTextStreamResponse();
}
