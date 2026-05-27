import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** Unix-ms timestamp column that defaults to now on insert. */
const ts = (name: string) =>
  integer(name, { mode: "number" }).notNull().$defaultFn(() => Date.now());

/** libSQL native fixed-size float32 vector, for the embeddings index. */
const f32Blob = (name: string, dims: number) =>
  customType<{ data: Buffer; driverData: Buffer }>({
    dataType() {
      return `F32_BLOB(${dims})`;
    },
  })(name);

const cuid = (name: string) => text(name).$defaultFn(() => createId());

// ─── users (extends the Auth.js user with domain columns) ────────────────────
export const users = sqliteTable(
  "users",
  {
    id: cuid("id").primaryKey(),
    name: text("name").notNull().default(""),
    email: text("email").notNull(),
    emailVerified: integer("email_verified", { mode: "timestamp_ms" }),
    image: text("image"),
    role: text("role").notNull().default("requester").$type<
      "requester" | "consultant" | "admin"
    >(),
    subspecialty: text("subspecialty").notNull().default(""),
    active: integer("active", { mode: "boolean" }).notNull().default(false),
    signingPassword: text("signing_password"),
    signingLockedUntil: integer("signing_locked_until", { mode: "number" }),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [
    uniqueIndex("users_email_uq").on(t.email),
    index("users_role_active_idx").on(t.role, t.active),
    check("users_role_chk", sql`${t.role} in ('requester','consultant','admin')`),
  ],
);

// ─── Auth.js standard tables (do not modify shape) ───────────────────────────
export const accounts = sqliteTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = sqliteTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
});

