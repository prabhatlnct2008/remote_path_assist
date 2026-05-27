# ARCHITECTURE.md — PathConsult technical design

> What the system is, how the pieces fit, the full data model, and the API surface. Companion docs: `PRODUCT.md` (what to build), `BUILD.md` (how to approach the work).

---

## 1. Goals and constraints

**Goals**
1. AIIMS Delhi pilot in 6 weeks, single-developer build.
2. End-to-end workflow per `PRODUCT.md`.
3. AI co-pilot that demonstrably saves time.
4. p95 worklist load < 2.0 s, p95 case detail interactive < 2.5 s, p95 viewer ready < 1.0 s.
5. Auditable: every state change tracked, tamper-evident.

**Constraints**
1. Vercel-native stack; serverless functions only.
2. No native WSI processing on the server in MVP (see `PRODUCT.md` §5.1).
3. Primary database and slide images in India.
4. Budget: low hundreds of USD/month for pilot.

---

## 2. Stack

```
Frontend       Next.js 15 (App Router) · React 19 · Tailwind 4 · shadcn/ui
Auth           Auth.js v5 with @auth/drizzle-adapter · email magic links
Database       Turso (libSQL) in Mumbai (bom) · Drizzle ORM
Storage        Vercel Blob (R2 swap planned for production)
AI             Anthropic Claude Sonnet 4.6 via Vercel AI SDK
Embeddings     Voyage AI (voyage-3-large, 1024 dims) · stored in Turso vector index
Email          Resend
Viewer         OpenSeadragon 5 + Annotorious
PDF            @react-pdf/renderer
Scheduling     Vercel Cron
Observability  Vercel Analytics + Sentry
```

---

## 3. System topology

```
                       Browser (Next.js client + OSD + Annotorious)
                          │              │
                  HTTPS │              │ Direct upload (signed URL)
                          ▼              ▼
            ┌──────────────────────┐   ┌──────────────────────┐
            │  Next.js on Vercel   │   │  Vercel Blob         │
            │  RSC, Server Actions │   │  Images, PDFs        │
            │  Route Handlers      │   └──────┬───────────────┘
            └──┬───────┬─────────┬─┘          │
               │       │         │            │ webhook on complete
               ▼       ▼         ▼            ▼
         ┌────────┐ ┌─────┐ ┌────────────┐ ┌──────────────┐
         │ Turso  │ │Resnd│ │ Anthropic  │ │ (back to     │
         │ libSQL │ │Email│ │ + Voyage   │ │  Next.js)    │
         │ bom    │ │     │ │            │ └──────────────┘
         └────────┘ └─────┘ └────────────┘
```

Two performance-critical paths:
- **Read**: Browser → Next.js (Vercel edge or Mumbai region when available) → Turso (Mumbai). Sub-50 ms when colocated.
- **Image upload**: Browser → Vercel Blob *directly*. Next.js only signs the upload token; never sees file bytes. Bypasses the 4.5 MB function body limit; works up to ~500 MB.

---

## 4. Data model

All tables in libSQL (SQLite-compatible). Field-level encryption (AES-256-GCM, key from env) applied to columns marked `[encrypted]`.

### 4.1 `users`

```ts
{
  id:                text PK (cuid2),
  email:             text UNIQUE NOT NULL,
  name:              text NOT NULL,
  role:              text NOT NULL CHECK (role IN ('requester','consultant','admin')),
  subspecialty:      text NOT NULL DEFAULT '',  -- comma-separated, MVP shortcut
  active:            integer NOT NULL DEFAULT 0,
  signing_password:  text,  -- argon2id hash, null until first signout
  signing_locked_until: integer,  -- unix ms, for brute-force protection
  created_at:        integer NOT NULL,
  updated_at:        integer NOT NULL
}
```

Indexes: `users(email)` (unique), `users(role, active)`.

### 4.2 Auth.js tables

`accounts`, `sessions`, `verificationTokens` — schemas per `@auth/drizzle-adapter` v1.7+. Standard, do not modify.

### 4.3 `cases`

