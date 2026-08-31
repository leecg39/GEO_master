import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, maskSecret, SecretDecryptionError } from "@/lib/crypto";

const previousKey = process.env.GEO_MASTER_KEY;
beforeAll(() => { process.env.GEO_MASTER_KEY = "test-only-master-key-with-at-least-32-characters"; });
afterAll(() => { if (previousKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = previousKey; });

describe("secret storage", () => {
  it("encrypts without retaining plaintext and decrypts exactly", () => {
    const secret = "sk-test-super-secret-1234";
    const encrypted = encryptSecret(secret)!;
    expect(encrypted).not.toContain(secret);
    expect(encrypted.startsWith("v1:")).toBe(true);
    expect(decryptSecret(encrypted)).toBe(secret);
    expect(maskSecret(secret)).toBe("••••••••1234");
  });
  it("fails closed when ciphertext is modified", () => {
    const encrypted = encryptSecret("secret")!;
    const modified = `${encrypted.slice(0, -2)}aa`;
    expect(() => decryptSecret(modified)).toThrow(SecretDecryptionError);
  });
});
