import { and, eq } from "drizzle-orm";
import { logEvent } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import { cases } from "@/lib/db/schema";
import type { CaseStatus } from "@/lib/constants";

/**
 * Transitions `assigned` → `in_review` the first time the assigned consultant
 * opens the case (PRODUCT §4.5). Idempotent: the WHERE clause guards on the
 * current status so a concurrent/duplicate open is a no-op. Returns the
 * effective status so the caller can render it without a re-read.
 */
export async function maybeOpenCase(
  caseId: string,
  user: SessionUser,
  currentStatus: CaseStatus,
  assignedTo: string | null,
): Promise<CaseStatus> {
  if (currentStatus !== "assigned" || user.role !== "consultant" || assignedTo !== user.id) {
    return currentStatus;
  }
  const now = Date.now();
  const updated = await db
    .update(cases)
    .set({ status: "in_review", updatedAt: now })
    .where(and(eq(cases.id, caseId), eq(cases.status, "assigned")))
    .returning({ id: cases.id });

  if (updated.length > 0) {
    await db.transaction(async (tx) => {
      await logEvent(tx, {
        caseId,
        actorId: user.id,
        actorKind: "user",
        eventType: "CASE_OPENED",
        payload: {},
        occurredAt: now,
      });
    });
  }
  return "in_review";
}
