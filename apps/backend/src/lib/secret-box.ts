/**
 * Encryption for credentials a customer hands us: the directory connection's
 * Google refresh token or service-account key (organization accounts round 1,
 * stream Offboarding; rubric OB-M2).
 *
 * AES-256-GCM with a random 96-bit IV per value. The row's owner (the
 * organization id) is bound in as additional authenticated data, so a
 * ciphertext copied onto another organization's row fails to decrypt. The key
 * is DIRECTORY_CREDENTIALS_KEY, 32 bytes as 64 hex characters or base64, held
 * only in the deployment's secrets; `keyVersion` is stored beside each value
 * so the key can be rotated by re-encrypting (a backlog item). Nothing here
 * logs a plaintext, a key or a ciphertext.
 */

import crypto from "node:crypto";

export const SECRET_BOX_KEY_VERSION = 1;

export interface SealedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: number;
}

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretBoxError";
  }
}

/**
 * The key from its environment value, or null when unset. Throws on a value
 * that is set but isn't 32 bytes, so a mistyped secret stops startup rather
 * than failing every connection later.
 */
export function secretBoxKey(raw: string | undefined = process.env["DIRECTORY_CREDENTIALS_KEY"]): Buffer | null {
  const value = raw?.trim();
  if (!value) return null;
  const key = /^[0-9a-fA-F]{64}$/.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) throw new SecretBoxError("DIRECTORY_CREDENTIALS_KEY must be 32 bytes (64 hex characters or base64)");
  return key;
}

export function seal(key: Buffer, plaintext: string, owner: string): SealedSecret {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(owner, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    keyVersion: SECRET_BOX_KEY_VERSION,
  };
}

export function open(key: Buffer, sealed: SealedSecret, owner: string): string {
  if (sealed.keyVersion !== SECRET_BOX_KEY_VERSION) throw new SecretBoxError(`no key for version ${sealed.keyVersion}`);
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
    decipher.setAAD(Buffer.from(owner, "utf8"));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretBoxError("the credential could not be decrypted");
  }
}
