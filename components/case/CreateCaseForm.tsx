"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo } from "react";
import { createCase } from "@/actions/cases";
import { PRIORITIES, SPECIMEN_TYPES } from "@/lib/constants";

const field = "rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";
const labelCls = "text-sm font-medium";

export function CreateCaseForm() {
  const router = useRouter();
  const [state, action, pending] = useActionState(createCase, null);

  const errors = useMemo(() => {
    const m: Record<string, string> = {};
    if (state && !state.ok && state.error.issues) {
      for (const issue of state.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !m[key]) m[key] = issue.message;
      }
    }
    return m;
  }, [state]);

  useEffect(() => {
    if (state?.ok) router.push(`/cases/${state.data.id}`);
  }, [state, router]);

  return (
    <form action={action} className="flex max-w-xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <label htmlFor="patientRef" className={labelCls}>
          Patient MRN
        </label>
        <input id="patientRef" name="patientRef" maxLength={64} required className={field} />
        {errors.patientRef && <p className="text-sm text-red-600">{errors.patientRef}</p>}
      </div>

      <div className="flex gap-4">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="age" className={labelCls}>
            Age (years)
          </label>
          <input id="age" name="age" type="number" min={0} max={120} required className={field} />
          {errors.age && <p className="text-sm text-red-600">{errors.age}</p>}
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="sex" className={labelCls}>
            Sex
          </label>
          <select id="sex" name="sex" required defaultValue="" className={field}>
            <option value="" disabled>
              Select…
            </option>
            <option value="M">M</option>
            <option value="F">F</option>
            <option value="Other">Other</option>
          </select>
          {errors.sex && <p className="text-sm text-red-600">{errors.sex}</p>}
        </div>
      </div>

      <div className="flex gap-4">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="specimenType" className={labelCls}>
            Specimen type
          </label>
          <select id="specimenType" name="specimenType" required defaultValue="" className={field}>
            <option value="" disabled>
              Select…
            </option>
            {SPECIMEN_TYPES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          {errors.specimenType && <p className="text-sm text-red-600">{errors.specimenType}</p>}
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="priority" className={labelCls}>
            Priority
          </label>
          <select id="priority" name="priority" defaultValue="routine" className={field}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="clinicalHistory" className={labelCls}>
          Clinical history
        </label>
        <textarea
          id="clinicalHistory"
          name="clinicalHistory"
          maxLength={4000}
          required
          rows={6}
          className={field}
        />
        {errors.clinicalHistory && <p className="text-sm text-red-600">{errors.clinicalHistory}</p>}
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent" className="mt-1" required />
        <span>
          I confirm patient consent obtained for digital consultation and review.
        </span>
      </label>
      {errors.consent && <p className="text-sm text-red-600">{errors.consent}</p>}

      {state && !state.ok && !state.error.issues && (
        <p className="text-sm text-red-600">Could not create the case. Please try again.</p>
      )}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create case"}
        </button>
      </div>
    </form>
  );
}
