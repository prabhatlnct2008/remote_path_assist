# PRODUCT.md — PathConsult functional specification

> A remote pathology consultation platform for AIIMS Delhi. This document lists every functionality in the MVP. Implementation details are in `ARCHITECTURE.md`; the build process is in `BUILD.md`.

---

## 1. Product summary

PathConsult lets pathology residents at AIIMS submit consultation requests with slide images and clinical context. Senior pathologists (consultants) review assigned cases, draft and sign reports, and the requesting resident receives the signed report as PDF. An AI co-pilot assists the consultant with a pre-review brief, a case-scoped chat, and a draft report generator. The diagnostic decision is always the pathologist's.

The MVP is a single-tenant deployment for AIIMS Delhi's pathology department. Multi-tenancy is out of scope for MVP but the data model supports it.

---

## 2. Users and roles

Three roles. A user has exactly one role.

| Role | Who | Primary actions |
|---|---|---|
| Requester | Residents, junior pathologists | Create cases, upload images, add clinical history, view final report |
| Consultant | Senior/attending pathologists | Review assigned cases, annotate, comment, draft report, sign out |
| Admin | Department coordinator, IT contact | Invite users, assign cases, view all cases (metadata only), manage system |

**Cross-cutting rules.**
- Every user must be explicitly invited; no self-signup.
- Users are inactive by default after invite acceptance; admin activates.
- Roles cannot be self-changed; only an admin can change another user's role.
- Admins cannot read patient-content fields (clinical history, report body) — they see metadata only.

---

## 3. Authentication

**3.1 Magic-link login.** Users enter an institutional email; a one-time link is sent via email; clicking the link logs them in. Links expire in 15 minutes.

**3.2 Invite flow.** Admin enters name + email + role + (optional) subspecialty list. The system sends an invitation email. First click on the link triggers user creation and login in one step. The user must enter their full name before the first session is established.

**3.3 Session.** Sessions are 7 days idle, 15 minutes access-token rotation. A session is revoked on sign-out, on password change (for signers), or by an admin via the admin user page.

**3.4 Re-authentication for signout.** Signing a report requires the consultant to re-enter their password (for MVP — TOTP is planned for v2). The password is set on first signout (a "set signing password" flow) and stored as an Argon2id hash separately from the magic-link flow.

**3.5 Sign-out.** A "Sign out" button in the top nav ends the session and redirects to the login page.

---

## 4. Cases

A *case* is the central object — one consultation request. It has a status, owner, optional assignee, images, annotations, comments, and (eventually) a report.

### 4.1 Fields

| Field | Required | Editable after | Visible to |
|---|---|---|---|
| Case number (auto) | system | never | all participants |
| Patient reference (MRN) | yes | until `Assigned` | participants only (decrypted), admin sees masked |
| Patient age | yes | until `Reported` | participants |
| Patient sex | yes | until `Reported` | participants |
| Clinical history (free text) | yes | until `Reported` | participants only (decrypted), admin sees masked |
| Specimen type (enum) | yes | until `Reported` | participants |
| Priority | yes | by admin/consultant any time | participants |
| Consent confirmed | yes | never (must be true to create) | participants |
| Created by, created at | system | never | participants |
| Assigned to, assigned at | by admin | until signed out | participants |
| Status | system | system | participants |
| Signed out by, signed out at | system at signout | never | participants |

### 4.2 Case number scheme

`AIIMS-PATH-YYYY-NNNNN` where YYYY is the current year and NNNNN is a zero-padded sequence number that resets each year. Generated atomically at creation.

### 4.3 Specimen types (enum)

`biopsy`, `excision`, `resection`, `cytology`, `frozen_section`, `cell_block`, `other`.

### 4.4 Priority levels (enum)

| Priority | SLA from assignment | Visual treatment |
|---|---|---|
| Routine | 24 hours | neutral badge |
| Urgent | 4 hours | amber badge |
| STAT | 1 hour | red badge, top of worklist |

### 4.5 Case status (state machine)

Five states. Transitions are gated by role and current state.

```
Submitted ──assign──> Assigned ──open──> In review ──draft──> Reported ──sign──> Signed out
                          ^                  │
                          └─── reassign ─────┘
```