```ts
{
  id:                  text PK (cuid2),
  case_number:         text UNIQUE NOT NULL,                    -- AIIMS-PATH-YYYY-NNNNN
  patient_ref:         text NOT NULL,                            -- [encrypted]
  age:                 integer NOT NULL,
  sex:                 text NOT NULL CHECK (sex IN ('M','F','Other')),
  clinical_history:    text NOT NULL,                            -- [encrypted]
  specimen_type:       text NOT NULL,
  priority:            text NOT NULL CHECK (priority IN ('routine','urgent','stat')),
  status:              text NOT NULL CHECK (status IN ('submitted','assigned','in_review','reported','signed_out')),
  needs_more_material: integer NOT NULL DEFAULT 0,
  consent_confirmed:   integer NOT NULL,
  consent_at:          integer NOT NULL,
  created_by:          text NOT NULL REFERENCES users(id),
  assigned_to:         text REFERENCES users(id),
  assigned_at:         integer,
  signed_out_by:       text REFERENCES users(id),
  signed_out_at:       integer,
  signed_pdf_url:      text,
  ai_brief_md:         text,
  ai_brief_status:     text CHECK (ai_brief_status IN ('idle','generating','ready','error')),
  sla_due_at:          integer,
  encryption_key_version: integer NOT NULL DEFAULT 1,
  created_at:          integer NOT NULL,
  updated_at:          integer NOT NULL
}
```

Indexes:
- `cases(assigned_to, status, created_at DESC)` — consultant worklist.
- `cases(created_by, created_at DESC)` — requester worklist.
- `cases(status, priority, created_at DESC)` — admin worklist.
- `cases(case_number)` unique.

### 4.4 `case_sequences`

For atomic case number generation.

```ts
{
  year:        integer PK,
  last_number: integer NOT NULL
}
```

### 4.5 `images`

```ts
{
  id:             text PK,
  case_id:        text NOT NULL REFERENCES cases(id),
  filename:       text NOT NULL,
  blob_url:       text NOT NULL,
  blob_pathname:  text NOT NULL,
  content_type:   text NOT NULL,
  size_bytes:     integer NOT NULL,
  width:          integer,
  height:         integer,
  kind:           text NOT NULL DEFAULT 'static',   -- forward-compat for 'dzi'
  uploaded_by:    text NOT NULL REFERENCES users(id),
  uploaded_at:    integer NOT NULL,
  deleted_at:     integer
}
```

Index: `images(case_id, uploaded_at)`.

### 4.6 `annotations`

```ts
{
  id:            text PK,
  image_id:      text NOT NULL REFERENCES images(id),
  case_id:       text NOT NULL REFERENCES cases(id),  -- denormalized for access check
  author_id:     text NOT NULL REFERENCES users(id),
  geometry_json: text NOT NULL,  -- GeoJSON; image-pixel coordinates
  label:         text,
  color:         text NOT NULL DEFAULT '#F2A623',
  created_at:    integer NOT NULL,
  updated_at:    integer NOT NULL,
  deleted_at:    integer
}
```

Index: `annotations(image_id, deleted_at)`.

### 4.7 `comments`

```ts
{
  id:           text PK,
  case_id:      text NOT NULL REFERENCES cases(id),
  author_id:    text REFERENCES users(id),       -- null when actor_kind='ai'
  actor_kind:   text NOT NULL DEFAULT 'user',    -- 'user' | 'ai'
  body:         text NOT NULL,
  parent_id:    text REFERENCES comments(id),
  ai_metadata:  text,  -- JSON: { model, retrieved_case_ids[], tokens_in, tokens_out }
  created_at:   integer NOT NULL,
  updated_at:   integer NOT NULL,
  deleted_at:   integer,
  edit_locked_at: integer  -- created_at + 5min; null = still editable by author
}
```

Index: `comments(case_id, created_at)`.

### 4.8 `reports`

One row per case at any time, but version-bumped on signout (so signed reports are immutable rows; further edits create a new draft row).

