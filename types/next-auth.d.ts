import type { DefaultSession } from "next-auth";

export type Role = "requester" | "consultant" | "admin";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      active: boolean;
    } & DefaultSession["user"];
  }
}
