import { inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { cases, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export interface Participant {
  id: string;
  name: string;
  email: string;
  handle: string; // email local-part, used for @mentions
}

/** Case participants: the creator and the current assignee (PRODUCT §7.3, §12). */
export async function getParticipants(caseId: string): Promise<Participant[]> {
  const c = await db.query.cases.findFirst({ where: eq(cases.id, caseId) });
  if (!c) return [];
  const ids = [c.createdBy, c.assignedTo].filter(Boolean) as string[];
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, ids));
  return rows.map((r) => ({ ...r, handle: r.email.split("@")[0].toLowerCase() }));
}

/** Resolves @handle mentions in a comment body to participant users. */
export function resolveMentions(body: string, participants: Participant[]): Participant[] {
  const handles = new Set(
    [...body.matchAll(/@([a-zA-Z0-9._-]+)/g)].map((m) => m[1].toLowerCase()),
  );
  return participants.filter((p) => handles.has(p.handle));
}