```ts
{
  id:               text PK,
  case_id:          text NOT NULL REFERENCES cases(id),
  version:          integer NOT NULL DEFAULT 1,
  body_md:          text NOT NULL DEFAULT '',                -- [encrypted]
  microscopy:       text NOT NULL DEFAULT '',                -- [encrypted]
  diagnosis:        text NOT NULL DEFAULT '',                -- [encrypted]
  differential:     text NOT NULL DEFAULT '',                -- [encrypted]
  recommendations:  text NOT NULL DEFAULT '',                -- [encrypted]
  ihc_json:         text NOT NULL DEFAULT '[]',              -- JSON array
  ai_draft_md:      text,                                     -- preserved raw AI output
  status:           text NOT NULL CHECK (status IN ('draft','signed')),
  signed_at:        integer,
  signed_by:        text REFERENCES users(id),
  signature_hash:   text,
  encryption_key_version: integer NOT NULL DEFAULT 1,
  created_at:       integer NOT NULL,
  updated_at:       integer NOT NULL
}
```

Indexes: `reports(case_id, version DESC)`, `reports(case_id, status)`.

### 4.9 `case_events` (append-only audit)

```ts
{
  id:           text PK,
  case_id:      text NOT NULL REFERENCES cases(id),
  actor_id:     text REFERENCES users(id),
  actor_kind:   text NOT NULL CHECK (actor_kind IN ('user','ai','system')),
  event_type:   text NOT NULL,
  payload_json: text NOT NULL DEFAULT '{}',
  occurred_at:  integer NOT NULL,
  prev_hash:    text NOT NULL,
  hash:         text NOT NULL
}
```

Indexes: `case_events(case_id, occurred_at)`, `case_events(case_id, id DESC)`.

Hash algorithm:
```
hash = sha256_hex(prev_hash || '|' || canonical_json(payload) || '|' || occurred_at_ms)
```
Genesis `prev_hash = '0'.repeat(64)`. Writes per-case are serialized with retry-on-conflict (read latest hash inside transaction; insert with that as `prev_hash`; if a concurrent insert beat us, retry up to 3 times).

### 4.10 `case_embeddings`

Turso native vector index.

```sql
CREATE TABLE case_embeddings (
  case_id      TEXT PRIMARY KEY REFERENCES cases(id),
  content_kind TEXT NOT NULL,  -- 'summary' for MVP
  embedding    F32_BLOB(1024) NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX case_embeddings_idx ON case_embeddings(libsql_vector_idx(embedding));
```

Populated only on signout. Queried via:
```sql
SELECT case_id, vector_distance_cos(embedding, ?) AS d
FROM case_embeddings
WHERE case_id IN (SELECT id FROM cases WHERE ... access predicate ...)
ORDER BY d
LIMIT 5;
```

### 4.11 `invitations`

```ts
{
  id:           text PK,
  email:        text NOT NULL,
  role:         text NOT NULL,
  subspecialty: text NOT NULL DEFAULT '',
  invited_by:   text NOT NULL REFERENCES users(id),
  expires_at:   integer NOT NULL,
  accepted_at:  integer,
  created_at:   integer NOT NULL
}
```

Index: `invitations(email, accepted_at)`.

---

## 5. Encryption strategy

**Field-level AES-256-GCM** for columns marked `[encrypted]` in §4. Format on disk:
```
v1:<base64-iv>:<base64-tag>:<base64-ciphertext>
```
Version prefix supports key rotation.

**Keys**: `ENCRYPTION_KEY_V1`, `ENCRYPTION_KEY_V2`, … in env. The `*_key_version` columns on each row tell decryption which key to use. Rotation is a re-encrypt sweep that bumps the version column.

**Search of encrypted columns**: For admin search across `patient_ref`, decrypt-on-read for matching rows; we accept the O(n) cost given the pilot's case volume. For larger deployments, switch to deterministic encryption + blind index.

---

## 6. API surface

The app uses three kinds of server endpoints:

- **Server Actions** for mutations originating from forms or user interactions (most of the app).
- **Route Handlers** for streaming responses (AI chat), webhooks (Blob upload completion), and OAuth callbacks (Auth.js).
- **`page.tsx` Server Components** for reads.

All mutations validate input with Zod, check session and resource authorization, and return `{ ok: true, data } | { ok: false, error: { code, message?, issues? } }`. None throw across the network boundary.

