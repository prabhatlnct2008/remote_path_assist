// Canonical enums from PRODUCT.md. The subspecialty list is pending final
// confirmation from the AIIMS pathology department (PRODUCT §19.1).

export const ROLES = ["requester", "consultant", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const SUBSPECIALTIES = [
  "gastrointestinal",
  "breast",
  "derm",
  "gynae",
  "heme",
  "head_neck",
  "renal",
  "lung",
  "bone_soft_tissue",
  "cytopathology",
  "other",
] as const;
export type Subspecialty = (typeof SUBSPECIALTIES)[number];

export const SPECIMEN_TYPES = [
  "biopsy",
  "excision",
  "resection",
  "cytology",
  "frozen_section",
  "cell_block",
  "other",
] as const;
export type SpecimenType = (typeof SPECIMEN_TYPES)[number];

export const PRIORITIES = ["routine", "urgent", "stat"] as const;
export type Priority = (typeof PRIORITIES)[number];

// SLA windows in ms from assignment (PRODUCT §4.4) — pending confirmation §19.4.
export const SLA_MS: Record<Priority, number> = {
  routine: 24 * 60 * 60 * 1000,
  urgent: 4 * 60 * 60 * 1000,
  stat: 1 * 60 * 60 * 1000,
};

export const CASE_STATUSES = [
  "submitted",
  "assigned",
  "in_review",
  "reported",
  "signed_out",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Image upload limits (PRODUCT §5.1).
export const IMAGE_MAX_BYTES = 100 * 1024 * 1024;
export const IMAGE_MAX_PER_CASE = 20;
export const IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/webp",
] as const;

// Uploads are allowed only in these statuses (PRODUCT §5.2).
export const UPLOADABLE_STATUSES: CaseStatus[] = ["submitted", "assigned", "in_review"];
