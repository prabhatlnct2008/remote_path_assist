import type { CaseStatus, Priority } from "@/lib/constants";

const STATUS_STYLE: Record<CaseStatus, string> = {
  submitted: "bg-zinc-100 text-zinc-700",
  assigned: "bg-blue-100 text-blue-800",
  in_review: "bg-indigo-100 text-indigo-800",
  reported: "bg-violet-100 text-violet-800",
  signed_out: "bg-green-100 text-green-800",
};

const STATUS_LABEL: Record<CaseStatus, string> = {
  submitted: "Submitted",
  assigned: "Assigned",
  in_review: "In review",
  reported: "Reported",
  signed_out: "Signed out",
};

const PRIORITY_STYLE: Record<Priority, string> = {
  routine: "bg-zinc-100 text-zinc-700",
  urgent: "bg-amber-100 text-amber-800",
  stat: "bg-red-100 text-red-800",
};

const badge = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";

export function StatusBadge({ status }: { status: CaseStatus }) {
  return <span className={`${badge} ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`${badge} ${PRIORITY_STYLE[priority]}`}>{priority.toUpperCase()}</span>
  );
}