Transitions:
- `Submitted → Assigned` — admin only.
- `Assigned → In review` — first time the assigned consultant opens the case detail page.
- `In review → Assigned` (reassignment) — current consultant or admin. Reason required.
- `In review → Reported` — consultant saves the first report draft.
- `Reported → In review` — consultant edits the draft (no state change actually; this is a UI affordance, the case stays `Reported` while the draft is edited; the state transitions only on signout).
- `Reported → Signed out` — consultant signs the report (terminal).

A signed-out case is **immutable**. New annotations, comments, edits, and image uploads are all blocked.

### 4.6 Soft flag: needs more material

Independent of state. The consultant flips a `needs_more_material` flag on the case with a comment ("please send PAS stain on block B2"). The requester sees this prominently on their worklist and can upload more images. The flag is cleared automatically when a new image is uploaded, or manually by the consultant.

### 4.7 Creating a case

**Who:** Requester (and admin).

**Form fields (in order):**
- Case number — auto-displayed, read-only.
- Patient MRN — required, max 64 chars, encrypted at rest.
- Age (years) — required, integer 0–120.
- Sex — required, enum (M/F/Other).
- Specimen type — required.
- Priority — required, default Routine.
- Clinical history — required, max 4000 chars, encrypted at rest.
- "I confirm patient consent obtained for digital consultation and review" — required checkbox.

**On submit:** Create case row, log `CASE_CREATED` event, redirect to case detail page where the user uploads images.

**Validation errors:** Show inline; preserve form data.

### 4.8 Worklist

The default landing page after login. Shows cases scoped to the user.

**Scope by role:**
- Requester: cases they created.
- Consultant: cases assigned to them.
- Admin: all cases.

**Columns:** Case number, Age/Sex, Specimen, Priority, Status, Created (relative time), SLA timer (if assigned), Last activity (relative).

**Default sort:** Priority desc, then created_at desc.

**Filters:** Status (multi-select), priority (multi-select), needs-more-material (toggle), date range.

**Search:** Free-text across case number; for admins, also across encrypted patient_ref (decrypt on read).

**Pagination:** 50 per page.

**Empty state:** Friendly message + link to create case (requesters/admin) or "no cases assigned yet" (consultants).

### 4.9 Case detail page

The hub for everything about a case.

**Layout (top to bottom):**
1. **Header band** — case number, status badge, priority badge, SLA timer, action buttons (Assign / Reassign / Draft report / Sign out / Mark needs more material), all role-gated.
2. **Patient and clinical card** — patient ref (masked for admin), age, sex, specimen type, consent timestamp.
3. **AI pre-review brief card** — shows brief, generating skeleton, or empty state. Consultant only.
4. **Image gallery** — thumbnails of all images. Click → opens viewer.
5. **Annotations panel** (collapsed) — list of annotations on current image.
6. **Comments thread** — chronological, includes AI-generated comments labeled clearly.
7. **AI chat sidebar** — collapsible, persists across visits. Consultant only.
8. **Audit timeline** (collapsed at bottom) — every event, with hash verification status.

### 4.10 Reassignment

Available to: current consultant, admin.

**Form fields:** New consultant (select from active consultants), reason (required text, max 500 chars).

**Behavior:** Case status returns to `Assigned`. Existing draft and annotations are preserved. The new consultant sees the prior consultant's work clearly attributed. Audit event logged with the reason. Email notification sent to both prior and new consultant.

---

## 5. Images

### 5.1 Supported formats

JPEG, PNG, TIFF, WebP. Maximum 100 MB per file. Maximum 20 images per case.

Out of scope for MVP: native whole-slide vendor formats (`.svs`, `.ndpi`, `.mrxs`).

### 5.2 Upload flow

Direct browser-to-blob upload via signed token (architecture detail in `ARCHITECTURE.md` §6.2). The user sees per-file progress, can cancel in flight, and sees a checkmark when each file completes.

**Validation:** File type check (client and server), size check (client and server), case status check (must be in `Submitted`, `Assigned`, or `In review` — uploads blocked after signout).

**On complete:** Image row created, case marked `updated_at`, audit event logged, `needs_more_material` auto-cleared.

**Error handling:** Network failure → automatic retry once, then surface error with a "retry" button.

### 5.3 Image gallery

Thumbnails in a horizontal scroll on the case page. Each thumbnail shows: filename, uploaded-by initials, upload time (relative), file size. Click opens the full viewer.

### 5.4 Image viewer

A full-window or in-page viewer using OpenSeadragon.

