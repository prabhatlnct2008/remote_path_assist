import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/guards";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  if (!user || user.role !== "admin") redirect("/cases");
  return <>{children}</>;
}
