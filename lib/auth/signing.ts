import { hash, verify } from "@node-rs/argon2";

// Argon2id params for the signing password (separate from session auth,
// ARCHITECTURE §10.2). Defaults are argon2id; set explicit cost params.
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashSigningPassword(password: string): Promise<string> {
  return hash(password, OPTS);
}

export async function verifySigningPassword(
  hashed: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}
