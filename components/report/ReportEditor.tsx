"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { draftReport, saveReportDraft, setSigningPassword, signOutReport } from "@/actions/reports";
import { Markdown } from "@/components/case/Markdown";
import type { IhcEntry, ReportView } from "@/lib/db/queries/reports";

const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";

type Fields = {
  microscopy: string;
  diagnosis: string;
  differential: string;
  recommendations: string;
  additionalNotes: string;
  ihc: IhcEntry[];
};

const SECTIONS: { key: keyof Omit<Fields, "ihc">; label: string; required?: boolean }[] = [
  { key: "microscopy", label: "Microscopy", required: true },
  { key: "diagnosis", label: "Diagnosis", required: true },
  { key: "differential", label: "Differential considerations" },
  { key: "recommendations", label: "Recommendations" },
  { key: "additionalNotes", label: "Additional notes" },
];

export function ReportEditor({
  caseId,
  initial,
  hasSigningPassword,
}: {
  caseId: string;
  initial: ReportView | null;
  hasSigningPassword: boolean;
}) {
  const router = useRouter();
  const [fields, setFields] = useState<Fields>({
    microscopy: initial?.microscopy ?? "",
    diagnosis: initial?.diagnosis ?? "",
    differential: initial?.differential ?? "",
    recommendations: initial?.recommendations ?? "",
    additionalNotes: initial?.additionalNotes ?? "",
    ihc: initial?.ihc ?? [],
  });
  const [saveState, setSaveState] = useState<string>("");
  const [preview, setPreview] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [showSignout, setShowSignout] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  const save = useCallback(async () => {
    const fd = new FormData();
    fd.set("caseId", caseId);
    fd.set("microscopy", fields.microscopy);
    fd.set("diagnosis", fields.diagnosis);
    fd.set("differential", fields.differential);
    fd.set("recommendations", fields.recommendations);
    fd.set("additionalNotes", fields.additionalNotes);
    fd.set("ihcJson", JSON.stringify(fields.ihc));
    setSaveState("Saving…");
    const res = await saveReportDraft(fd);
    setSaveState(res.ok ? `Saved at ${new Date().toLocaleTimeString()}` : "Save failed");
    dirty.current = false;
  }, [caseId, fields]);

  // Autosave 5s after the last change (PRODUCT §9.2).
  useEffect(() => {
    if (!dirty.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 5000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [fields, save]);

  function update<K extends keyof Fields>(key: K, value: Fields[K]) {
    dirty.current = true;
    setFields((f) => ({ ...f, [key]: value }));
  }

  async function runDraft() {
    setDrafting(true);
    const fd = new FormData();
    fd.set("caseId", caseId);
    const res = await draftReport(fd);
    setDrafting(false);
    if (res.ok) {
      setFields((f) => ({
        ...f,
        microscopy: res.data.microscopy,
        diagnosis: res.data.diagnosis,
        differential: res.data.differential,
        recommendations: res.data.recommendations,
        ihc: res.data.ihc,
      }));
      dirty.current = true;
    } else {
      setSaveState(res.error.code === "AI_UNAVAILABLE" ? "AI not configured" : "Draft failed");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{saveState}</span>
        <div className="flex gap-2">
          <button onClick={runDraft} disabled={drafting} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
            {drafting ? "Drafting…" : "Draft with AI"}
          </button>
          <button onClick={() => setPreview((p) => !p)} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
            {preview ? "Edit" : "Preview"}
          </button>
          <button onClick={() => void save()} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
            Save now
          </button>
          <button onClick={() => setShowSignout(true)} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white">
            Sign and publish
          </button>
        </div>
      </div>

      {SECTIONS.map((sec) => (
        <div key={sec.key} className="flex flex-col gap-1">
          <label className="text-sm font-medium">
            {sec.label}
            {sec.required && <span className="text-red-600"> *</span>}
          </label>
          {preview ? (
            <div className="rounded-md border border-border p-3">
              <Markdown>{fields[sec.key] || "_empty_"}</Markdown>
            </div>
          ) : (
            <textarea
              value={fields[sec.key]}
              onChange={(e) => update(sec.key, e.target.value)}
              rows={sec.key === "microscopy" || sec.key === "diagnosis" ? 5 : 3}
              className={field}
            />
          )}
        </div>
      ))}

      {/* IHC results (repeatable rows) */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">IHC results</label>
        {fields.ihc.map((row, i) => (
          <div key={i} className="flex flex-wrap gap-2">
            <input
              placeholder="Stain"
              value={row.stain}
              onChange={(e) => {
                const ihc = [...fields.ihc];
                ihc[i] = { ...ihc[i], stain: e.target.value };
                update("ihc", ihc);
              }}
              className={`${field} max-w-40`}
            />
            <select
              value={row.result}
              onChange={(e) => {
                const ihc = [...fields.ihc];
                ihc[i] = { ...ihc[i], result: e.target.value as IhcEntry["result"] };
                update("ihc", ihc);
              }}
              className={`${field} max-w-40`}
            >
              <option value="positive">positive</option>
              <option value="negative">negative</option>
              <option value="equivocal">equivocal</option>
            </select>
            <input
              placeholder="Notes"
              value={row.notes ?? ""}
              onChange={(e) => {
                const ihc = [...fields.ihc];
                ihc[i] = { ...ihc[i], notes: e.target.value };
                update("ihc", ihc);
              }}
              className={`${field} flex-1`}
            />
            <button onClick={() => update("ihc", fields.ihc.filter((_, j) => j !== i))} className="text-sm text-red-600">
              Remove
            </button>
          </div>
        ))}
        <button
          onClick={() => update("ihc", [...fields.ihc, { stain: "", result: "positive" }])}
          className="w-fit rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
        >
          Add IHC row
        </button>
      </div>

      {showSignout && (
        <SignoutDialog
          caseId={caseId}
          hasSigningPassword={hasSigningPassword}
          fields={fields}
          onClose={() => setShowSignout(false)}
          onSigned={() => {
            setShowSignout(false);
            router.push(`/cases/${caseId}`);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function SignoutDialog({
  caseId,
  hasSigningPassword,
  fields,
  onClose,
  onSigned,
}: {
  caseId: string;
  hasSigningPassword: boolean;
  fields: Fields;
  onClose: () => void;
  onSigned: () => void;
}) {
  const [password, setPassword] = useState("");
  const [needsSet, setNeedsSet] = useState(!hasSigningPassword);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const incomplete = !fields.microscopy.trim() || !fields.diagnosis.trim();

  async function submit() {
    setError(null);
    setPending(true);
    if (needsSet) {
      const fd = new FormData();
      fd.set("password", password);
      const res = await setSigningPassword(fd);
      if (!res.ok) {
        setError("Password must be at least 8 characters.");
        setPending(false);
        return;
      }
      setNeedsSet(false);
    }
    const fd = new FormData();
    fd.set("caseId", caseId);
    fd.set("password", password);
    const res = await signOutReport(fd);
    setPending(false);
    if (res.ok) onSigned();
    else {
      const map: Record<string, string> = {
        WRONG_PASSWORD: "Incorrect signing password.",
        LOCKED: "Signout locked after repeated attempts. Try again later.",
        INCOMPLETE: "Microscopy and diagnosis are required.",
        NO_SIGNING_PASSWORD: "Set your signing password first.",
        BAD_STATUS: "Case is not ready to sign.",
      };
      setError(map[res.error.code] ?? "Signout failed.");
      if (res.error.code === "NO_SIGNING_PASSWORD") setNeedsSet(true);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-background p-6">
        <h2 className="text-lg font-semibold">Sign and publish</h2>
        {incomplete && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Microscopy and diagnosis must be filled in before signing.
          </p>
        )}
        <div className="rounded-md border border-border p-3 text-sm">
          <p className="font-medium">Diagnosis</p>
          <Markdown>{fields.diagnosis || "_empty_"}</Markdown>
        </div>
        {needsSet && (
          <p className="text-sm text-muted-foreground">
            Set your signing password (used to sign reports). Min 8 characters.
          </p>
        )}
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={needsSet ? "Set signing password" : "Signing password"}
          className={field}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={pending || incomplete || !password}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? "Signing…" : "Sign and publish"}
          </button>
        </div>
      </div>
    </div>
  );
}