**Capabilities:**
- Zoom (scroll, pinch, +/− keys, buttons).
- Pan (drag, arrow keys).
- Fit-to-window (`F` key, button).
- Fullscreen (`Esc` exits).
- Switch image (`[` / `]` keys, thumbnail strip).
- Reset view (`R` key).
- Toggle annotations overlay (`A` key).

**Performance:** Viewer ready in < 1 second for static images. Pan/zoom at 60 fps on typical hardware.

### 5.5 Delete image

Only the uploader can delete an image, and only while the case is in `Submitted` status. After assignment, images cannot be deleted — only marked superseded.

---

## 6. Annotations

### 6.1 Tools

Point, rectangle, polygon, freehand line.

### 6.2 Properties

Each annotation has: geometry (in image-pixel coordinates, GeoJSON-style), optional text label (max 200 chars), color (preset palette of 8 colors), author, created/updated timestamps.

### 6.3 Permissions

- Anyone with case access can create annotations.
- Only the author can edit or delete their own annotations.
- A consultant can delete any annotation on cases assigned to them, with audit trail.
- Annotations on signed-out cases are immutable.

### 6.4 Visibility

All annotations visible to all case participants. Hover shows author name and label.

### 6.5 Persistence

Annotations save automatically on creation (immediate) and on edit (500 ms debounce). Optimistic UI; failed saves are retried.

---

## 7. Comments

### 7.1 Behavior

Per-case threaded comments. One level of nesting (reply to root, no replies-to-replies).

### 7.2 Format

Markdown supported with a strict allowlist: headings (h2–h4), bold, italic, code (inline + block), links, lists, blockquote. No images (images are uploaded as case images), no raw HTML.

### 7.3 Mentions

`@username` mentions auto-link and trigger an email notification to the mentioned user. The username dropdown autocompletes from case participants.

### 7.4 AI-generated comments

When the consultant uses the AI case chat, the question and AI response are persisted as a comment with `ai_generated = true`. These render with a distinct visual treatment (AI badge, slightly muted background) so they're never mistaken for human contributions.

### 7.5 Edit and delete

Authors can edit their own comments within 5 minutes of posting (after which they become immutable). Authors can delete their own comments at any time (a tombstone remains in the thread for context, with "[deleted]" body).

---

## 8. Assignment

### 8.1 Manual assignment (MVP)

Admin opens a case in `Submitted` status, clicks "Assign," selects a consultant from a list filtered by subspecialty (optional), and confirms. The case moves to `Assigned`, the consultant gets a notification, the AI brief generation kicks off.

### 8.2 Subspecialty hint

Each user can have one or more subspecialties (`gastrointestinal`, `breast`, `derm`, `gynae`, `heme`, `head_neck`, `renal`, `lung`, `bone_soft_tissue`, `cytopathology`, `other`). The assignment dropdown shows subspecialty next to the consultant's name. No auto-routing in MVP.

### 8.3 Out of scope (MVP)

Auto-assignment rules, workload balancing, on-call windows, second-pathologist peer review routing.

---

## 9. Reports

### 9.1 Structure

A report has the following structured fields plus a free-form section:

| Field | Type | Required for signout |
|---|---|---|
| Microscopy | Markdown text | yes |
| Diagnosis | Markdown text | yes |
| Differential considerations | Markdown text | no |
| Recommendations | Markdown text | no |
| IHC results | Array of `{ stain: string, result: 'positive' \| 'negative' \| 'equivocal', notes?: string }` | no |
| Additional notes | Markdown text | no |

### 9.2 Report editor

Available to: assigned consultant.

**UI:** Sections are stacked as cards with edit-in-place. The IHC results section is a repeatable row group.

**Auto-save:** Every 5 seconds after the last keystroke. The header shows "Saving…" / "Saved at HH:MM" status.

**Markdown preview:** Toggle to see the rendered preview alongside.

**Drafting from AI:** A "Draft with AI" button at the top. On click, AI fills in `microscopy`, `diagnosis`, `differential`, `recommendations`, and `ihc_suggested[]` from the clinical history, annotations, and brief. The consultant edits freely from there. The original AI output is preserved in `reports.ai_draft_md` for audit, separate from the editable `body_md`.

### 9.3 Signout

Available to: assigned consultant only.