### 6.1 Auth

```
Route Handler  GET/POST  /api/auth/[...nextauth]    Auth.js
Server Action  signIn(email)                         issue magic link
Server Action  signOut()                             end session
Server Action  setSigningPassword(currentSession, newPassword)
```

### 6.2 Uploads

```
Route Handler  POST  /api/upload/sign                returns signed Blob token
Route Handler  POST  /api/upload/complete            Blob webhook; creates image row
```

Signing payload includes `caseId` and `kind` in `clientPayload`. Server verifies user has upload rights on that case and that case status allows uploads.

### 6.3 Cases

```
SA  createCase(input: CreateCaseInput)              -> { id }
SA  updateCaseField(id, field, value)               -> {} | { error }   (limited fields per status)
SA  assignCase(id, consultantId)                    admin only
SA  reassignCase(id, consultantId, reason)          consultant assigned | admin
SA  transitionStatus(id, toStatus)                  internal; called by other actions
SA  flagNeedsMoreMaterial(id, comment)              consultant only
SA  unflagNeedsMoreMaterial(id)                     consultant | system on image upload
SA  deleteCase(id)                                  admin only, status='submitted' only
```

### 6.4 Images

```
SA  registerImage(caseId, blobUrl, metadata)        called internally from upload webhook
SA  deleteImage(id)                                  uploader, case.status='submitted'
```

### 6.5 Annotations

```
SA  createAnnotation(input)
SA  updateAnnotation(id, patch)
SA  deleteAnnotation(id)
```

### 6.6 Comments

```
SA  postComment(caseId, body, parentId?)
SA  editComment(id, body)                            within 5 min, author only
SA  deleteComment(id)                                author only (soft-delete)
```

### 6.7 Reports

```
SA  draftReport(caseId)                              triggers AI draft
SA  saveReportDraft(caseId, fields)                  upsert draft row, auto-save
SA  signOutReport(caseId, signingPassword)           verify password, snapshot, generate PDF, embedding, notify
```

### 6.8 AI

```
Route Handler  POST  /api/ai/chat                    streaming chat for one case
Route Handler  POST  /api/ai/brief/:caseId/regenerate
SA             generateBrief(caseId)                  internal, called by assignCase
SA             generateEmbedding(caseId)              internal, called by signOutReport
```

The chat route accepts `{ caseId, messages, userMessage }`, performs auth + access, embeds the user message, retrieves top-5 similar cases, builds context, and streams via `streamText`.

### 6.9 Admin

```
SA  inviteUser(input: InviteInput)                   admin only
SA  activateUser(id)
SA  deactivateUser(id)
SA  changeUserRole(id, newRole)
SA  changeUserSubspecialty(id, newList)
SA  resendInvite(invitationId)
```

### 6.10 Audit reads

```
Server Component  case audit page                    streams events with verification status
SA                verifyChain(caseId)                 recomputes; returns { valid, firstBreakAt? }
```

---

## 7. Permissions enforcement

**Layered defenses**, in order:

1. **Middleware** (`middleware.ts`) checks session for `/(app)/*` routes; redirects anonymous to `/login`.
2. **Layout guard** (`app/(app)/layout.tsx`) re-checks session, fetches user, blocks inactive users.
3. **Action guard** at the top of every Server Action: `requireRole(...)`, `requireActiveUser(...)`.
4. **Resource guard** inside the action: `canUserAccessCase(userId, caseId)` — verifies the user is the requester, the assignee, or an admin. Admins are further blocked from reading encrypted content fields by *not decrypting* them in admin-context queries.
5. **Audit log** captures the attempted action with `outcome: 'denied'` for any failure at layers 3 or 4.

The `canUserAccessCase` predicate is reused inside SQL access filters (case chat similarity search uses it as a subquery in the SELECT).

---

## 8. AI integration design

### 8.1 Pre-review brief

