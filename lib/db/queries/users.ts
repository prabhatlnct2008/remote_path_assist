import { cache } from "react";
import { and, asc, desc, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { invitations, users } from "@/lib/db/schema";

export const getAllUsers = cache(async () => {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      subspecialty: users.subspecialty,
      active: users.active,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.role), asc(users.name));
});

export const getPendingInvitations = cache(async () => {
  return db
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      subspecialty: invitations.subspecialty,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .where(isNull(invitations.acceptedAt))
    .orderBy(desc(invitations.createdAt));
});
