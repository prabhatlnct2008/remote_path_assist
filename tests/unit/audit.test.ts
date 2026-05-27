import { describe, expect, it } from "vitest";
import { canonicalJson, computeHash, GENESIS_PREV_HASH } from "@/lib/audit";
import { type ChainEvent, verifyEventChain } from "@/lib/audit/verify";

function buildChain(
  payloads: Array<Record<string, unknown>>,
  startTs = 1_700_000_000_000,
): ChainEvent[] {
  const events: ChainEvent[] = [];
  let prev = GENESIS_PREV_HASH;
  payloads.forEach((payload, i) => {
    const occurredAt = startTs + i * 1000;
    const hash = computeHash(prev, payload, occurredAt);
    events.push({
      id: `evt_${i}`,
      payloadJson: canonicalJson(payload),
      occurredAt,
      prevHash: prev,
      hash,
    });
    prev = hash;
  });
  return events;
}

describe("canonicalJson", () => {
  it("is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ a: { y: 1, x: 2 } })).toBe('{"a":{"x":2,"y":1}}');
  });

  it("preserves array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });
});

describe("hash chain verification", () => {
  it("verifies a valid 3-event chain", () => {
    const events = buildChain([
      { type: "CASE_CREATED", caseNumber: "AIIMS-PATH-2026-00001" },
      { type: "CASE_ASSIGNED", to: "user_x" },
      { type: "REPORT_SIGNED", by: "user_y" },
    ]);
    const result = verifyEventChain(events);
    expect(result.valid).toBe(true);
    expect(result.eventCount).toBe(3);
    expect(result.rootHash).toBe(GENESIS_PREV_HASH);
    expect(result.headHash).toBe(events[2].hash);
    expect(result.firstBreakAt).toBeUndefined();
  });

  it("verifies an empty chain", () => {
    expect(verifyEventChain([]).valid).toBe(true);
  });

  it("detects a mutated payload", () => {
    const events = buildChain([{ type: "A" }, { type: "B" }, { type: "C" }]);
    events[1].payloadJson = canonicalJson({ type: "B", tampered: true });
    const result = verifyEventChain(events);
    expect(result.valid).toBe(false);
    expect(result.firstBreakAt).toBe("evt_1");
  });

  it("detects a broken link (reordered/forged prev_hash)", () => {
    const events = buildChain([{ type: "A" }, { type: "B" }]);
    events[1].prevHash = "f".repeat(64);
    const result = verifyEventChain(events);
    expect(result.valid).toBe(false);
    expect(result.firstBreakAt).toBe("evt_1");
  });
});
