import type { $ZodIssue } from "zod/v4/core";

/** Canonical Server Action return shape (BUILD.md §7.1). Actions never throw
 *  across the network boundary; they return this. */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: { code: string; message?: string; issues?: $ZodIssue[] };
    };

export function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

export function fail(
  code: string,
  message?: string,
  issues?: $ZodIssue[],
): { ok: false; error: { code: string; message?: string; issues?: $ZodIssue[] } } {
  return { ok: false, error: { code, ...(message ? { message } : {}), ...(issues ? { issues } : {}) } };
}
