"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { signIn, signOut } from "@/lib/auth";
import { currentUser } from "@/lib/auth/guards";

const Email = z.email();

/** Issues a magic link. On success Auth.js redirects to the verify page; if the
 *  email isn't invited, the signIn callback denies and redirects to /login. */
export async function signInWithEmail(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!Email.safeParse(email).success) {
    redirect("/login?error=InvalidEmail");
  }
  try {
    await signIn("resend", { email, redirectTo: "/cases" });
  } catch (err) {
    // AuthError → show a friendly message; anything else (incl. the redirect
    // signIn throws on success) must propagate.
    if (err instanceof AuthError) {
      redirect(`/login?error=${encodeURIComponent(err.type)}`);
    }
    throw err;
  }
}

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}

/** First-login name capture (PRODUCT §3.2). */
export async function setName(formData: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 120) {
    redirect("/welcome?error=NameRequired");
  }
  await db
    .update(users)
    .set({ name, updatedAt: Date.now() })
    .where(eq(users.id, user.id));
  redirect("/cases");
}
