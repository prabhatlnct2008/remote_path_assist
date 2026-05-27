import { cache } from "react";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { comments, users } from "@/lib/db/schema";

export interface CommentRow {
  id: string;
  authorId: string | null;
  authorName: string | null;
  actorKind: "user" | "ai";
  body: string;
  parentId: string | null;
  aiMetadata: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  editLockedAt: number | null;
}

export interface CommentThread extends CommentRow {
  replies: CommentRow[];
}

/** Comments for a case as a one-level thread (PRODUCT §7.1). */
export const getCommentThreads = cache(async (caseId: string): Promise<CommentThread[]> => {
  const rows = await db
    .select({
      id: comments.id,
      authorId: comments.authorId,
      authorName: users.name,
      actorKind: comments.actorKind,
      body: comments.body,
      parentId: comments.parentId,
      aiMetadata: comments.aiMetadata,
      createdAt: comments.createdAt,
      updatedAt: comments.updatedAt,
      deletedAt: comments.deletedAt,
      editLockedAt: comments.editLockedAt,
    })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .where(eq(comments.caseId, caseId))
    .orderBy(asc(comments.createdAt));

  const roots: CommentThread[] = [];
  const byId = new Map<string, CommentThread>();
  for (const r of rows) {
    if (!r.parentId) {
      const thread = { ...r, replies: [] as CommentRow[] };
      byId.set(r.id, thread);
      roots.push(thread);
    }
  }
  for (const r of rows) {
    if (r.parentId) byId.get(r.parentId)?.replies.push(r);
  }
  return roots;
});
