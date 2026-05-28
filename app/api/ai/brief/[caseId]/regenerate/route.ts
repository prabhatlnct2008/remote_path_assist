import { generateBrief } from "@/lib/ai/brief";
import { canUserAccessCase, currentUser } from "@/lib/auth/guards";

// Route-handler form of brief regeneration (ARCHITECTURE §6.8).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  const { caseId } = await params;
  const user = await currentUser();
  if (!user || user.role !== "consultant") {
    return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const access = await canUserAccessCase(user.id, "consultant", caseId);
  if (!access || access.case.assignedTo !== user.id) {
    return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  void generateBrief(caseId);
  return Response.json({ ok: true }, { status: 202 });
}
