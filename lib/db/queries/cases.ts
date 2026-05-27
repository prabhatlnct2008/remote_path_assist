import { cache } from "react";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { canUserAccessCase, type SessionUser } from "@/lib/auth/guards";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { cases, images, users } from "@/lib/db/schema";
import type { Case } from "@/lib/db/schema";
import type { Role } from "@/types/next-auth";

const MASKED = "•••••• (restricted)";

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

export interface CaseView {
  case: Case;
  contentVisible: boolean;
  patientRefDisplay: string;
  clinicalHistory: string | null;
  createdByName: string | null;
  assignedToName: string | null;
}

/**
 * Loads a case for a user with content access applied (PRODUCT §4.1, §13):
 * participants get decrypted patient_ref + clinical_history; admins get a
 * masked ref and no clinical history (we never decrypt in admin context,
 * ARCHITECTURE §7). Returns null when the user has no access.
 */
export const getCaseView = cache(
  async (user: SessionUser, caseId: string): Promise<CaseView | null> => {
    const access = await canUserAccessCase(user.id, user.role, caseId);
    if (!access) return null;
    const c = access.case;

    const ids = [c.createdBy, c.assignedTo].filter(Boolean) as string[];
    const named = ids.length
      ? await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(sql`${users.id} in ${ids}`)
      : [];
    const nameOf = (id: string | null) =>
      id ? (named.find((n) => n.id === id)?.name ?? null) : null;

    return {
      case: c,
      contentVisible: access.contentVisible,
      patientRefDisplay: access.contentVisible ? decrypt(c.patientRef) : MASKED,
      clinicalHistory: access.contentVisible ? decrypt(c.clinicalHistory) : null,
      createdByName: nameOf(c.createdBy),
      assignedToName: nameOf(c.assignedTo),
    };
  },
);

export interface ImageRow {
  id: string;
  filename: string;
  blobUrl: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploaderName: string | null;
  uploadedAt: number;
}

/** Non-deleted images for a case, oldest first (PRODUCT §5.3). */
export const getCaseImages = cache(async (caseId: string): Promise<ImageRow[]> => {
  return db
    .select({
      id: images.id,
      filename: images.filename,
      blobUrl: images.blobUrl,
      contentType: images.contentType,
      sizeBytes: images.sizeBytes,
      uploadedBy: images.uploadedBy,
      uploaderName: users.name,
      uploadedAt: images.uploadedAt,
    })
    .from(images)
    .leftJoin(users, eq(users.id, images.uploadedBy))
    .where(and(eq(images.caseId, caseId), isNull(images.deletedAt)))
    .orderBy(asc(images.uploadedAt));
});
