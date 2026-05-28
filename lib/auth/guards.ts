import { cache } from "react";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { cases } from "@/lib/db/schema";
import type { Case } from "@/lib/db/schema";
import type { Role } from "@/types/next-auth";

export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
  role: Role;
  active: boolean;
}

/** Per-request memoized session user (ARCHITECTURE §9.2). */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  if (!session?.user?.id) return null;
  return session.user as SessionUser;
});

// ─── Server Action guards (return the ActionResult error shape) ──────────────

type Guard<T> = { ok: true; user: SessionUser; data?: T } | { ok: false; error: { code: string } };

export async function requireActiveUser(): Promise<Guard<never>> {
  const user = await currentUser();
  if (!user) return { ok: false, error: { code: "UNAUTHENTICATED" } };
  if (!user.active) return { ok: false, error: { code: "INACTIVE" } };
  return { ok: true, user };
}

export async function requireRole(...roles: Role[]): Promise<Guard<never>> {
  const result = await requireActiveUser();
  if (!result.ok) return result;
  if (!roles.includes(result.user.role)) {
    return { ok: false, error: { code: "FORBIDDEN" } };
  }
  return result;
}

// ─── Resource guard ──────────────────────────────────────────────────────────

export interface CaseAccess {
  case: Case;
  /** Admins see metadata only; content (history, images, report) must not be
   *  decrypted for them (PRODUCT §2, §13). */
  contentVisible: boolean;
}

/**
 * Resource-level access check (ARCHITECTURE §7). A user can access a case if
 * they created it (requester), are assigned to it (consultant), or are an
 * admin (metadata only). Returns null when access is denied.
 */
export const canUserAccessCase = cache(
  async (userId: string, role: Role, caseId: string): Promise<CaseAccess | null> => {
    const row = await db.query.cases.findFirst({ where: eq(cases.id, caseId) });
    if (!row) return null;

    if (role === "admin") return { case: row, contentVisible: false };
    if (role === "requester" && row.createdBy === userId) {
      return { case: row, contentVisible: true };
    }
    if (role === "consultant" && row.assignedTo === userId) {
      return { case: row, contentVisible: true };
    }
    return null;
  },
);
