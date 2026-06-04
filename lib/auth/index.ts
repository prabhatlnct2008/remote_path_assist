import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, count, eq, isNull } from "drizzle-orm";
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

// Open sign-in: any valid email may request a magic link. New users are
// created as active `requester`s; admins can promote/demote/deactivate from
// /admin/users. Pending invitations still apply their role and subspecialty
// on first sign-in. (Deviates from PRODUCT §2 invite-only by deployment choice.)

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
      return Boolean(user.email);
    },
    async session({ session, user }) {
      // Database strategy hands us the full row (adapter selects all columns),
      // which would otherwise leak sensitive fields (e.g. signing_password) via
      // the public session endpoint. Rebuild session.user as a strict allowlist.
      const u = user as typeof user & { role: Role; active: boolean };

      // BOOTSTRAP_ADMIN_EMAIL escape hatch: any user signing in with this
      // address is promoted to active admin if they aren't already. Idempotent.
      if (
        env.BOOTSTRAP_ADMIN_EMAIL &&
        u.email.toLowerCase() === env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase() &&
        (u.role !== "admin" || !u.active)
      ) {
        await db
          .update(users)
          .set({ role: "admin", active: true, updatedAt: Date.now() })
          .where(eq(users.id, u.id));
        u.role = "admin";
        u.active = true;
      }

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
    // First magic-link acceptance creates the user. Self-signup users land as
    // active `requester`s (schema default role). If a pending invitation
    // matches the email, copy its role/subspecialty and mark it accepted.
    async createUser({ user }) {
      if (!user.email) return;
      const invite = await db.query.invitations.findFirst({
        where: and(
          eq(invitations.email, user.email),
          isNull(invitations.acceptedAt),
        ),
      });
      const now = Date.now();

      // First user in the system bootstraps as admin (only fires when the
      // adapter has just inserted the one and only row).
      const [{ n }] = await db.select({ n: count() }).from(users);
      const isFirstUser = Number(n) === 1;

      if (invite) {
        await db
          .update(users)
          .set({
            role: invite.role as Role,
            subspecialty: invite.subspecialty,
            active: true,
            updatedAt: now,
          })
          .where(eq(users.id, user.id!));
        await db
          .update(invitations)
          .set({ acceptedAt: now })
          .where(eq(invitations.id, invite.id));
      } else {
        await db
          .update(users)
          .set({
            role: isFirstUser ? "admin" : "requester",
            active: true,
            updatedAt: now,
          })
          .where(eq(users.id, user.id!));
      }
    },
  },
});
