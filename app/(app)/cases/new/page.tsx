import { redirect } from "next/navigation";
import { CreateCaseForm } from "@/components/case/CreateCaseForm";
import { currentUser } from "@/lib/auth/guards";

export default async function NewCasePage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  // Consultants cannot create cases (PRODUCT §13).
  if (user.role === "consultant") redirect("/cases");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold tracking-tight">New case</h1>
      <CreateCaseForm />
    </div>
  );
}
