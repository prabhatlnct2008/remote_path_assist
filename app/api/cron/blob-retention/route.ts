import { and, eq, isNull, lt } from "drizzle-orm";
import { isCronAuthorized } from "@/lib/cron";
import { db } from "@/lib/db/client";
import { cases, images } from "@/lib/db/schema";
import { deleteObject } from "@/lib/storage";

const RETENTION_MS = 8 * 365 * 24 * 60 * 60 * 1000; // 8 years (PRODUCT §11.5 / §19.3)

// Monthly purge of images for signed-out cases past the retention window.
// Audit events are retained indefinitely (never purged).
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new Response("Unauthorized", { status: 401 });
  const cutoff = Date.now() - RETENTION_MS;

  const stale = await db
    .select({ id: images.id, blobUrl: images.blobUrl, blobPathname: images.blobPathname })
    .from(images)
    .innerJoin(cases, eq(cases.id, images.caseId))
    .where(
      and(
        eq(cases.status, "signed_out"),
        lt(cases.signedOutAt, cutoff),
        isNull(images.deletedAt),
      ),
    );

  let purged = 0;
  for (const img of stale) {
    await deleteObject({ url: img.blobUrl, pathname: img.blobPathname });
    await db.update(images).set({ deletedAt: Date.now() }).where(eq(images.id, img.id));
    purged++;
  }

  return Response.json({ ok: true, purged });
}
