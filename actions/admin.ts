"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, fail, ok } from "@/lib/action";
import { requireRole } from "@/lib/auth/guards";
import { INVITE_TTL_MS, ROLES, SUBSPECIALTIES } from "@/lib/constants";
import { db } from "@/lib/db/client";
import { invitations, sessions, users } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";

const InviteInput = z.object({
  email: z.email().transform((s) => s.toLowerCase().trim()),
  role: z.enum(ROLES),
  subspecialty: z.array(z.enum(SUBSPECIALTIES)).default([]),
});

async function sendInviteEmail(email: string) {
  const url = `${env.APP_URL}/login`;
  await sendEmail({
    to: email,
    subject: "You've been invited to PathConsult",
    text: `You've been invited to PathConsult (AIIMS Delhi pathology consultation).\n\nSign in here with this email address: ${url}\n\nA one-time link will be emailed to you each time you sign in.`,
    html: `<p>You've been invited to PathConsult (AIIMS Delhi pathology consultation).</p><p>Sign in with this email address: <a href="${url}">${url}</a></p><p>A one-time link will be emailed to you each time you sign in.</p>`,
  });
}

export async function inviteUser(
  _prev: ActionResult<{ email: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ email: string }>> {
  const guard = await requireRole("admin");
  if (!guard.ok) return fail(guard.error.code);

  const parsed = InviteInput.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
    subspecialty: formData.getAll("subspecialty"),
  });
  if (!parsed.success) return fail("BAD_INPUT", undefined, parsed.error.issues);
  const { email, role, subspecialty } = parsed.data;

  const existingUser = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existingUser) return fail("USER_EXISTS", "A user with that email already exists.");

  const now = Date.now();
  const pending = await db.query.invitations.findFirst({
    where: and(eq(invitations.email, email), isNull(invitations.acceptedAt)),
  });

  if (pending) {
    await db
      .update(invitations)
      .set({ role, subspecialty: subspecialty.join(","), expiresAt: now + INVITE_TTL_MS })
      .where(eq(invitations.id, pending.id));
  } else {
    await db.insert(invitations).values({
      email,
      role,
      subspecialty: subspecialty.join(","),
      invitedBy: guard.user.id,
      expiresAt: now + INVITE_TTL_MS,
    });
  }

  await sendInviteEmail(email);
  revalidatePath("/admin/users");
  return ok({ email });
}

const IdInput = z.object({ userId: z.string().min(1) });

export async function setUserActive(formData: FormData): Promise<void> {
  const guard = await requireRole("admin");
  if (!guard.ok) return;
  const parsed = IdInput.safeParse({ userId: formData.get("userId") });
  if (!parsed.success) return;
  const active = formData.get("active") === "true";

  await db
    .update(users)
    .set({ active, updatedAt: Date.now() })
    .where(eq(users.id, parsed.data.userId));

  // Deactivation revokes existing sessions (PRODUCT §3.3).
  if (!active) {
    await db.delete(sessions).where(eq(sessions.userId, parsed.data.userId));
  }
  revalidatePath("/admin/users");
}

const RoleInput = z.object({ userId: z.string().min(1), role: z.enum(ROLES) });

export async function changeUserRole(formData: FormData): Promise<void> {
  const guard = await requireRole("admin");
  if (!guard.ok) return;
  const parsed = RoleInput.safeParse({
    userId: formData.get("userId"),
    role: formData.get("role"),
  });
  if (!parsed.success) return;
  // An admin cannot change their own role (avoid locking out the last admin).
  if (parsed.data.userId === guard.user.id) return;

  await db
    .update(users)
    .set({ role: parsed.data.role, updatedAt: Date.now() })
    .where(eq(users.id, parsed.data.userId));
  revalidatePath("/admin/users");
}

export async function resendInvite(formData: FormData): Promise<void> {
  const guard = await requireRole("admin");
  if (!guard.ok) return;
  const id = String(formData.get("invitationId") ?? "");
  const invite = await db.query.invitations.findFirst({ where: eq(invitations.id, id) });
  if (!invite || invite.acceptedAt) return;
  await db
    .update(invitations)
    .set({ expiresAt: Date.now() + INVITE_TTL_MS })
    .where(eq(invitations.id, id));
  await sendInviteEmail(invite.email);
  revalidatePath("/admin/users");
}
