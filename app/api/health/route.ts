import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";

// TEMPORARY (BUILD.md §11): proves the deployed app can reach the DB.
// Remove before production.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const row = await db.get<{ ok: number }>(sql`select 1 as ok`);
    return NextResponse.json({ ok: true, db: row?.ok === 1 ? "up" : "unknown" });
  } catch (err) {
    return NextResponse.json(
      { ok: false, db: "down", error: err instanceof Error ? err.message : "unknown" },
      { status: 503 },
    );
  }
}
