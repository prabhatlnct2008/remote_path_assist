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

  // Field encryption. The Zod check is loose so Next's build-time module
  // collection (which has no real secrets) doesn't fail; the strict 32-byte
  // validation happens lazily inside encryptionKeys() at first use.
  ENCRYPTION_KEY_V1: z.string().optional().default(""),

  // External services — optional in dev; features degrade if absent.
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  VOYAGE_API_KEY: z.string().optional().default(""),
  RESEND_API_KEY: z.string().optional().default(""),
  EMAIL_FROM: z.string().default("pathconsult@aiims-pilot.in"),
  BLOB_READ_WRITE_TOKEN: z.string().optional().default(""),
  CRON_SECRET: z.string().optional().default(""),
  SENTRY_DSN: z.string().optional().default(""),
});

// During `next build`, Next loads server modules to collect page data; we
// don't require real secrets to be present at build time. Runtime is strict.
const isBuildPhase =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.SKIP_ENV_VALIDATION === "true";

function parseEnv() {
  const parsed = EnvSchema.safeParse(process.env);
  if (parsed.success) return parsed.data;
  if (isBuildPhase) {
    // Best-effort placeholders; the real values must be set at runtime.
    return EnvSchema.parse({
      ...process.env,
      AUTH_SECRET: process.env.AUTH_SECRET || "__build_stub__",
      DATABASE_URL: process.env.DATABASE_URL || "file:build.db",
    });
  }
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
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
    if (isBuildPhase) return { 1: Buffer.alloc(32) }; // stub for collect-page-data
    throw new Error("No valid ENCRYPTION_KEY_V{n} found in environment");
  }
  return keys;
}

/** Lazy — evaluated at first use so module load doesn't require real keys. */
export function currentKeyVersion(): number {
  return Math.max(...Object.keys(encryptionKeys()).map(Number));
}
