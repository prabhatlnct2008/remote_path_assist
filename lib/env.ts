import { z } from "zod";

/**
 * Validates server environment at boot. Import this from any server-only module
 * to fail fast on misconfiguration rather than at the first request.
 *
 * Required vars must be present in every environment. Service keys (AI, email,
 * blob) are optional so local dev boots without them — the dependent feature is
 * responsible for erroring clearly if invoked while its key is missing.
 */

const base64_32 = z
  .string()
  .refine(
    (v) => {
      try {
        return Buffer.from(v, "base64").length === 32;
      } catch {
        return false;
      }
    },
    { message: "must be base64 of exactly 32 bytes (openssl rand -base64 32)" },
  );

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),

  // Auth.js
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required"),
  AUTH_URL: z.url().optional(),

  // Database (Turso / libSQL)
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_AUTH_TOKEN: z.string().optional().default(""),

  // Field encryption — at least V1 required.
  ENCRYPTION_KEY_V1: base64_32,

  // External services — optional in dev; features degrade if absent.
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  VOYAGE_API_KEY: z.string().optional().default(""),
  RESEND_API_KEY: z.string().optional().default(""),
  EMAIL_FROM: z.string().default("pathconsult@aiims-pilot.in"),
  BLOB_READ_WRITE_TOKEN: z.string().optional().default(""),
  CRON_SECRET: z.string().optional().default(""),
  SENTRY_DSN: z.string().optional().default(""),
});

function parseEnv() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = parseEnv();

/**
 * Collects every configured AES key by version, e.g. { 1: <buf>, 2: <buf> }.
 * Reads ENCRYPTION_KEY_V{n} from process.env so rotation only needs a new var.
 */
export function encryptionKeys(): Record<number, Buffer> {
  const keys: Record<number, Buffer> = {};
  for (const [name, value] of Object.entries(process.env)) {
    const m = /^ENCRYPTION_KEY_V(\d+)$/.exec(name);
    if (m && value) {
      const buf = Buffer.from(value, "base64");
      if (buf.length === 32) keys[Number(m[1])] = buf;
    }
  }
  if (Object.keys(keys).length === 0) {
    throw new Error("No valid ENCRYPTION_KEY_V{n} found in environment");
  }
  return keys;
}

export const CURRENT_KEY_VERSION = (() => {
  return Math.max(...Object.keys(encryptionKeys()).map(Number));
})();