**Pre-conditions:**
- Microscopy and diagnosis fields are non-empty.
- Status is `Reported`.
- Consultant has set a signing password (prompts a one-time set-password flow if not).

**Flow:**
1. Consultant clicks "Sign and publish."
2. Dialog appears with a final preview of the report.
3. Consultant enters signing password.
4. On submit:
   - Verify password.
   - Snapshot report content; lock it (no further edits).
   - Compute signature hash.
   - Write `REPORT_SIGNED` event with the hash chained into `case_events`.
   - Generate Voyage embedding of `clinical_history || diagnosis || microscopy` for future similarity search.
   - Generate the PDF; store in Blob; store URL on the case.
   - Send notification email to the requester.
   - Status transitions to `Signed out`.

**Wrong password:** Dialog stays open with error. Three wrong attempts in 10 minutes locks signout for that user for 30 minutes (and logs an event).

### 9.4 Signed report — requester view

Once signed, the case detail page shows a prominent "Download signed report" button leading to the PDF blob URL (signed, expires in 15 minutes — refetched on demand).

### 9.5 PDF format

A4 portrait. Sections in order: letterhead, case header (case number, dates, signer name, signer credentials), clinical history, microscopy, diagnosis, differential, IHC results table, recommendations, audit footer (chain summary: total event count, root hash, signer hash).

---

## 10. AI co-pilot

Three integrated features. All AI outputs are editable, all AI activity is logged with `actor_kind = 'ai'` in the audit trail. The AI never sees the patient reference field.

### 10.1 Pre-review brief

**Trigger:** Case status transitions to `Assigned`.

**Input:** Clinical history (decrypted), age, sex, specimen type, priority, and up to 4 representative images (the first 4 uploaded), downscaled to 1024 px on the longest edge.

**Output (Markdown):** A single section with three labeled sub-parts: "Key features," "Plausible considerations," "Suggested workup / IHC."

**Length budget:** ~400 words.

**Latency:** < 30 seconds end to end. The UI shows a "Brief generating…" skeleton until ready.

**Visibility:** Shown to the consultant on the case detail page. Not shown to the requester. Marked clearly as AI-generated.

**Regeneration:** Consultant can click "Regenerate" once new images are added.

### 10.2 Case chat

**Trigger:** Consultant types in the chat sidebar.

**Input:** Conversation history (this case only), the case context (clinical history, brief, annotations, structured fields), and the user's new message.

**Augmentation:** Before sending to the LLM, embed the user's message and vector-search the signed-out cases corpus for top-5 similar cases. Include their pseudonymized summaries (case number, diagnosis, salient features) in the context.

**Output:** Streamed text response, rendered with markdown. References to retrieved cases are formatted as `[CASE-XXXX-NNNN]` and click through to that case (if the user has access; otherwise show a "case not accessible" tooltip).

**Latency:** First token < 1.5 s, total response 5–15 s.

**Persistence:** Every chat round persists as two `comments` rows (question + AI response) with `ai_generated = true`.

**Scope rules:** The case chat can only retrieve from cases the consultant has access to. No cross-user data leak via similarity search.

### 10.3 Draft report

Documented in §9.2 above. Behavior:

**Trigger:** Consultant clicks "Draft with AI."

**Input:** Clinical history, pre-review brief, all annotations on all images (with labels), recent comments.

**Output:** Structured JSON, mapped to the report fields. Saved twice: as raw AI output in `reports.ai_draft_md` (immutable, for audit) and as the editable `body_md` derived from the same JSON.

**Latency:** 10–25 s. UI streams a per-field "Drafting…" indicator.

### 10.4 Embeddings on signout

When a report is signed, generate an embedding (Voyage `voyage-3-large`, 1024 dims) of the concatenated clinical history, diagnosis, and microscopy, and store in `case_embeddings`. This populates the corpus that case chat searches against. Adds ~200 ms to signout.

### 10.5 AI guardrails (system prompts)

Every AI prompt includes these instructions verbatim:
- "You are an assistant to a qualified pathologist. You do not make diagnoses. You suggest possibilities for the pathologist to verify."
- "Be specific. Use pathology terminology accurately. If you are uncertain, say so."
- "Do not invent clinical facts or patient identifiers. Refer to the patient only as 'the patient.'"
- "Do not output references to people, places, or external links."

---

## 11. Audit trail

### 11.1 Logged events

Every state-changing action writes a `case_events` row:

