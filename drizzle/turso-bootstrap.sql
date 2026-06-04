-- ─────────────────────────────────────────────────────────────────────────────
-- PathConsult — Turso bootstrap script
-- ─────────────────────────────────────────────────────────────────────────────
-- Run this once in the Turso SQL console (Database → Edit → SQL or via
-- `turso db shell <db>`) on an EMPTY database. It creates the full schema
-- (migrations 0000 + 0001) and records them in drizzle's __drizzle_migrations
-- table so a later `pnpm db:migrate` is a no-op.
-- ─────────────────────────────────────────────────────────────────────────────

-- Drizzle bookkeeping table (must exist for db:migrate to skip these later).
CREATE TABLE IF NOT EXISTS `__drizzle_migrations` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `hash` TEXT NOT NULL,
  `created_at` NUMERIC
);

-- ── Migration 0000 ──────────────────────────────────────────────────────────

CREATE TABLE `accounts` (
  `user_id` text NOT NULL,
  `type` text NOT NULL,
  `provider` text NOT NULL,
  `provider_account_id` text NOT NULL,
  `refresh_token` text,
  `access_token` text,
  `expires_at` integer,
  `token_type` text,
  `scope` text,
  `id_token` text,
  `session_state` text,
  PRIMARY KEY(`provider`, `provider_account_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `annotations` (
  `id` text PRIMARY KEY NOT NULL,
  `image_id` text NOT NULL,
  `case_id` text NOT NULL,
  `author_id` text NOT NULL,
  `geometry_json` text NOT NULL,
  `label` text,
  `color` text DEFAULT '#F2A623' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `deleted_at` integer,
  FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE INDEX `annotations_image_idx` ON `annotations` (`image_id`,`deleted_at`);

CREATE TABLE `case_embeddings` (
  `case_id` text PRIMARY KEY NOT NULL,
  `content_kind` text DEFAULT 'summary' NOT NULL,
  `embedding` F32_BLOB(1024) NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE TABLE `case_events` (
  `id` text PRIMARY KEY NOT NULL,
  `case_id` text NOT NULL,
  `actor_id` text,
  `actor_kind` text NOT NULL,
  `event_type` text NOT NULL,
  `payload_json` text DEFAULT '{}' NOT NULL,
  `occurred_at` integer NOT NULL,
  `prev_hash` text NOT NULL,
  `hash` text NOT NULL,
  FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT "case_events_actor_kind_chk" CHECK("case_events"."actor_kind" in ('user','ai','system'))
);
CREATE INDEX `case_events_case_time_idx` ON `case_events` (`case_id`,`occurred_at`);
CREATE INDEX `case_events_case_id_desc_idx` ON `case_events` (`case_id`,`id`);

CREATE TABLE `case_sequences` (
  `year` integer PRIMARY KEY NOT NULL,
  `last_number` integer DEFAULT 0 NOT NULL
);

CREATE TABLE `cases` (
  `id` text PRIMARY KEY NOT NULL,
  `case_number` text NOT NULL,
  `patient_ref` text NOT NULL,
  `age` integer NOT NULL,
  `sex` text NOT NULL,
  `clinical_history` text NOT NULL,
  `specimen_type` text NOT NULL,
  `priority` text NOT NULL,
  `status` text DEFAULT 'submitted' NOT NULL,
  `needs_more_material` integer DEFAULT false NOT NULL,
  `consent_confirmed` integer NOT NULL,
  `consent_at` integer NOT NULL,
  `created_by` text NOT NULL,
  `assigned_to` text,
  `assigned_at` integer,
  `signed_out_by` text,
  `signed_out_at` integer,
  `signed_pdf_url` text,
  `ai_brief_md` text,
  `ai_brief_status` text DEFAULT 'idle',
  `sla_due_at` integer,
  `encryption_key_version` integer DEFAULT 1 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`signed_out_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT "cases_sex_chk" CHECK("cases"."sex" in ('M','F','Other')),
  CONSTRAINT "cases_priority_chk" CHECK("cases"."priority" in ('routine','urgent','stat')),
  CONSTRAINT "cases_status_chk" CHECK("cases"."status" in ('submitted','assigned','in_review','reported','signed_out'))
);
CREATE UNIQUE INDEX `cases_case_number_uq` ON `cases` (`case_number`);
CREATE INDEX `cases_assignee_idx` ON `cases` (`assigned_to`,`status`,`created_at`);
CREATE INDEX `cases_creator_idx` ON `cases` (`created_by`,`created_at`);
CREATE INDEX `cases_admin_idx` ON `cases` (`status`,`priority`,`created_at`);

CREATE TABLE `comments` (
  `id` text PRIMARY KEY NOT NULL,
  `case_id` text NOT NULL,
  `author_id` text,
  `actor_kind` text DEFAULT 'user' NOT NULL,
  `body` text NOT NULL,
  `parent_id` text,
  `ai_metadata` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `deleted_at` integer,
  `edit_locked_at` integer,
  FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE INDEX `comments_case_idx` ON `comments` (`case_id`,`created_at`);

CREATE TABLE `images` (
  `id` text PRIMARY KEY NOT NULL,
  `case_id` text NOT NULL,
  `filename` text NOT NULL,
  `blob_url` text NOT NULL,
  `blob_pathname` text NOT NULL,
  `content_type` text NOT NULL,
  `size_bytes` integer NOT NULL,
  `width` integer,
  `height` integer,
  `kind` text DEFAULT 'static' NOT NULL,
  `uploaded_by` text NOT NULL,
  `uploaded_at` integer NOT NULL,
  `deleted_at` integer,
  FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE INDEX `images_case_idx` ON `images` (`case_id`,`uploaded_at`);

CREATE TABLE `invitations` (
  `id` text PRIMARY KEY NOT NULL,
  `email` text NOT NULL,
  `role` text NOT NULL,
  `subspecialty` text DEFAULT '' NOT NULL,
  `invited_by` text NOT NULL,
  `expires_at` integer NOT NULL,
  `accepted_at` integer,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE INDEX `invitations_email_idx` ON `invitations` (`email`,`accepted_at`);

CREATE TABLE `reports` (
  `id` text PRIMARY KEY NOT NULL,
  `case_id` text NOT NULL,
  `version` integer DEFAULT 1 NOT NULL,
  `body_md` text DEFAULT '' NOT NULL,
  `microscopy` text DEFAULT '' NOT NULL,
  `diagnosis` text DEFAULT '' NOT NULL,
  `differential` text DEFAULT '' NOT NULL,
  `recommendations` text DEFAULT '' NOT NULL,
  `ihc_json` text DEFAULT '[]' NOT NULL,
  `ai_draft_md` text,
  `status` text DEFAULT 'draft' NOT NULL,
  `signed_at` integer,
  `signed_by` text,
  `signature_hash` text,
  `encryption_key_version` integer DEFAULT 1 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`signed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT "reports_status_chk" CHECK("reports"."status" in ('draft','signed'))
);
CREATE INDEX `reports_case_version_idx` ON `reports` (`case_id`,`version`);
CREATE INDEX `reports_case_status_idx` ON `reports` (`case_id`,`status`);

CREATE TABLE `sessions` (
  `session_token` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `expires` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `users` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text DEFAULT '' NOT NULL,
  `email` text NOT NULL,
  `email_verified` integer,
  `image` text,
  `role` text DEFAULT 'requester' NOT NULL,
  `subspecialty` text DEFAULT '' NOT NULL,
  `active` integer DEFAULT false NOT NULL,
  `signing_password` text,
  `signing_locked_until` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  CONSTRAINT "users_role_chk" CHECK("users"."role" in ('requester','consultant','admin'))
);
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`);
CREATE INDEX `users_role_active_idx` ON `users` (`role`,`active`);

CREATE TABLE `verification_tokens` (
  `identifier` text NOT NULL,
  `token` text NOT NULL,
  `expires` integer NOT NULL,
  PRIMARY KEY(`identifier`, `token`)
);

-- libSQL native vector index for case similarity search.
CREATE INDEX `case_embeddings_idx` ON `case_embeddings` (libsql_vector_idx(`embedding`));

-- ── Migration 0001 ──────────────────────────────────────────────────────────
-- UNIQUE(case_id, prev_hash) — makes a concurrent fork of the audit chain
-- a constraint violation we can retry on (ARCHITECTURE §4.9).
CREATE UNIQUE INDEX `case_events_case_prevhash_uq` ON `case_events` (`case_id`,`prev_hash`);

-- ── Mark both migrations as applied so `pnpm db:migrate` is a no-op later ──
INSERT INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES
  ('e2e79877c635e845b916a80692cc37ebb2fc50d97f8b3d454823d0152977cc81', strftime('%s','now') * 1000),
  ('b33109e8e8fe9fab9ffa9a7f97558a62bb353fff16a63e10904a464604013da4', strftime('%s','now') * 1000);