**Pipeline**
1. `assignCase` succeeds; status now `Assigned`.
2. `assignCase` calls `generateBrief(caseId)` as a non-blocking task (a Server Action invoked via `void`).
3. `generateBrief` sets `cases.ai_brief_status = 'generating'`, logs `AI_BRIEF_STARTED`.
4. Loads clinical history (decrypted), age, sex, specimen type, priority.
5. Loads up to 4 image blob URLs; for each, downscales to 1024 px longest edge via `sharp` and base64-encodes (or fetches via signed URL if Claude supports URL inputs — currently base64 is safer).
6. Calls Anthropic `messages.create` (model `claude-sonnet-4-5-20250929`, max_tokens 800), with the system prompt from `lib/ai/prompts/brief.ts`.
7. On success, saves Markdown to `cases.ai_brief_md`, sets status `ready`, logs `AI_BRIEF_GENERATED` with payload `{ tokens_in, tokens_out, latency_ms }`.
8. On failure, sets status `error`, logs `AI_BRIEF_FAILED`. UI offers a retry button.

**Concurrency**: only one brief generation per case at a time. Status `generating` is the lock; retries first re-check status.

### 8.2 Case chat

**Route handler** `/api/ai/chat`. Body: `{ caseId, messages: ChatMessage[] }`. Stream response.

**Steps**
1. Auth + `canUserAccessCase`. Reject if not allowed.
2. Embed `messages[last].content` with Voyage.
3. Vector search `case_embeddings` for top-5 nearest, joined with `cases` for access filter.
4. Build system message: case context (history, brief, recent annotation labels, structured report fields if any, retrieved case summaries).
5. Stream Claude response via Vercel AI SDK `streamText`.
6. On `onFinish`, persist both the user message and the AI response as `comments` rows with `actor_kind='ai'` for the response, and log `AI_CHAT_TURN` event with `tokens_in/out`.

### 8.3 Draft report

**Server Action** `draftReport(caseId)`. Loads context similar to chat, no retrieval. Uses Claude with structured output enforcement (JSON mode + strict schema validation with Zod on the way out). Saves both raw response (`reports.ai_draft_md`) and parsed fields (`reports.microscopy`, `reports.diagnosis`, etc.). Logs `AI_DRAFT_GENERATED`. Returns the parsed object to populate the editor.

### 8.4 Prompt structure

Every prompt has three sections:
- **Role and guardrails** (constants in `lib/ai/prompts/_common.ts`).
- **Case context** (built dynamically).
- **Task** (specific to feature).

The guardrails block contains the four verbatim instructions from `PRODUCT.md` §10.5.

### 8.5 Cost discipline

- Brief: ~$0.05 per case.
- Chat turn: ~$0.02 per turn.
- Draft: ~$0.10 per case.
- Pilot budget: 200 cases/month × ($0.05 + $0.10 + ~$0.10 in chat) ≈ $50/month for AI alone.

---

## 9. Performance design

### 9.1 Rendering strategy

- **RSC by default**. Every component is a Server Component unless marked `'use client'`.
- **Streaming** with `<Suspense>` around slow reads (AI brief, annotations, similar cases panel).
- **Optimistic UI** (`useOptimistic`) for comments, annotations, status toggles.
- **Dynamic imports** for OpenSeadragon, Annotorious, report editor, PDF preview, chat panel.

### 9.2 Data layer

- `cache()` wraps every read query for per-request deduplication.
- Route segments declare `revalidate` and `revalidateTag` calls from mutations invalidate them.
- No N+1: every list query uses joins or batched reads.
- Per-route DB query budget: 5 queries max for the synchronous render. Anything more goes behind Suspense.

### 9.3 Indexes

The indexes in §4 must be present for these queries to be fast. Verify with `EXPLAIN QUERY PLAN` after each migration.

### 9.4 Image pipeline

- Thumbnails: not pre-generated in MVP. Use `next/image` with `width=200` on the original blob URL; Next.js optimizer handles the rest. Watch its monthly transform budget; switch to on-upload thumbnail generation with `sharp` if it becomes a hot spot.
- Viewer: `tileSources: { type: 'image', url: blob_url }` for static images. OSD handles in-browser pyramid generation.

### 9.5 Bundle budget

