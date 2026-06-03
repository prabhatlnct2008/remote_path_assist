import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { currentKeyVersion, encryptionKeys } from "@/lib/env";

/**
 * Field-level AES-256-GCM encryption for columns marked [encrypted] in
 * ARCHITECTURE §4. On-disk format (ARCHITECTURE §5):
 *
 *   v{N}:<base64-iv>:<base64-tag>:<base64-ciphertext>
 *
 * The version prefix selects the key, enabling rotation: add ENCRYPTION_KEY_V2,
 * re-encrypt sweeping rows, and bump their `*_key_version` column.
 */

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

function keyForVersion(version: number): Buffer {
  const key = encryptionKeys()[version];
  if (!key) {
    throw new Error(`No encryption key configured for version ${version}`);
  }
  return key;
}

export function encrypt(
  plaintext: string,
  keyVersion: number = currentKeyVersion(),
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, keyForVersion(keyVersion), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    `v${keyVersion}`,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decrypt(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4) {
    throw new Error("Malformed ciphertext: expected 4 colon-delimited parts");
  }
  const [versionTag, ivB64, tagB64, ctB64] = parts;
  const m = /^v(\d+)$/.exec(versionTag);
  if (!m) throw new Error(`Malformed version prefix: ${versionTag}`);

  const decipher = createDecipheriv(
    ALGO,
    keyForVersion(Number(m[1])),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Returns the key version encoded in a ciphertext payload. */
export function keyVersionOf(payload: string): number {
  const m = /^v(\d+):/.exec(payload);
  if (!m) throw new Error("Cannot read key version from payload");
  return Number(m[1]);
}
