import { cache } from "react";
import { and, asc, desc, eq, inArray, isNull, like, sql, type SQL } from "drizzle-orm";
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

export interface WorklistFilters {
  search?: string;
  statuses?: string[];
  priorities?: string[];
  needsMore?: boolean;
  page?: number;
}

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

/**
 * Worklist scoped by role (PRODUCT §4.8): requesters see cases they created,
 * consultants see cases assigned to them, admins see all. Metadata only.
 * Search matches the case number; for admins it also matches the (decrypted)
 * patient ref — O(n) decrypt-on-read, acceptable at pilot volume (ARCH §5).
 */
export const getWorklist = cache(
  async (userId: string, role: Role, filters: WorklistFilters = {}): Promise<WorklistRow[]> => {
    const page = filters.page ?? 0;
    const conds: SQL[] = [];
    if (role === "requester") conds.push(eq(cases.createdBy, userId));
    else if (role === "consultant") conds.push(eq(cases.assignedTo, userId));
    if (filters.statuses?.length) {
      conds.push(inArray(cases.status, filters.statuses as Case["status"][]));
    }
    if (filters.priorities?.length) {
      conds.push(inArray(cases.priority, filters.priorities as Case["priority"][]));
    }
    if (filters.needsMore) conds.push(eq(cases.needsMoreMaterial, true));

    const q = filters.search?.trim();

    // Admin patient-ref search needs decrypt-on-read: fetch a capped set, then
    // filter in JS by case number or decrypted patient ref.
    if (q && role === "admin") {
      const rows = await db
        .select({ ...cols, patientRef: cases.patientRef })
        .from(cases)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(priorityRank, desc(cases.createdAt))
        .limit(500);
      const needle = q.toLowerCase();
      const matched = rows.filter((r) => {
        if (r.caseNumber.toLowerCase().includes(needle)) return true;
        try {
          return decrypt(r.patientRef).toLowerCase().includes(needle);
        } catch {
          return false;
        }
      });
      return matched
        .slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
        .map(({ patientRef: _omit, ...rest }) => rest);
    }

    if (q) conds.push(like(cases.caseNumber, `%${q}%`));

    return db
      .select(cols)
      .from(cases)
      .where(conds.length ? and(...conds) : undefined)
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
