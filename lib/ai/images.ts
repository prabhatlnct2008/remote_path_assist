import sharp from "sharp";
import { asc, eq, isNull, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { images } from "@/lib/db/schema";
import { env } from "@/lib/env";

export interface BriefImage {
  mediaType: string;
  base64: string;
}

function absoluteUrl(url: string): string {
  return url.startsWith("http") ? url : `${env.APP_URL}${url}`;
}

/**
 * Loads up to `max` representative images (the first uploaded), downscaled to
 * 1024px on the longest edge as JPEG to bound Anthropic token cost
 * (BUILD.md §8, PRODUCT §10.1). Failures are skipped, not fatal.
 */
export async function loadBriefImages(caseId: string, max = 4): Promise<BriefImage[]> {
  const rows = await db
    .select({ blobUrl: images.blobUrl })
    .from(images)
    .where(and(eq(images.caseId, caseId), isNull(images.deletedAt)))
    .orderBy(asc(images.uploadedAt))
    .limit(max);

  const out: BriefImage[] = [];
  for (const r of rows) {
    try {
      const res = await fetch(absoluteUrl(r.blobUrl));
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const jpeg = await sharp(buf)
        .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      out.push({ mediaType: "image/jpeg", base64: jpeg.toString("base64") });
    } catch {
      // skip unreadable image
    }
  }
  return out;
}
