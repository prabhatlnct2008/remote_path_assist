import { cache } from "react";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { annotations, users } from "@/lib/db/schema";

export interface AnnotationRow {
  id: string;
  imageId: string;
  authorId: string;
  authorName: string | null;
  geometryJson: string;
  label: string | null;
  color: string;
  createdAt: number;
  updatedAt: number;
}

/** Non-deleted annotations for an image (PRODUCT §6.4). */
export const getAnnotations = cache(async (imageId: string): Promise<AnnotationRow[]> => {
  return db
    .select({
      id: annotations.id,
      imageId: annotations.imageId,
      authorId: annotations.authorId,
      authorName: users.name,
      geometryJson: annotations.geometryJson,
      label: annotations.label,
      color: annotations.color,
      createdAt: annotations.createdAt,
      updatedAt: annotations.updatedAt,
    })
    .from(annotations)
    .leftJoin(users, eq(users.id, annotations.authorId))
    .where(and(eq(annotations.imageId, imageId), isNull(annotations.deletedAt)))
    .orderBy(asc(annotations.createdAt));
});
