import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { caseEvents } from "@/lib/db/schema";

export const GENESIS_PREV_HASH = "0".repeat(64);

export type ActorKind = "user" | "ai" | "system";

/** A drizzle transaction handle (logEvent must run inside the caller's tx). */
export type Tx = Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

/**
 * Deterministic JSON: object keys sorted recursively so the hash is stable
 * regardless of insertion order. Arrays keep their order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** hash = sha256_hex(prev_hash || '|' || canonical_json(payload) || '|' || occurred_at_ms) */
export function computeHash(
  prevHash: string,
  payload: unknown,
  occurredAtMs: number,
): string {
  return createHash("sha256")
    .update(`${prevHash}|${canonicalJson(payload)}|${occurredAtMs}`)
    .digest("hex");
}

export interface LogEventInput {
  caseId: string;
  actorId: string | null;
  actorKind: ActorKind;
  eventType: string;
  payload?: Record<string, unknown>;
  occurredAt?: number;
}

function isUniqueViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(msg);
}

/**
 * Append a hash-chained audit row inside the caller's transaction. Reads the
 * latest hash for the case, chains onto it, and inserts. If a concurrent write
 * forked the chain (same prev_hash), the UNIQUE(case_id, prev_hash) index
 * rejects it and we re-read + retry up to 3 times (ARCHITECTURE §4.9).
 */
export async function logEvent(tx: Tx, input: LogEventInput) {
  const payload = input.payload ?? {};
  const occurredAt = input.occurredAt ?? Date.now();

  for (let attempt = 0; attempt < 3; attempt++) {
    const [latest] = await tx
      .select({ hash: caseEvents.hash })
      .from(caseEvents)
      .where(eq(caseEvents.caseId, input.caseId))
      .orderBy(desc(caseEvents.occurredAt), desc(caseEvents.id))
      .limit(1);

    const prevHash = latest?.hash ?? GENESIS_PREV_HASH;
    const hash = computeHash(prevHash, payload, occurredAt);

    try {
      const [row] = await tx
        .insert(caseEvents)
        .values({
          caseId: input.caseId,
          actorId: input.actorId,
          actorKind: input.actorKind,
          eventType: input.eventType,
          payloadJson: canonicalJson(payload),
          occurredAt,
          prevHash,
          hash,
        })
        .returning();
      return row;
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 2) continue;
      throw err;
    }
  }
  throw new Error(
    `Failed to append audit event after retries (case ${input.caseId})`,
  );
}
