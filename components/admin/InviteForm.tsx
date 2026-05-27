"use client";

import { useActionState, useEffect, useRef } from "react";
import { inviteUser } from "@/actions/admin";
import { ROLES, SUBSPECIALTIES } from "@/lib/constants";

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteUser, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={action}
      className="flex flex-col gap-4 rounded-lg border border-border p-4"
    >
      <h2 className="font-medium">Invite a user</h2>
      <div className="flex flex-wrap gap-3">
        <input
          name="email"
          type="email"
          required
          placeholder="email@aiims.edu"
          className="min-w-56 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <select
          name="role"
          defaultValue="requester"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
        <legend className="mb-1 text-xs text-muted-foreground">
          Subspecialty (optional)
        </legend>
        {SUBSPECIALTIES.map((s) => (
          <label key={s} className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" name="subspecialty" value={s} />
            {s}
          </label>
        ))}
      </fieldset>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send invite"}
        </button>
        {state?.ok && (
          <span className="text-sm text-green-600">Invited {state.data.email}.</span>
        )}
        {state && !state.ok && (
          <span className="text-sm text-red-600">
            {state.error.code === "USER_EXISTS"
              ? state.error.message
              : "Could not send invite. Check the email and try again."}
          </span>
        )}
      </div>
    </form>
  );
}