`CASE_CREATED, IMAGE_UPLOADED, IMAGE_DELETED, ANNOTATION_CREATED, ANNOTATION_UPDATED, ANNOTATION_DELETED, COMMENT_POSTED, COMMENT_EDITED, COMMENT_DELETED, CASE_ASSIGNED, CASE_REASSIGNED, CASE_OPENED, CASE_FLAGGED_NEEDS_MATERIAL, CASE_UNFLAGGED, REPORT_DRAFTED, REPORT_AUTO_SAVED, REPORT_SIGNED, AI_BRIEF_GENERATED, AI_CHAT_TURN, AI_DRAFT_GENERATED, USER_INVITED, USER_ACTIVATED, USER_ROLE_CHANGED, USER_DEACTIVATED`.

### 11.2 Event fields

`id, case_id, actor_id, actor_kind ('user' | 'ai' | 'system'), event_type, payload_json, occurred_at, prev_hash, hash`.

### 11.3 Hash chain

`hash = sha256(prev_hash || canonical_json(payload) || iso_timestamp)`. The genesis event for a case has `prev_hash = '0x' + '0' * 64`. Verification recomputes each hash forward; any mismatch flags tampering.

### 11.4 Audit page

`/cases/[id]/audit` — chronological list of all events for the case, with verification status next to each (green check if chain valid up to this point). A "Verify chain" button re-runs verification on demand.

### 11.5 Retention

Audit events are retained indefinitely. Case content (images, comments) follows the case retention policy (default 8 years from signout, then purged via cron — audit events for purged cases are retained with payloads redacted).

---

## 12. Notifications

Emails sent via Resend. All emails are plain-text-with-HTML, sender `pathconsult@aiims-pilot.in` (configurable).

| Trigger | Recipient | Subject |
|---|---|---|
| User invited | Invitee | "You've been invited to PathConsult" |
| Case assigned | Assigned consultant | "New case assigned: {case_number}" |
| Case reassigned | Previous and new consultant | "Case {case_number} has been reassigned" |
| Comment added | All case participants except author | "New comment on case {case_number}" |
| @-mention in comment | Mentioned user (only) | "{author} mentioned you on case {case_number}" |
| Needs more material flag | Requester | "Additional material requested for case {case_number}" |
| Report signed | Requester | "Your report is ready: case {case_number}" |
| SLA approaching (1 hr before breach) | Assigned consultant | "Case {case_number} SLA approaches" |
| SLA breached | Assigned consultant + admin | "SLA breached on case {case_number}" |
| Magic link | The user | "Your PathConsult login link" |

Notification preferences (per-user opt-out for non-critical emails) are out of scope for MVP. Magic-link and assignment notifications are non-opt-out.

---

## 13. Permissions matrix

R = requester, C = consultant, A = admin. Cell shows whether the role can perform the action; "own" means only on resources they created/are assigned to.

| Action | R | C | A |
|---|---|---|---|
| Create case | ✓ | ✗ | ✓ |
| View own case | ✓ | — | — |
| View assigned case | — | ✓ | — |
| View any case metadata | ✗ | ✗ | ✓ |
| View case content (history, images, report) | own | assigned | ✗ |
| Upload image to case | own (until signed) | assigned (until signed) | ✗ |
| Delete image | own (until assigned) | ✗ | ✗ |
| Create annotation | own | assigned | ✗ |
| Edit own annotation | own | own | ✗ |
| Delete any annotation on case | ✗ | assigned | ✗ |
| Post comment | own | assigned | ✗ |
| Edit own comment (≤ 5 min) | ✓ | ✓ | ✗ |
| Delete own comment | ✓ | ✓ | ✗ |
| Assign case | ✗ | ✗ | ✓ |
| Reassign case | ✗ | assigned | ✓ |
| Flag needs material | ✗ | assigned | ✗ |
| Draft report | ✗ | assigned | ✗ |
| Sign report | ✗ | assigned | ✗ |
| Download signed PDF | own | assigned | ✗ |
| Use AI brief / chat / draft | ✗ | assigned | ✗ |
| Invite user | ✗ | ✗ | ✓ |
| Activate/deactivate user | ✗ | ✗ | ✓ |
| Change user role | ✗ | ✗ | ✓ |
| View audit trail | own | assigned | ✓ |
| View system metrics | ✗ | ✗ | ✓ |

