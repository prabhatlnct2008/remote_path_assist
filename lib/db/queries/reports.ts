import { cache } from "react";
import { desc, eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { reports } from "@/lib/db/schema";

export interface IhcEntry {
  stain: string;
  result: "positive" | "negative" | "equivocal";
  notes?: string;
}

export interface ReportView {
  id: string;
  version: number;
  status: "draft" | "signed";
  microscopy: string;
  diagnosis: string;
  differential: string;
  recommendations: string;
  additionalNotes: string;
  ihc: IhcEntry[];
  signedAt: number | null;
  updatedAt: number;
}

function dec(v: string): string {
  return v ? decrypt(v) : "";
}

/** Latest report for a case, decrypted (participants only — callers guard). */
export const getLatestReport = cache(async (caseId: string): Promise<ReportView | null> => {
  const r = await db.query.reports.findFirst({
    where: eq(reports.caseId, caseId),
    orderBy: [desc(reports.version)],
  });
  if (!r) return null;
  return {
    id: r.id,
    version: r.version,
    status: r.status,
    microscopy: dec(r.microscopy),
    diagnosis: dec(r.diagnosis),
    differential: dec(r.differential),
    recommendations: dec(r.recommendations),
    additionalNotes: dec(r.bodyMd),
    ihc: safeIhc(r.ihcJson),
    signedAt: r.signedAt,
    updatedAt: r.updatedAt,
  };
});

function safeIhc(json: string): IhcEntry[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
