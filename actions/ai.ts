"use server";

import { revalidatePath } from "next/cache";
import { type ActionResult, fail, ok } from "@/lib/action";
import { generateBrief } from "@/lib/ai/brief";
import { canUserAccessCase, requireRole } from "@/lib/auth/guards";

/** Consultant-triggered brief regeneration (PRODUCT §10.1). */
export async function regenerateBrief(formData: FormData): Promise<ActionResult> {
  const guard = await requireRole("consultant");
  if (!guard.ok) return fail(guard.error.code);
  const caseId = String(formData.get("caseId") ?? "");

  const access = await canUserAccessCase(guard.user.id, "consultant", caseId);
  if (!access || access.case.assignedTo !== guard.user.id) return fail("FORBIDDEN");

  void generateBrief(caseId);
  revalidatePath(`/cases/${caseId}`);
  return ok(undefined);
}

/** Void-returning wrapper for use as a plain <form action>. */
export async function regenerateBriefForm(formData: FormData): Promise<void> {
  await regenerateBrief(formData);
}
