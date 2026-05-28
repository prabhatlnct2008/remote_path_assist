import { generateObject } from "ai";
import { z } from "zod";
import { type CaseContext, buildCaseContext, DRAFT_TASK, GUARDRAILS } from "./prompts";
import { hasAnthropic, model } from "./clients";

export const DraftSchema = z.object({
  microscopy: z.string(),
  diagnosis: z.string(),
  differential: z.string(),
  recommendations: z.string(),
  ihc: z.array(
    z.object({
      stain: z.string(),
      result: z.enum(["positive", "negative", "equivocal"]),
      notes: z.string().optional(),
    }),
  ),
});

export type DraftOutput = z.infer<typeof DraftSchema>;

/**
 * Generates a structured report draft (PRODUCT §10.3). No images — uses
 * history, brief, annotation labels, and recent comments. Returns the parsed
 * object plus the raw JSON for audit, or null if AI is unconfigured.
 */
export async function generateDraft(
  ctx: CaseContext,
): Promise<{ data: DraftOutput; rawJson: string; usage?: { inputTokens?: number; outputTokens?: number } } | null> {
  if (!hasAnthropic()) return null;
  const { object, usage } = await generateObject({
    model,
    schema: DraftSchema,
    system: GUARDRAILS,
    prompt: `${buildCaseContext(ctx)}\n\n${DRAFT_TASK}`,
  });
  return { data: object, rawJson: JSON.stringify(object), usage };
}