```
/                    ≤ 80  KB JS
/cases               ≤ 150 KB JS
/cases/[id]          ≤ 200 KB JS  (excluding lazy)
/cases/[id]/viewer   ≤ 250 KB JS  (lazy: ~200 KB OSD + Annotorious)
/cases/[id]/report   ≤ 250 KB JS  (lazy: ~150 KB editor + PDF preview)
```

Enforce by running `pnpm build` with `@next/bundle-analyzer` and inspecting the output at each phase gate.

### 9.6 Caching tags

Strict tagging discipline:
```
cases:user:{userId}                worklist for a user
cases:detail:{caseId}              everything on a case detail page
cases:audit:{caseId}               audit timeline
users:list                          admin user list
```

Mutations call `revalidateTag(...)` for every tag they invalidate.

---

## 10. Security

### 10.1 Transport

TLS 1.3, HSTS preload, secure cookies.

### 10.2 Authentication

Magic-link only for login. Argon2id with proper params for the signing password (separate from session auth).

### 10.3 Authorization

See §7. Resource-level checks always present.

### 10.4 Encryption at rest

- Turso storage is encrypted at rest by Turso.
- Field-level encryption for sensitive columns per §5.

### 10.5 Audit

`case_events` append-only with hash chain. Every mutation writes within the same transaction as the data change. No data change without an audit row.

### 10.6 PII discipline

- Patient names never stored. Only opaque `patient_ref` (MRN).
- No PII in URLs, query strings, or logs.
- Server logs scrub the `clinical_history` and `patient_ref` fields automatically.
- Error reports to Sentry filter the same fields.

### 10.7 AI safety

- Patient_ref never sent to the LLM (stripped in prompt builders).
- AI cannot create or modify records — every AI output is presented to the user for explicit save.
- AI responses logged with full input/output so a review can verify safety.

### 10.8 Rate limits

- Login attempts: 5 per hour per email.
- Magic-link issuance: 3 per hour per email.
- Signout password: 3 wrong attempts → 30-min lock.
- AI chat: 60 messages per consultant per hour (soft limit, surface to user).

### 10.9 Data residency

- Turso DB: pinned `bom` (Mumbai).
- Vercel Blob: AWS us-east-1 in MVP. **Production migration to Cloudflare R2 in BOM is a v2 task; pilot data is pseudonymized which mitigates this.**
- Vercel hosting region: pin to the closest available to India (Mumbai when available, Singapore otherwise).
- Anthropic and Voyage: US-based; only pseudonymized content sent.

---

## 11. Deployment and operations

### 11.1 Environments

| Env | Branch | DB | Blob | Notes |
|---|---|---|---|---|
| Local | dev | local libSQL file | local mock or test Blob store | for development |
| Preview | PR branches | preview Turso DB | preview Blob store | per-PR |
| Production | `main` | production Turso DB (bom) | production Blob store | custom domain |

### 11.2 CI/CD

- GitHub Actions: lint, typecheck, unit tests, Playwright smoke test against preview deployment.
- Vercel handles deploy on merge to `main`.

### 11.3 Cron jobs

Defined in `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/sla-check",        "schedule": "0 * * * *"     },
    { "path": "/api/cron/db-backup",        "schedule": "0 2 * * *"     },
    { "path": "/api/cron/blob-retention",   "schedule": "0 3 1 * *"     }
  ]
}
```

- `sla-check`: every hour. Finds assigned cases approaching or breaching SLA, sends emails.
- `db-backup`: nightly Turso dump → Vercel Blob → 30-day rotation.
- `blob-retention`: monthly. Purges images for signed-out cases older than retention policy.

### 11.4 Monitoring

- Vercel Analytics: Web Vitals per route.
- Sentry: errors, releases tagged with git SHA.
- Vercel logs: filtered for `actor_kind='ai'` events to track cost.
- Manual dashboard at `/admin/system` shows storage and AI usage.

### 11.5 Backup and recovery

- DB: nightly dump via Turso CLI to Blob. Restore tested monthly.
- Blob: Vercel Blob has its own durability; no app-level backup in MVP.
- Audit log: append-only and never purged; safe by design.

---

## 12. Directory layout

