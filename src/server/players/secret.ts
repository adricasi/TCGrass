import { createHash, randomBytes } from "node:crypto";

const SECRET_BYTES = 32; // 256 bits (AC-002.2)
/** base64url of 32 bytes, unpadded. */
const SECRET_FORMAT = /^[A-Za-z0-9_-]{43}$/;

export function generateSecret(): string {
  return randomBytes(SECRET_BYTES).toString("base64url");
}

/** SHA-256 hex of the secret: the only form stored on the server (AC-002.9). */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function isWellFormedSecret(value: string): boolean {
  return SECRET_FORMAT.test(value);
}
