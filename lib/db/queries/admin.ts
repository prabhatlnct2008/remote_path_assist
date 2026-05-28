import { cache } from "react";
import { and, count, desc, eq, gte, isNull, like, or, sum } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { caseEvents, cases, images, sessions, users } from "@/lib/db/schema";

export const getAdminCases = cache(async () => {
  return db
    .select({
      id: cases.id,
      caseNumber: cases.caseNumber,
      status: cases.status,
      priority: cases.priority,
      createdAt: cases.createdAt,
      assigneeName: users.name,
    })
    .from(cases)
    .leftJoin(users, eq(users.id, cases.assignedTo))
    .orderBy(desc(cases.createdAt))
    .limit(200);
});

export interface SystemStats {
  activeSessions: number;
  casesByStatus: { status: string; n: number }[];
  storageBytes: number;
  aiEventsThisMonth: number;
  estimatedAiCostUsd: number;
  recentErrors: { eventType: string; caseId: string; occurredAt: number }[];
}

export const getSystemStats = cache(async (): Promise<SystemStats> => {
  const now = Date.now();
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [[sess], byStatus, [storage], [ai], errs] = await Promise.all([
    db.select({ n: count() }).from(sessions).where(gte(sessions.expires, new Date(now))),
    db.select({ status: cases.status, n: count() }).from(cases).groupBy(cases.status),
    db.select({ total: sum(images.sizeBytes) }).from(images).where(isNull(images.deletedAt)),
    db
      .select({ n: count() })
      .from(caseEvents)
      .where(
        and(
          gte(caseEvents.occurredAt, startOfMonth.getTime()),
          like(caseEvents.eventType, "AI_%"),
        ),
      ),
    db
      .select({ eventType: caseEvents.eventType, caseId: caseEvents.caseId, occurredAt: caseEvents.occurredAt })
      .from(caseEvents)
      .where(or(like(caseEvents.eventType, "%FAILED%"), like(caseEvents.eventType, "%LOCKED%")))
      .orderBy(desc(caseEvents.occurredAt))
      .limit(50),
  ]);

  const aiEvents = Number(ai?.n ?? 0);
  return {
    activeSessions: Number(sess?.n ?? 0),
    casesByStatus: byStatus.map((b) => ({ status: b.status, n: Number(b.n) })),
    storageBytes: Number(storage?.total ?? 0),
    aiEventsThisMonth: aiEvents,
    estimatedAiCostUsd: Number((aiEvents * 0.05).toFixed(2)), // rough blended estimate
    recentErrors: errs,
  };
});