```
.
├── app/
│   ├── (auth)/{login,verify}/page.tsx
│   ├── (app)/
│   │   ├── layout.tsx
│   │   ├── cases/
│   │   │   ├── page.tsx
│   │   │   ├── new/page.tsx
│   │   │   └── [id]/
│   │   │       ├── page.tsx
│   │   │       ├── viewer/page.tsx
│   │   │       ├── report/page.tsx
│   │   │       └── audit/page.tsx
│   │   └── admin/{users,cases,system}/page.tsx
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts
│   │   ├── upload/{sign,complete}/route.ts
│   │   ├── ai/{chat,brief}/route.ts
│   │   └── cron/{sla-check,db-backup,blob-retention}/route.ts
│   └── page.tsx
├── components/
│   ├── ui/                         shadcn primitives
│   ├── case/                       case-specific UI
│   ├── viewer/                     OpenSeadragon + Annotorious
│   ├── ai/                         brief card, chat panel
│   ├── report/                     editor, PDF preview
│   └── admin/
├── lib/
│   ├── db/{schema,client}.ts
│   ├── db/queries/{cases,users,events,...}.ts
│   ├── auth/{index,guards}.ts
│   ├── ai/{clients,prompts/,embeddings}.ts
│   ├── audit/{index,verify}.ts
│   ├── crypto/index.ts
│   ├── env.ts
│   └── utils/
├── actions/
│   ├── cases.ts
│   ├── images.ts
│   ├── annotations.ts
│   ├── comments.ts
│   ├── reports.ts
│   └── admin.ts
├── tests/{unit,e2e}/
├── public/
├── drizzle/{migrations}
├── PRODUCT.md
├── ARCHITECTURE.md
├── BUILD.md
└── .env.example
```

---

## 13. Key flows (sequence sketches)

### 13.1 Create case + upload image

```
Requester ──fill form──▶ /cases/new ──createCase()──▶ DB (case row + audit)
                            └──redirect──▶ /cases/[id]
Requester ──drop file──▶ client ──POST /api/upload/sign──▶ Server
                                  ◀──signed token──
client ──PUT blob──▶ Vercel Blob ──webhook──▶ /api/upload/complete
                                                  └──registerImage()──▶ DB (image row + audit)
                                                  └──revalidateTag(cases:detail:id)
client polling / live: image appears in gallery
```

### 13.2 Assign + AI brief

```
Admin ──assignCase()──▶ DB (status→assigned, audit)
                    └──void generateBrief(caseId)
                                  └──[async] Anthropic
                                                └──save brief, audit, revalidate
Consultant ──open case──▶ RSC reads brief status; Suspense streams "generating..." until ready
```

### 13.3 Signout

```
Consultant ──submit──▶ signOutReport(caseId, password)
                          ├──verify Argon2id
                          ├──snapshot report → reports row (status='signed', version+=1)
                          ├──compute signature_hash; logEvent(REPORT_SIGNED) chained
                          ├──generateEmbedding(caseId) → case_embeddings
                          ├──generate PDF → Blob → cases.signed_pdf_url
                          ├──email requester
                          └──cases.status = 'signed_out'; revalidate
```

---

## 14. Out of scope (MVP) — architectural implications

For each future feature, the touchpoint where it slots in:

| Feature | Where it lands |
|---|---|
| Native WSI ingest | New worker (Cloudflare Worker + R2 or AWS Batch); writes new `images.kind='dzi'` rows; viewer tile source switches |
| Real-time co-viewing | Add Pusher/Ably; viewport-changed events broadcast on case room |
| TOTP signers | Add `users.totp_secret`; verify before password |
| FHIR LIS push | New cron + outbound FHIR client; reads signed reports |
| Multi-tenant | Add `organisations` table; every row gains `org_id`; RLS via app guards |

---

## 15. Open technical questions

1. Pin Anthropic model — Sonnet 4.6 (Anthropic released `claude-sonnet-4-5-20250929`). Confirm latest at build time.
2. Voyage embedding dimension 1024 confirmed; verify Turso vector index supports the chosen dim at build time.
3. Vercel Mumbai region availability for compute — fall back to Singapore if unavailable.
4. R2 vs S3 Mumbai for production blob — decide before production rollout.