export const verificationTokens = sqliteTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ─── cases ───────────────────────────────────────────────────────────────────
export const cases = sqliteTable(
  "cases",
  {
    id: cuid("id").primaryKey(),
    caseNumber: text("case_number").notNull(),
    patientRef: text("patient_ref").notNull(), // [encrypted]
    age: integer("age").notNull(),
    sex: text("sex").notNull().$type<"M" | "F" | "Other">(),
    clinicalHistory: text("clinical_history").notNull(), // [encrypted]
    specimenType: text("specimen_type").notNull(),
    priority: text("priority").notNull().$type<"routine" | "urgent" | "stat">(),
    status: text("status")
      .notNull()
      .default("submitted")
      .$type<"submitted" | "assigned" | "in_review" | "reported" | "signed_out">(),
    needsMoreMaterial: integer("needs_more_material", { mode: "boolean" })
      .notNull()
      .default(false),
    consentConfirmed: integer("consent_confirmed", { mode: "boolean" }).notNull(),
    consentAt: integer("consent_at", { mode: "number" }).notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    assignedTo: text("assigned_to").references(() => users.id),
    assignedAt: integer("assigned_at", { mode: "number" }),
    signedOutBy: text("signed_out_by").references(() => users.id),
    signedOutAt: integer("signed_out_at", { mode: "number" }),
    signedPdfUrl: text("signed_pdf_url"),
    aiBriefMd: text("ai_brief_md"),
    aiBriefStatus: text("ai_brief_status")
      .$type<"idle" | "generating" | "ready" | "error">()
      .default("idle"),
    slaDueAt: integer("sla_due_at", { mode: "number" }),
    encryptionKeyVersion: integer("encryption_key_version").notNull().default(1),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [
    uniqueIndex("cases_case_number_uq").on(t.caseNumber),
    index("cases_assignee_idx").on(t.assignedTo, t.status, t.createdAt),
    index("cases_creator_idx").on(t.createdBy, t.createdAt),
    index("cases_admin_idx").on(t.status, t.priority, t.createdAt),
    check("cases_sex_chk", sql`${t.sex} in ('M','F','Other')`),
    check("cases_priority_chk", sql`${t.priority} in ('routine','urgent','stat')`),
    check(
      "cases_status_chk",
      sql`${t.status} in ('submitted','assigned','in_review','reported','signed_out')`,
    ),
  ],
);

// ─── case_sequences (atomic case-number generation) ──────────────────────────
export const caseSequences = sqliteTable("case_sequences", {
  year: integer("year").primaryKey(),
  lastNumber: integer("last_number").notNull().default(0),
});

// ─── images ───────────────────────────────────────────────────────────────────
export const images = sqliteTable(
  "images",
  {
    id: cuid("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id),
    filename: text("filename").notNull(),
    blobUrl: text("blob_url").notNull(),
    blobPathname: text("blob_pathname").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    kind: text("kind").notNull().default("static"),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => users.id),
    uploadedAt: ts("uploaded_at"),
    deletedAt: integer("deleted_at", { mode: "number" }),
  },
  (t) => [index("images_case_idx").on(t.caseId, t.uploadedAt)],
);

// ─── annotations ───────────────────────────────────────────────────────────────
export const annotations = sqliteTable(
  "annotations",
  {
    id: cuid("id").primaryKey(),
    imageId: text("image_id")
      .notNull()
      .references(() => images.id),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    geometryJson: text("geometry_json").notNull(),
    label: text("label"),
    color: text("color").notNull().default("#F2A623"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
    deletedAt: integer("deleted_at", { mode: "number" }),
  },
  (t) => [index("annotations_image_idx").on(t.imageId, t.deletedAt)],
);

// ─── comments ───────────────────────────────────────────────────────────────────
export const comments = sqliteTable(
  "comments",
  {
    id: cuid("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id),
    authorId: text("author_id").references(() => users.id), // null when ai
    actorKind: text("actor_kind").notNull().default("user").$type<"user" | "ai">(),
    body: text("body").notNull(),
    parentId: text("parent_id"),
    aiMetadata: text("ai_metadata"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
    deletedAt: integer("deleted_at", { mode: "number" }),
    editLockedAt: integer("edit_locked_at", { mode: "number" }),
  },
  (t) => [index("comments_case_idx").on(t.caseId, t.createdAt)],
);

// ─── reports ───────────────────────────────────────────────────────────────────
export const reports = sqliteTable(
  "reports",
  {
    id: cuid("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id),
    version: integer("version").notNull().default(1),
    bodyMd: text("body_md").notNull().default(""), // [encrypted]
    microscopy: text("microscopy").notNull().default(""), // [encrypted]
    diagnosis: text("diagnosis").notNull().default(""), // [encrypted]
    differential: text("differential").notNull().default(""), // [encrypted]
    recommendations: text("recommendations").notNull().default(""), // [encrypted]
    ihcJson: text("ihc_json").notNull().default("[]"),
    aiDraftMd: text("ai_draft_md"),
    status: text("status").notNull().default("draft").$type<"draft" | "signed">(),
    signedAt: integer("signed_at", { mode: "number" }),
    signedBy: text("signed_by").references(() => users.id),
    signatureHash: text("signature_hash"),
    encryptionKeyVersion: integer("encryption_key_version").notNull().default(1),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [
    index("reports_case_version_idx").on(t.caseId, t.version),
    index("reports_case_status_idx").on(t.caseId, t.status),
    check("reports_status_chk", sql`${t.status} in ('draft','signed')`),
  ],
);

// ─── case_events (append-only audit, hash-chained) ───────────────────────────
export const caseEvents = sqliteTable(
  "case_events",
  {
    id: cuid("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id),
    actorId: text("actor_id").references(() => users.id),
    actorKind: text("actor_kind").notNull().$type<"user" | "ai" | "system">(),
    eventType: text("event_type").notNull(),
    payloadJson: text("payload_json").notNull().default("{}"),
    occurredAt: integer("occurred_at", { mode: "number" }).notNull(),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [
    index("case_events_case_time_idx").on(t.caseId, t.occurredAt),
    index("case_events_case_id_desc_idx").on(t.caseId, t.id),
    check(
      "case_events_actor_kind_chk",
      sql`${t.actorKind} in ('user','ai','system')`,
    ),
  ],
);

// ─── case_embeddings (Turso native vector index) ─────────────────────────────
export const caseEmbeddings = sqliteTable("case_embeddings", {
  caseId: text("case_id")
    .primaryKey()
    .references(() => cases.id),
  contentKind: text("content_kind").notNull().default("summary"),
  embedding: f32Blob("embedding", 1024).notNull(),
  createdAt: ts("created_at"),
});

// ─── invitations ───────────────────────────────────────────────────────────────
export const invitations = sqliteTable(
  "invitations",
  {
    id: cuid("id").primaryKey(),
    email: text("email").notNull(),
    role: text("role").notNull(),
    subspecialty: text("subspecialty").notNull().default(""),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => users.id),
    expiresAt: integer("expires_at", { mode: "number" }).notNull(),
    acceptedAt: integer("accepted_at", { mode: "number" }),
    createdAt: ts("created_at"),
  },
  (t) => [index("invitations_email_idx").on(t.email, t.acceptedAt)],
);

export type User = typeof users.$inferSelect;
export type Case = typeof cases.$inferSelect;
export type NewCase = typeof cases.$inferInsert;
export type Image = typeof images.$inferSelect;
export type Annotation = typeof annotations.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type CaseEvent = typeof caseEvents.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
