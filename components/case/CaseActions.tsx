"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  assignCase,
  flagNeedsMoreMaterial,
  reassignCase,
  unflagNeedsMoreMaterial,
} from "@/actions/workflow";
import type { CaseStatus } from "@/lib/constants";

export interface ConsultantOption {
  id: string;
  name: string;
  subspecialty: string;
}

const btn =
  "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50";
const primaryBtn =
  "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50";

export function CaseActions({
  caseId,
  status,
  role,
  isAssignedConsultant,
  needsMoreMaterial,
  consultants,
}: {
  caseId: string;
  status: CaseStatus;
  role: "requester" | "consultant" | "admin";
  isAssignedConsultant: boolean;
  needsMoreMaterial: boolean;
  consultants: ConsultantOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"assign" | "reassign" | "flag" | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: (fd: FormData) => Promise<{ ok: boolean }>, fd: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await action(fd);
      if (res.ok) {
        setOpen(null);
        router.refresh();
      } else {
        setError("Action failed. Check inputs and permissions.");
      }
    });
  }

  const canAssign = role === "admin" && status === "submitted";
  const canReassign =
    (role === "admin" || isAssignedConsultant) &&
    ["assigned", "in_review", "reported"].includes(status);
  const canFlag = isAssignedConsultant && status !== "signed_out";

  if (!canAssign && !canReassign && !canFlag) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {canAssign && (
          <button className={primaryBtn} onClick={() => setOpen(open === "assign" ? null : "assign")}>
            Assign
          </button>
        )}
        {canReassign && (
          <button className={btn} onClick={() => setOpen(open === "reassign" ? null : "reassign")}>
            Reassign
          </button>
        )}
        {canFlag &&
          (needsMoreMaterial ? (
            <form
              action={(fd) => {
                fd.set("caseId", caseId);
                run(unflagNeedsMoreMaterial, fd);
              }}
            >
              <button className={btn} disabled={pending}>
                Clear "needs material"
              </button>
            </form>
          ) : (
            <button className={btn} onClick={() => setOpen(open === "flag" ? null : "flag")}>
              Mark needs more material
            </button>
          ))}
      </div>

      {open === "assign" && (
        <ConsultantForm
          caseId={caseId}
          consultants={consultants}
          pending={pending}
          submitLabel="Assign"
          onSubmit={(fd) => run(assignCase, fd)}
        />
      )}
      {open === "reassign" && (
        <ConsultantForm
          caseId={caseId}
          consultants={consultants}
          pending={pending}
          submitLabel="Reassign"
          withReason
          onSubmit={(fd) => run(reassignCase, fd)}
        />
      )}
      {open === "flag" && (
        <form
          className="flex flex-col gap-2 rounded-md border border-border p-3"
          action={(fd) => {
            fd.set("caseId", caseId);
            run(flagNeedsMoreMaterial, fd);
          }}
        >
          <textarea
            name="comment"
            required
            rows={2}
            placeholder="e.g. Please send PAS stain on block B2"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button className={primaryBtn} disabled={pending}>
            Request material
          </button>
        </form>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function ConsultantForm({
  caseId,
  consultants,
  pending,
  submitLabel,
  withReason,
  onSubmit,
}: {
  caseId: string;
  consultants: ConsultantOption[];
  pending: boolean;
  submitLabel: string;
  withReason?: boolean;
  onSubmit: (fd: FormData) => void;
}) {
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-border p-3"
      action={(fd) => {
        fd.set("caseId", caseId);
        onSubmit(fd);
      }}
    >
      <select
        name="consultantId"
        required
        defaultValue=""
        className="rounded-md border border-border bg-background px-3 py-2 text-sm"
      >
        <option value="" disabled>
          Select a consultant…
        </option>
        {consultants.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.subspecialty ? ` — ${c.subspecialty}` : ""}
          </option>
        ))}
      </select>
      {withReason && (
        <textarea
          name="reason"
          required
          rows={2}
          placeholder="Reason for reassignment"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      )}
      <button className={primaryBtn} disabled={pending}>
        {submitLabel}
      </button>
    </form>
  );
}
