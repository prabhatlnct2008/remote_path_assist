import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, eq, isNull } from "drizzle-orm";
import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { db } from "@/lib/db/client";
import {
  accounts,
  invitations,
  sessions,
  users,
  verificationTokens,
} from "@/lib/db/schema";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import type { Role } from "@/types/next-auth";

const MAGIC_LINK_TTL_SECONDS = 15 * 60; // PRODUCT §3.1
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // PRODUCT §3.3 (7-day idle)

/** Invite-only: an email may sign in only if it already has a user, or an
 *  unaccepted, unexpired invitation exists (PRODUCT §2 — no self-signup). */
async function emailIsAllowed(email: string): Promise<boolean> {
  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (existing) return true;

  const invite = await db.query.invitations.findFirst({
    where: and(eq(invitations.email, email), isNull(invitations.acceptedAt)),
  });
  return Boolean(invite && invite.expiresAt > Date.now());
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  secret: env.AUTH_SECRET,
  trustHost: true,
  session: { strategy: "database", maxAge: SESSION_TTL_SECONDS, updateAge: 24 * 60 * 60 },
  pages: { signIn: "/login", verifyRequest: "/verify", error: "/login" },
  providers: [
    Resend({
      apiKey: env.RESEND_API_KEY || "re_dev_placeholder",
      from: env.EMAIL_FROM,
      maxAge: MAGIC_LINK_TTL_SECONDS,
      async sendVerificationRequest({ identifier, url }) {
        await sendEmail({
          to: identifier,
          subject: "Your PathConsult login link",
          text: `Sign in to PathConsult:\n\n${url}\n\nThis link expires in 15 minutes. If you didn't request it, ignore this email.`,
          html: `<p>Sign in to PathConsult:</p><p><a href="${url}">${url}</a></p><p>This link expires in 15 minutes. If you didn't request it, ignore this email.</p>`,
        });
      },
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      return user.email ? emailIsAllowed(user.email) : false;
    },
    async session({ session, user }) {
      // Database strategy hands us the full row (adapter selects all columns),
      // which would otherwise leak sensitive fields (e.g. signing_password) via
      // the public session endpoint. Rebuild session.user as a strict allowlist.
      const u = user as typeof user & { role: Role; active: boolean };
      session.user = {
        id: u.id,
        email: u.email,
        emailVerified: u.emailVerified ?? null,
        name: u.name,
        image: u.image,
        role: u.role,
        active: u.active,
      };
      return session;
    },
  },
  events: {
    // First magic-link acceptance creates the user; copy role/subspecialty from
    // the invitation and mark it accepted. The user stays inactive until an
    // admin activates them (PRODUCT §2).
    async createUser({ user }) {
      if (!user.email) return;
      const invite = await db.query.invitations.findFirst({
        where: and(
          eq(invitations.email, user.email),
          isNull(invitations.acceptedAt),
        ),
      });
      if (!invite) return;
      const now = Date.now();
      await db
        .update(users)
        .set({ role: invite.role as Role, subspecialty: invite.subspecialty, updatedAt: now })
        .where(eq(users.id, user.id!));
      await db
        .update(invitations)
        .set({ acceptedAt: now })
        .where(eq(invitations.id, invite.id));
    },
  },
});
