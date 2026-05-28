const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact relative time, e.g. "just now", "3m ago", "2h ago", "5d ago". */
export function relativeTime(ms: number, now = Date.now()): string {
  const diff = now - ms;
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  return new Date(ms).toLocaleDateString();
}

/** Remaining-time label for an SLA deadline, e.g. "in 2h", "overdue 15m". */
export function slaLabel(dueAt: number, now = Date.now()): { text: string; breached: boolean } {
  const diff = dueAt - now;
  const breached = diff < 0;
  const abs = Math.abs(diff);
  const value =
    abs < HOUR ? `${Math.max(1, Math.floor(abs / MINUTE))}m` : `${Math.floor(abs / HOUR)}h`;
  return { text: breached ? `overdue ${value}` : `in ${value}`, breached };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function initials(name: string | null | undefined, fallback = "?"): string {
  if (!name) return fallback;
  const parts = name.replace(/^(dr\.?|prof\.?)\s+/i, "").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || fallback;
}
