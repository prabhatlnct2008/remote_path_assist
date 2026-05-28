import { redirect } from "next/navigation";
import { signOutAction } from "@/actions/auth";
import { Shell } from "@/components/app/Shell";
import { currentUser } from "@/lib/auth/guards";

// Layer 2 of ARCHITECTURE §7: re-validate the session server-side, send
// first-login users to name capture, and block inactive users.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");

  if (!user.name || user.name.trim() === "") {
    redirect("/welcome");
  }

  if (!user.active) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-semibold">Account pending activation</h1>
        <p className="text-sm text-muted-foreground">
          Thanks, {user.name}. Your account is awaiting activation by an
          administrator. You&apos;ll be able to sign in once it&apos;s active.
        </p>
        <form action={signOutAction}>
          <button type="submit" className="text-sm text-primary hover:underline">
            Sign out
          </button>
        </form>
      </main>
    );
  }

  return <Shell user={user}>{children}</Shell>;
}
