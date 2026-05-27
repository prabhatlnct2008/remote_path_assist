import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { caseEvents } from "@/lib/db/schema";
import { computeHash, GENESIS_PREV_HASH } from "./index";

export interface ChainEvent {
  id: string;
  payloadJson: string;
  occurredAt: number;
  prevHash: string;
  hash: string;
}

export interface VerifyResult {
  valid: boolean;
  eventCount: number;
  /** Id of the first event whose link or hash fails, if any. */
  firstBreakAt?: string;
  rootHash: string | null;
  headHash: string | null;
}

/**
 * Pure forward verification: each event must chain onto the previous hash
 * (genesis = 64 zeros) and its stored hash must equal the recomputed hash.
 */
export function verifyEventChain(events: ChainEvent[]): VerifyResult {
  let expectedPrev = GENESIS_PREV_HASH;
  for (const e of events) {
    if (e.prevHash !== expectedPrev) {
      return {
        valid: false,
        eventCount: events.length,
        firstBreakAt: e.id,
        rootHash: events[0]?.prevHash ?? null,
        headHash: null,
      };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(e.payloadJson);
    } catch {
      return breakAt(e, events);
    }
    if (computeHash(e.prevHash, payload, e.occurredAt) !== e.hash) {
      return breakAt(e, events);
    }
    expectedPrev = e.hash;
  }
  return {
    valid: true,
    eventCount: events.length,
    firstBreakAt: undefined,
    rootHash: events.length ? GENESIS_PREV_HASH : null,
    headHash: events.length ? events[events.length - 1].hash : null,
  };
}

function breakAt(e: ChainEvent, events: ChainEvent[]): VerifyResult {
  return {
    valid: false,
    eventCount: events.length,
    firstBreakAt: e.id,
    rootHash: events[0]?.prevHash ?? null,
    headHash: null,
  };
}

/** Loads a case's events in chain order and verifies them. */
export async function verifyChain(caseId: string): Promise<VerifyResult> {
  const events = await db
    .select({
      id: caseEvents.id,
      payloadJson: caseEvents.payloadJson,
      occurredAt: caseEvents.occurredAt,
      prevHash: caseEvents.prevHash,
      hash: caseEvents.hash,
    })
    .from(caseEvents)
    .where(eq(caseEvents.caseId, caseId))
    .orderBy(asc(caseEvents.occurredAt), asc(caseEvents.id));

  return verifyEventChain(events);
}
