import { env } from "@/lib/env";

/** Verifies a Vercel Cron request via the Authorization bearer (ARCH §11.3). */
export function isCronAuthorized(req: Request): boolean {
  if (!env.CRON_SECRET) return false; // never run unauthenticated
  return req.headers.get("authorization") === `Bearer ${env.CRON_SECRET}`;
}
