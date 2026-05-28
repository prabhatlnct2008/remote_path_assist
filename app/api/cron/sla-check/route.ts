import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { isCronAuthorized } from "@/lib/cron";
import { db } from "@/lib/db/client";
import { cases, users } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";

const HOUR = 60 * 60 * 1000;
const ACTIVE_STATUSES = ["assigned", "in_review", "reported"] as const;

// Hourly SLA sweep (ARCHITECTURE §11.3, PRODUCT §12). Emails the assigned
// consultant ~1h before breach and the consultant + admins on breach.
// NOTE: dedupe of repeated reminders is a refinement (would need a sent-flag).
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new Response("Unauthorized", { status: 401 });
  const now = Date.now();

  const active = await db
    .select({
      id: cases.id,
      caseNumber: cases.caseNumber,
      slaDueAt: cases.slaDueAt,
      assignedTo: cases.assignedTo,
    })
    .from(cases)
    .where(and(inArray(cases.status, ACTIVE_STATUSES), isNotNull(cases.slaDueAt)));

  const admins = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.active, true)));

  let approaching = 0;
  let breached = 0;

  for (const c of active) {
    if (c.slaDueAt == null || !c.assignedTo) continue;
    const consultant = await db.query.users.findFirst({ where: eq(users.id, c.assignedTo) });
    if (!consultant) continue;
    const link = `${env.APP_URL}/cases/${c.id}`;

    if (c.slaDueAt < now) {
      breached++;
      const recipients = [consultant.email, ...admins.map((a) => a.email)];
      for (const to of new Set(recipients)) {
        await sendEmail({
          to,
          subject: `SLA breached on case ${c.caseNumber}`,
          text: `The SLA for ${c.caseNumber} has been breached.\n\n${link}`,
          html: `<p>The SLA for <strong>${c.caseNumber}</strong> has been breached.</p><p><a href="${link}">Open case</a></p>`,
        });
      }
    } else if (c.slaDueAt - now <= HOUR) {
      approaching++;
      await sendEmail({
        to: consultant.email,
        subject: `Case ${c.caseNumber} SLA approaches`,
        text: `The SLA for ${c.caseNumber} is within the hour.\n\n${link}`,
        html: `<p>The SLA for <strong>${c.caseNumber}</strong> is within the hour.</p><p><a href="${link}">Open case</a></p>`,
      });
    }
  }

  return Response.json({ ok: true, checked: active.length, approaching, breached });
}
