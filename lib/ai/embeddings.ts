import { sql } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { caseEmbeddings, cases, reports } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { EMBEDDING_DIMS, hasVoyage, VOYAGE_MODEL } from "./clients";

/** Embeds text via Voyage AI. Returns a 1024-dim vector, or null if unconfigured. */
export async function embed(text: string, inputType: "query" | "document"): Promise<number[] | null> {
  if (!hasVoyage()) return null;
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: [text],
      input_type: inputType,
      output_dimension: EMBEDDING_DIMS,
    }),
  });
  if (!res.ok) throw new Error(`Voyage failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data[0]?.embedding ?? null;
}

/** Serializes a vector for libSQL's vector32() function. */
function vec(v: number[]): string {
  return `[${v.join(",")}]`;
}

/**
 * Generates and stores the case embedding on signout (PRODUCT §10.4). Embeds
 * clinical_history || diagnosis || microscopy. No-op if Voyage isn't configured.
 */
export async function generateEmbedding(caseId: string): Promise<void> {
  if (!hasVoyage()) return;
  const c = await db.query.cases.findFirst({ where: eq(cases.id, caseId) });
  if (!c) return;
  const report = await db.query.reports.findFirst({
    where: eq(reports.caseId, caseId),
    orderBy: (r, { desc }) => [desc(r.version)],
  });

  const parts = [decrypt(c.clinicalHistory)];
  if (report) {
    parts.push(report.diagnosis ? decrypt(report.diagnosis) : "");
    parts.push(report.microscopy ? decrypt(report.microscopy) : "");
  }
  const vector = await embed(parts.filter(Boolean).join("\n\n"), "document");
  if (!vector) return;

  await db.run(
    sql`INSERT INTO case_embeddings (case_id, content_kind, embedding, created_at)
        VALUES (${caseId}, 'summary', vector32(${vec(vector)}), ${Date.now()})
        ON CONFLICT(case_id) DO UPDATE SET embedding = vector32(${vec(vector)}), created_at = ${Date.now()}`,
  );
}

export interface SimilarCase {
  caseId: string;
  caseNumber: string;
  distance: number;
}

/**
 * Top-k signed-out cases similar to the query vector, filtered to those the
 * user can access (PRODUCT §10.2, §15.2). Access predicate inlined in SQL.
 */
export async function searchSimilarCases(
  queryVector: number[],
  user: { id: string; role: string },
  k = 5,
): Promise<SimilarCase[]> {
  const accessFilter =
    user.role === "consultant"
      ? sql`c.assigned_to = ${user.id}`
      : user.role === "requester"
        ? sql`c.created_by = ${user.id}`
        : sql`0`; // admins have no content access

  const rows = await db.all<{ case_id: string; case_number: string; d: number }>(
    sql`SELECT e.case_id AS case_id, c.case_number AS case_number,
               vector_distance_cos(e.embedding, vector32(${vec(queryVector)})) AS d
        FROM case_embeddings e
        JOIN cases c ON c.id = e.case_id
        WHERE c.status = 'signed_out' AND (${accessFilter})
        ORDER BY d ASC
        LIMIT ${k}`,
  );
  return rows.map((r) => ({ caseId: r.case_id, caseNumber: r.case_number, distance: r.d }));
}
