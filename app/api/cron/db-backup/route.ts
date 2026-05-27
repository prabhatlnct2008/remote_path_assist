import { isCronAuthorized } from "@/lib/cron";
import { db } from "@/lib/db/client";
import {
  annotations,
  caseEvents,
  cases,
  comments,
  images,
  invitations,
  reports,
  users,
} from "@/lib/db/schema";
import { putObject } from "@/lib/storage";

// Nightly logical backup (ARCHITECTURE §11.3/§11.5). Dumps tables to JSON and
// stores it via the storage layer. A physical Turso dump is preferable in
// production; this app-level export is a portable fallback.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new Response("Unauthorized", { status: 401 });

  const [
    usersRows,
    casesRows,
    imagesRows,
    annotationsRows,
    commentsRows,
    reportsRows,
    eventsRows,
    invitationsRows,
  ] = await Promise.all([
    db.select().from(users),
    db.select().from(cases),
    db.select().from(images),
    db.select().from(annotations),
    db.select().from(comments),
    db.select().from(reports),
    db.select().from(caseEvents),
    db.select().from(invitations),
  ]);

  const dump = {
    takenAt: Date.now(),
    tables: {
      users: usersRows,
      cases: casesRows,
      images: imagesRows,
      annotations: annotationsRows,
      comments: commentsRows,
      reports: reportsRows,
      caseEvents: eventsRows,
      invitations: invitationsRows,
    },
  };

  const day = new Date().toISOString().slice(0, 10);
  const { url } = await putObject(
    `backups/pathconsult-${day}.json`,
    Buffer.from(JSON.stringify(dump)),
    "application/json",
  );

  return Response.json({ ok: true, url, rows: casesRows.length });
}
