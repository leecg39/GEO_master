import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDatabasePath } from "./db";

const VERSION = "v1";

export class SecretDecryptionError extends Error {
  constructor() {
    super("저장된 API 키를 복호화할 수 없습니다. 설정에서 키를 다시 저장해 주세요.");
    this.name = "SecretDecryptionError";
  }
}

function keyMaterial() {
  const configured = process.env.GEO_MASTER_KEY?.trim();
  if (configured) return configured;

  const keyPath = path.join(path.dirname(getDatabasePath()), ".master-key");
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  if (!fs.existsSync(keyPath)) {
    try {
      fs.writeFileSync(keyPath, crypto.randomBytes(32).toString("base64"), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
    }
  }
  try {
    fs.chmodSync(keyPath, 0o600);
  } catch {
    // 일부 파일시스템은 chmod를 지원하지 않는다. 읽기는 계속 시도한다.
  }
  return fs.readFileSync(keyPath, "utf8").trim();
}

function encryptionKey() {
  return crypto.createHash("sha256").update(keyMaterial()).digest();
}

export function encryptSecret(value: string | null | undefined) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptSecret(value: string | null | undefined) {
  if (!value) return null;
  try {
    const [version, ivText, tagText, encryptedText] = value.split(":");
    if (version !== VERSION || !ivText || !tagText || !encryptedText) throw new Error("invalid payload");
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(ivText, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagText, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new SecretDecryptionError();
  }
}

export function maskSecret(value: string | null) {
  if (!value) return null;
  const suffix = value.slice(-4);
  return `••••••••${suffix}`;
}
