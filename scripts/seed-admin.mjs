// Bootstrap the first admin (no admin exists to send the first invite).
// Usage: node --env-file=.env scripts/seed-admin.mjs <email> ["Full Name"]
import { createClient } from "@libsql/client";
import { createId } from "@paralleldrive/cuid2";

const email = (process.argv[2] ?? process.env.SEED_ADMIN_EMAIL ?? "").trim().toLowerCase();
const name = process.argv[3] ?? "Dr. Admin";

if (!email) {
  console.error("Usage: node --env-file=.env scripts/seed-admin.mjs <email> [name]");
  process.exit(1);
}

const client = createClient({
  url: process.env.DATABASE_URL ?? "file:local.db",
  authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
});

const now = Date.now();
const existing = await client.execute({
  sql: "SELECT id FROM users WHERE email = ?",
  args: [email],
});

if (existing.rows.length > 0) {
  await client.execute({
    sql: "UPDATE users SET role='admin', active=1, name=COALESCE(NULLIF(name,''), ?), updated_at=? WHERE email=?",
    args: [name, now, email],
  });
  console.log(`Updated existing user ${email} → active admin.`);
} else {
  await client.execute({
    sql: `INSERT INTO users (id, name, email, role, subspecialty, active, created_at, updated_at)
          VALUES (?, ?, ?, 'admin', '', 1, ?, ?)`,
    args: [createId(), name, email, now, now],
  });
  console.log(`Created active admin ${email}.`);
}
