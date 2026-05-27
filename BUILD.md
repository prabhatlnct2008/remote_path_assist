# BUILD.md — Working instructions for the implementing agent

> You are an LLM coding agent building PathConsult. This document tells you **how to work**, not what to build. The features are in `PRODUCT.md`. The system design is in `ARCHITECTURE.md`. This file is about process, planning, and discipline.

---

## 1. The first hour: read, don't code

Before writing a single line of code:

1. **Read `PRODUCT.md` end to end.** It defines every feature, every role, every state, every permission, every error case. Take notes. This is the contract.
2. **Read `ARCHITECTURE.md` end to end.** It defines the stack, schema, endpoint surface, and the patterns the codebase commits to.
3. **Skim this file (`BUILD.md`) once more.**
4. **Open `PRODUCT.md` §19 and `ARCHITECTURE.md` §15** — the open questions. If any block phase 1, stop and ask the human before starting.
5. **Then and only then,** start phase 0.

You will be tempted to skim. Don't. The five hours saved by skipping the read are the fifteen hours you'll lose mid-phase realizing the spec already answered your question.

---

## 2. Working principles

These apply to every phase, every task, every commit.

### 2.1 Plan before code

At the start of every phase, **write a plan first**. Open a scratchpad file (`.scratch/phase-N-plan.md`, gitignored), and write:
- The goal of this phase, in one sentence.
- The PRODUCT.md sections this phase implements.
- The ARCHITECTURE.md sections relevant.
- A numbered list of tasks. Each task should be one focused commit.
- For each task: acceptance criterion (how you'll know it works).
- A "risks and unknowns" section — write down what you're not sure about, and decide *now* whether to ask the human or proceed with a noted assumption.

The plan is a thinking aid. It costs ten minutes and prevents an hour of meandering. Update it as you go.

### 2.2 One task at a time

A task is the smallest unit that produces something verifiable. One task per commit. Don't start the next task until the current one passes its acceptance criterion.

**Anti-pattern**: opening five files, editing all of them, then trying to make it all work at once. You'll lose track of which change caused which failure.

**Pattern**: edit one file, save, run the check, see green, commit. Move to the next file.

### 2.3 State your intent before acting

Before any non-trivial action — running a migration, installing a dep, refactoring — write a one-line "what I'm about to do and why" comment in your scratchpad. This forces you to articulate the change, which catches half of the mistakes before you make them.

### 2.4 Verify immediately

After every change:
- Did `pnpm typecheck` still pass? (Or has your editor flagged a new error?)
- Did the page you just changed still render?
- If you touched a Server Action, did it run successfully when invoked from the UI?
- If you touched the DB schema, did `pnpm db:generate && pnpm db:migrate` succeed?

If the answer to any of these is "I don't know," **don't move on**. Verify, then move on.

### 2.5 Keep a progress log

In your scratchpad, maintain a running log:
```
[2026-05-27 11:14] Phase 1 task 1.3 — login page — DONE. Magic link verified end-to-end.
[2026-05-27 11:47] Phase 1 task 1.4 — auth-checked layout — DONE.
[2026-05-27 12:05] Phase 1 task 1.5 — role guards — IN PROGRESS. Stuck on testing requester→admin redirect.
```

This is for you, not the human. It keeps your context grounded across long sessions.

### 2.6 Don't invent features

`PRODUCT.md` is the scope. If a feature isn't there, **don't build it**. If you think it should be, write it in `.scratch/v2-ideas.md` and move on.

If something in PRODUCT.md is ambiguous: search PRODUCT.md and ARCHITECTURE.md once more. If it's still ambiguous after a careful read, **ask the human**. Do not guess product decisions. (Tech choices not specified in ARCHITECTURE.md — pick a sensible default and note the choice in your scratchpad.)

### 2.7 Performance is part of "done"

A feature that ships at 4 seconds when the budget is 2.5 seconds is not done. The performance budgets in ARCHITECTURE.md §9 and PRODUCT.md §17.1 are real. Check them at the end of every phase. If you're over budget, **fix it before moving on** — the work to find and fix it grows as more code lands on top.

### 2.8 Audit log on every mutation

Every Server Action that changes data writes a `case_events` row inside the same transaction. No exceptions. The hash chain only works if every event is logged. Make this the second thing you think about after the business logic.

### 2.9 If you're stuck, write the problem down

When something doesn't work and you can't see why, **stop trying things**. Open the scratchpad. Write:
- What I expected to happen.
- What actually happened.
- What I've tried.
- What I haven't tried.

Often the writing itself surfaces the answer. If not, you now have a clean question to ask the human or to use as a search query.

---

## 3. Phase ordering

Phases are sequential. Each is a vertical slice — at the end of every phase, you have something runnable and demonstrable.

| Phase | Title | What's runnable at the end |
|---|---|---|
| 0 | Project setup | Empty Next.js app on Vercel, Turso connected, env validated |
| 1 | Auth and roles | Magic-link login, role-protected layout, empty worklist |
| 2 | Cases and images | Create case, upload images, see them on worklist |
| 3 | Viewer, annotations, comments | Full review experience without AI |
| 4 | AI co-pilot | Brief, chat, draft generation working |
| 5 | Reports and signout | End-to-end signed reports with PDF |
| 6 | Polish and deploy | Production-ready: notifications, search, audit page, perf sweep |

Each phase corresponds to a chunk of `PRODUCT.md`:

- Phase 0–1 → §2, §3, §14 (auth, users, admin user management).
- Phase 2 → §4 (cases), §5 (images), parts of §13 (permissions).
- Phase 3 → §6 (annotations), §7 (comments), §8 (assignment).
- Phase 4 → §10 (AI co-pilot).
- Phase 5 → §9 (reports), parts of §11 (audit).
- Phase 6 → §11 (audit page), §12 (notifications), §15 (search), §16 (empty/error states), §17 (NFRs).

Use the corresponding PRODUCT.md sections to write the phase plan in your scratchpad. Don't paraphrase them into the plan — reference them. The product spec is the source of truth.

---

## 4. Per-phase workflow

For every phase, follow this loop:

### Step 1 — Plan
- Open `.scratch/phase-N-plan.md`.
- Re-read the PRODUCT.md sections this phase covers.
- Write the goal, the task list with acceptance criteria, and known risks.
- If anything is blocked on the human, ask now.

### Step 2 — Execute, one task at a time
For each task in order:
1. State intent in your scratchpad (one line).
2. Make the change.
3. Verify (typecheck, build, run, manual test).
4. Commit with a message naming the task.
5. Mark done in your scratchpad. Move to next.

### Step 3 — Phase gate
At the end of the phase, run a gate check:
- All phase tasks completed and committed?
- All acceptance criteria met?
- Performance budgets passed for any new routes?
- Smoke test of the end-to-end happy path for this phase?
- Audit log entries verified for every new mutation?
- No `'use client'` creep into pages or layouts?

If yes, write a brief "phase N done" note and proceed. If no, fix gaps before moving on.

---

## 5. Per-task discipline

For each individual task within a phase:

### 5.1 Scope it tightly

If a task says "build the case detail page," that's too big. Split it:
- 2.7a: Page skeleton with header + clinical card.
- 2.7b: Image gallery component.
- 2.7c: Suspense boundaries and loading skeletons.
- 2.7d: Action buttons (status-gated).

Each sub-task is one commit.

### 5.2 Pre-flight checklist

Before starting code on a task, confirm:
- [ ] I know which PRODUCT.md section this implements.
- [ ] I know which ARCHITECTURE.md section describes the design.
- [ ] I know the acceptance criterion.
- [ ] I know what files I'll touch.
- [ ] I know what I'll test to verify.

If any of these is "no," **stop and figure it out** before writing code.

### 5.3 Write the test, then the code (when applicable)

For pure functions, helpers, and Server Actions with branching logic, write a small unit test first. It clarifies the contract and gives you instant verification.

Don't bother with snapshot tests of UI in MVP. Use Playwright for one happy-path smoke test per phase.

### 5.4 Refuse to skip the audit log

If you find yourself writing a mutation that does not write a `case_events` row, **stop**. Add the log. There are no exceptions in MVP. The hash chain is the product.

### 5.5 Commit often

A commit should represent one task or one sub-task. Don't accumulate ten changes in one commit. If you find yourself wanting to write "and also fixed…" in a commit message, that's two commits.

---

## 6. Performance discipline

### 6.1 Per-phase gate

At the end of each phase, run Lighthouse and `pnpm build` against the routes the phase introduced. Compare to the budgets in ARCHITECTURE.md §9.5 (bundles) and PRODUCT.md §17.1 (LCP/TTFB).

If over budget, do **not** proceed. Common fixes:

1. **`'use client'` creep** — convert client components back to server where they don't need interactivity. Push client boundaries to the leaves.
2. **Bundle bloat** — `pnpm build` with `@next/bundle-analyzer`. Find heavy imports. Dynamic-import them.
3. **Waterfall reads** — wrap slow data in `<Suspense>`; render fast data immediately.
4. **N+1 queries** — replace loops with joined queries.
5. **Missing indexes** — `EXPLAIN QUERY PLAN` to verify the planned index is used.
6. **Unoptimized images** — every `<img>` in app code becomes `next/image`.
7. **No caching** — wrap reads in `cache()`; add `revalidate` to route segments; ensure mutations call `revalidateTag()`.

### 6.2 AI latency

AI calls have their own budgets (PRODUCT.md §10). The non-negotiable rule: **never make the user wait blocking on an AI call**. Brief generation is background. Chat streams. Draft streams. UI shows progress immediately.

---

## 7. Patterns the codebase commits to

Adopt these in phase 0/1 and reuse them. Inconsistency costs more than getting them right once.

### 7.1 Server Action return shape

```ts
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message?: string; issues?: ZodIssue[] } }
```

Every Server Action returns this. Never throw across the network boundary. The client uses `if (!result.ok)` and reads `result.error.code` to render the right UI.

### 7.2 Server Action skeleton

```ts
'use server'

import { auth } from '@/lib/auth'
import { z } from 'zod'
import { db } from '@/lib/db/client'
import { logEvent } from '@/lib/audit'
import { canUserAccessCase } from '@/lib/auth/guards'
import { revalidateTag } from 'next/cache'

const Input = z.object({ /* … */ })

export async function someAction(raw: unknown) {
  const session = await auth()
  if (!session?.user) return { ok: false as const, error: { code: 'UNAUTHENTICATED' } }

  const parsed = Input.safeParse(raw)
  if (!parsed.success) return { ok: false as const, error: { code: 'BAD_INPUT', issues: parsed.error.issues } }

  // resource-level access check
  // ... canUserAccessCase(...) etc.

  const result = await db.transaction(async (tx) => {
    // mutation
    // logEvent(tx, { ... })
    return /* row */
  })

  revalidateTag(/* relevant tag */)
  return { ok: true as const, data: result }
}
```

Every Server Action looks like this. Variation only in the middle.

### 7.3 Server Component reads

```ts
import { cache } from 'react'

export const getCaseForUser = cache(async (caseId: string, userId: string) => {
  // drizzle query with access check baked in
})
```

`cache()` for per-request dedup. Route segments use `unstable_cache` with tags when cross-request caching is appropriate.

### 7.4 Suspense around slow data

```tsx
// app/(app)/cases/[id]/page.tsx
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const caseRow = await getCase(id)   // fast, blocks

  return (
    <>
      <CaseHeader caseRow={caseRow} />
      <Suspense fallback={<BriefSkeleton />}>
        <AIBriefCard caseId={id} />     {/* slow, streams in */}
      </Suspense>
      <Suspense fallback={<ImagesSkeleton />}>
        <ImageGallery caseId={id} />    {/* deferred */}
      </Suspense>
    </>
  )
}
```

### 7.5 Dynamic imports for heavy code

```tsx
const Viewer = dynamic(() => import('@/components/viewer/Viewer'), {
  ssr: false,
  loading: () => <ViewerSkeleton />
})
```

OpenSeadragon, Annotorious, report editor, chat panel, PDF preview — all dynamic.

### 7.6 Optimistic UI

For comments, annotations, status toggles — use `useOptimistic`. Surface the change instantly; reconcile on response. Roll back on error with a toast.

---

## 8. Pitfalls — re-read before each phase

These will eat the most time if you let them. They are stack-specific to Vercel + Turso + Auth.js v5 + Next.js 15.

**Vercel function body limit (4.5 MB).** Anything bigger goes direct to Blob via `@vercel/blob/client`. Never proxy a file through a Server Action or route handler.

**Server Actions that throw.** Don't. Return `{ ok: false, error }`. Throws cross the network as opaque "Server Action Error."

**`'use client'` creep.** Audit at every phase gate. Pages and layouts almost never need it. Forms with state need it. Pure presentational components don't.

**Auth.js v5 + Drizzle adapter version match.** Pin per ARCHITECTURE.md §2. Don't bump until you understand the migration.

**Turso write contention on the same row.** SQLite serializes writes. Concurrent updates to the same case row hit retry-on-busy. Batch when you can; for the audit hash chain, use the retry-with-fresh-read pattern.

**Hash chain forks.** Two concurrent events on the same case can compute the same `prev_hash`. Serialize by reading the latest hash *inside the transaction* and retrying on insert conflict (up to 3 attempts).

**Anthropic image token cost.** Always downscale to 1024 px longest edge with `sharp` before sending. Sending a 30 MB JPEG burns tokens.

**AI streaming and Server Actions.** Server Actions buffer. Streaming chat must use a Route Handler with `streamText`.

**Encryption key rotation.** Store `*_key_version` alongside encrypted columns from day one. You will rotate the key. Make it possible.

**Date/time in SQLite.** Store as integer (unix ms) everywhere. Don't trust string columns to compare correctly.

**Search engine indexing.** Set `X-Robots-Tag: noindex` on all `(app)/*` routes in `next.config.ts`. Patient content must not leak via Google.

**The "draft" status urge.** Only 5 statuses exist in PRODUCT.md §4.5. Anything that feels like a sixth is either a flag (`needs_more_material`) or a derived state.

---

## 9. When to ask the human

Ask immediately, do not guess, on:
- Anything in PRODUCT.md §19 (canonical subspecialty list, letterhead, SLA values, retention period, sender domain, pilot user list).
- A scope question PRODUCT.md doesn't answer.
- A security or compliance trade-off (e.g., "should this column be encrypted?").
- A choice that would require redoing work later if reversed.

Resolve yourself, with a note in the scratchpad, on:
- Naming conventions for variables/files (use ARCHITECTURE.md §12 as default).
- Library micro-choices not in ARCHITECTURE.md §2.
- UI polish that isn't specified.

When asking, present:
- The decision point.
- The options you see.
- Your recommendation and why.
- The reversibility cost.

A good ask takes 30 seconds for the human to answer. A vague ask wastes everyone's time.

---

## 10. Mid-phase rescue procedure

If a phase is going off the rails — too many tasks open, tests failing, context lost — execute this rescue:

1. **Stop coding.** Save what you have, commit work-in-progress as `wip: phase-N partial`.
2. Open the scratchpad. Re-write the plan from scratch based on what's actually done vs. not done.
3. Identify the smallest set of remaining tasks needed to hit the phase gate. Cut everything else to v2.
4. Pick the *single* most blocking task. Solve it.
5. Then continue with one-task-at-a-time discipline.

The mistake is to keep pushing forward with five things in flight when none of them work. The fix is to converge to one.

---

## 11. Phase 0 essentials

Phase 0 is short but critical. The patterns established here propagate. Don't skip the verification.

- Repo init, dependencies pinned per ARCHITECTURE.md §2.
- Tailwind 4 + shadcn primitives installed.
- `lib/env.ts` validates every env var at boot.
- Turso DB created in `bom`. Connection verified.
- Drizzle wired; first empty migration applied.
- Vercel project connected; env vars set; deployed; URL returns the placeholder landing.

**Phase 0 gate**: A pushed commit deploys to Vercel, and the deployed URL connects to Turso (verify with a temporary `/api/health` route that does `SELECT 1` — remove after).

---

## 12. Definition of done — MVP

The MVP is shippable to AIIMS when all of these are true. This is the final gate.

- [ ] All six phases completed and gated.
- [ ] PRODUCT.md §17.1 performance budgets met on production URL.
- [ ] PRODUCT.md §13 permissions matrix verified by Playwright tests covering each role × action combination.
- [ ] Audit chain verifies end-to-end for at least 3 representative cases (one in each terminal state).
- [ ] Email notifications delivered to a real inbox in a dry run.
- [ ] PDF report renders correctly with letterhead and signer info.
- [ ] DB backup cron tested by restoring to a fresh Turso DB.
- [ ] Sentry connected; a deliberate error reaches the dashboard.
- [ ] Open questions from PRODUCT.md §19 and ARCHITECTURE.md §15 all resolved.
- [ ] The AIIMS requester has done a 30-minute walkthrough and signed off.

---

## 13. Working principles, distilled

1. **Read the spec first.** PRODUCT.md and ARCHITECTURE.md are the contract.
2. **Plan in writing before code.** Every phase, every non-trivial task.
3. **One task, one commit, one verify.** Discipline beats speed.
4. **Performance is part of done.** Gate on it.
5. **Audit log every mutation.** No exceptions.
6. **Don't invent features.** Scope is in PRODUCT.md.
7. **Ask before guessing.** A 30-second question beats a 3-hour rework.
8. **When stuck, write the problem down.** The writing surfaces the answer.
9. **Stay simple.** SQLite, Server Actions, Server Components, magic links. The MVP wins by shipping.
10. **Re-read this list at the start of each phase.**
