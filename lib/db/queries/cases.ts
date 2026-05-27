import { cache } from "react";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { cases } from "@/lib/db/schema";
import type { Role } from "@/types/next-auth";

const PAGE_SIZE = 50; // PRODUCT §4.8

// Priority ordering: STAT first, then urgent, then routine (PRODUCT §4.8).
const priorityRank = sql`case ${cases.priority} when 'stat' then 0 when 'urgent' then 1 else 2 end`;

export interface WorklistRow {
  id: string;
  caseNumber: string;
  age: number;
  sex: "M" | "F" | "Other";
  specimenType: string;
  priority: "routine" | "urgent" | "stat";
  status: "submitted" | "assigned" | "in_review" | "reported" | "signed_out";
  needsMoreMaterial: boolean;
  slaDueAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Worklist scoped by role (PRODUCT §4.8): requesters see cases they created,
 * consultants see cases assigned to them, admins see all. Patient content is
 * never selected here — the worklist shows metadata only.
 */
export const getWorklist = cache(
  async (userId: string, role: Role, page = 0): Promise<WorklistRow[]> => {
    const cols = {
      id: cases.id,
      caseNumber: cases.caseNumber,
      age: cases.age,
      sex: cases.sex,
      specimenType: cases.specimenType,
      priority: cases.priority,
      status: cases.status,
      needsMoreMaterial: cases.needsMoreMaterial,
      slaDueAt: cases.slaDueAt,
      createdAt: cases.createdAt,
      updatedAt: cases.updatedAt,
    };

    const base = db.select(cols).from(cases);
    const scoped =
      role === "requester"
        ? base.where(eq(cases.createdBy, userId))
        : role === "consultant"
          ? base.where(eq(cases.assignedTo, userId))
          : base;

    return scoped
      .orderBy(priorityRank, desc(cases.createdAt))
      .limit(PAGE_SIZE)
      .offset(page * PAGE_SIZE);
  },
);
