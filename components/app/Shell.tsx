import Link from "next/link";
import { signOutAction } from "@/actions/auth";
import type { SessionUser } from "@/lib/auth/guards";

const ROLE_LABEL: Record<SessionUser["role"], string> = {
  requester: "Requester",
  consultant: "Consultant",
  admin: "Admin",
};

export function Shell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/cases" className="font-semibold tracking-tight">
              PathConsult
            </Link>
            <Link
              href="/cases"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Worklist
            </Link>
            {user.role === "admin" && (
              <>
                <Link href="/admin/users" className="text-sm text-muted-foreground hover:text-foreground">
                  Users
                </Link>
                <Link href="/admin/cases" className="text-sm text-muted-foreground hover:text-foreground">
                  All cases
                </Link>
                <Link href="/admin/system" className="text-sm text-muted-foreground hover:text-foreground">
                  System
                </Link>
              </>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {user.name || user.email}
              <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs">
                {ROLE_LABEL[user.role]}
              </span>
            </span>
            <form action={signOutAction}>
              <button
                type="submit"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Sign out
              </button>
            </form>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