---

## 14. Admin functions

### 14.1 User management

`/admin/users`

- List all users with filters: role, active status, subspecialty.
- "Invite user" button: opens form (name, email, role, subspecialty[]).
- Per-user actions: activate, deactivate, change role, change subspecialty, resend invite link, view audit (user-level events).

### 14.2 Case management

`/admin/cases`

- List all cases (metadata only, content masked).
- Override assignment.
- View case audit (without content).

### 14.3 System

`/admin/system`

- Active sessions count.
- Case count by status.
- Storage usage.
- AI usage and cost (this month).
- Blob storage usage.
- Recent errors (last 50).

---

## 15. Search

### 15.1 Worklist search

Already covered in §4.8. Free-text on case number plus role-appropriate scope.

### 15.2 Case chat similarity search

Vector search of past signed-out cases for case chat (§10.2). Scoped to cases the searching user has access to. Not surfaced as a standalone search feature in MVP.

### 15.3 Out of scope

Cross-case full-text search across reports. Image content-based search. Diagnosis-keyword search.

---

## 16. Empty and error states

Every list and load surface has explicit treatment.

**Empty states with helpful guidance:**
- Worklist (no cases): role-specific message + CTA.
- Case detail (no images): "Add slide images to start the consultation."
- Case detail (no annotations): "No annotations yet. Use the viewer toolbar to add."
- Case chat (no messages): a starter prompt suggestion ("Ask me about this case…").
- Admin users: "Invite the first user to get started."

**Error states with retry:**
- Network error on load: "Couldn't reach the server. Retry."
- AI failure: "Brief generation failed. Retry."
- Upload failure: per-file row with "Retry" button.
- Permission denied: friendly 403 page with "Back to worklist."

**Not-found state:**
- Custom 404 page with link back to worklist.

---

## 17. Non-functional requirements

### 17.1 Performance

| Surface | Target |
|---|---|
| Landing TTFB | < 200 ms |
| Worklist LCP | < 2.0 s with 100 cases |
| Case detail LCP | < 2.5 s with 5 images |
| Image viewer ready (static) | < 1.0 s |
| Case chat first token | < 1.5 s |
| Page transitions | < 200 ms with prefetch |

### 17.2 Reliability

| Aspect | Target |
|---|---|
| Uptime | 99.5% during pilot |
| Daily DB backup | Automated, retained 30 days |
| Failed AI request | Auto-retry once, then surface error |
| Failed upload | Auto-retry once, then "retry" UI |

### 17.3 Compliance

- DPDPA-aligned: pseudonymized patient references, consent receipt per case, no PII in logs, append-only audit, data residency in India for the primary DB.
- 8-year retention default; configurable.
- No third-party analytics or trackers on authenticated pages.

### 17.4 Accessibility

- Keyboard navigation for all primary flows.
- WCAG AA color contrast.
- Screen-reader labels on icons.
- Focus management on dialogs.

### 17.5 Browser support

Chrome / Edge / Safari / Firefox — last 2 stable versions. Desktop only for MVP (mobile is read-only fallback if it happens to work).

---

## 18. Explicitly out of MVP scope

In priority order for v2+:

1. Native whole-slide image (`.svs`, `.ndpi`, `.mrxs`) ingestion.
2. Real-time co-viewing with shared cursors and voice channel.
3. TOTP / passkey 2FA for signers.
4. Auto-assignment rules with subspecialty + workload balancing.
5. Cross-case full-text search of reports.
6. FHIR `DiagnosticReport` push to LIS.
7. Mobile-optimized viewer.
8. Voice dictation in the report editor.
9. Multi-tenant deployment (other hospitals).
10. Custom report templates per specimen type.
11. Quality assurance / second-opinion workflow as a distinct state.
12. Notification opt-out preferences per user.
13. Bulk operations (assign 10 cases at once).
14. CSV/Excel export of case metadata.

---

## 19. Open product questions to resolve before week 2

1. Canonical subspecialty list from AIIMS pathology department.
2. AIIMS letterhead artwork and signer credential format for the PDF.
3. Retention period — confirm 8-year default.
4. SLA values — confirm 24h/4h/1h or adjust.
5. Sender email domain (`pathconsult@aiims.something`) and whether AIIMS IT will set up SPF/DKIM records.
6. Initial user list — names, emails, roles for the pilot group.
