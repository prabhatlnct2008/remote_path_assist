import { describe, expect, it } from "vitest";
import { decrypt, encrypt, keyVersionOf } from "@/lib/crypto";

describe("field encryption", () => {
  it("round-trips utf-8 text", () => {
    const plaintext = "Patient presents with a 2cm breast mass — ER+/PR+. ✔";
    const ct = encrypt(plaintext);
    expect(ct).not.toContain(plaintext);
    expect(decrypt(ct)).toBe(plaintext);
  });

  it("produces the v{N}:iv:tag:ct format with a fresh IV each time", () => {
    const a = encrypt("same input");
    const b = encrypt("same input");
    expect(a).toMatch(/^v\d+:[^:]+:[^:]+:[^:]+$/);
    expect(a).not.toBe(b); // random IV ⇒ different ciphertext
    expect(decrypt(a)).toBe(decrypt(b));
  });

  it("encodes and reads the key version", () => {
    const ct = encrypt("x", 2);
    expect(keyVersionOf(ct)).toBe(2);
    expect(decrypt(ct)).toBe("x");
  });

  it("rejects tampered ciphertext (GCM auth tag)", () => {
    const ct = encrypt("tamper me");
    const parts = ct.split(":");
    const ctBuf = Buffer.from(parts[3], "base64");
    ctBuf[0] ^= 0xff;
    const tampered = [parts[0], parts[1], parts[2], ctBuf.toString("base64")].join(":");
    expect(() => decrypt(tampered)).toThrow();
  });

  it("rejects malformed payloads", () => {
    expect(() => decrypt("not-a-ciphertext")).toThrow();
    expect(() => decrypt("v1:only:three")).toThrow();
  });
});
