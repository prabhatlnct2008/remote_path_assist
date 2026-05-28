import { changeUserRole, resendInvite, setUserActive } from "@/actions/admin";
import { InviteForm } from "@/components/admin/InviteForm";
import { currentUser } from "@/lib/auth/guards";
import { ROLES } from "@/lib/constants";
import { getAllUsers, getPendingInvitations } from "@/lib/db/queries/users";

export default async function AdminUsersPage() {
  const me = await currentUser();
  const [users, invites] = await Promise.all([
    getAllUsers(),
    getPendingInvitations(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold tracking-tight">Users</h1>

      <InviteForm />

      {invites.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">Pending invitations</h2>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {invites.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span>
                  {inv.email}{" "}
                  <span className="text-muted-foreground">· {inv.role}</span>
                </span>
                <form action={resendInvite}>
                  <input type="hidden" name="invitationId" value={inv.id} />
                  <button className="text-primary hover:underline">Resend</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">All users ({users.length})</h2>
        {users.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
            Invite the first user to get started.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {users.map((u) => {
              const isSelf = u.id === me?.id;
              return (
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-48">
                    <div className="font-medium">{u.name || "(no name yet)"}</div>
                    <div className="text-muted-foreground">{u.email}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        u.active
                          ? "bg-green-100 text-green-800"
                          : "bg-zinc-100 text-zinc-600"
                      }`}
                    >
                      {u.active ? "active" : "inactive"}
                    </span>

                    <form action={changeUserRole} className="flex items-center gap-1">
                      <input type="hidden" name="userId" value={u.id} />
                      <select
                        name="role"
                        defaultValue={u.role}
                        disabled={isSelf}
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs disabled:opacity-50"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      {!isSelf && (
                        <button className="text-xs text-primary hover:underline">
                          Update
                        </button>
                      )}
                    </form>

                    {!isSelf && (
                      <form action={setUserActive}>
                        <input type="hidden" name="userId" value={u.id} />
                        <input type="hidden" name="active" value={u.active ? "false" : "true"} />
                        <button className="text-xs text-primary hover:underline">
                          {u.active ? "Deactivate" : "Activate"}
                        </button>
                      </form>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
