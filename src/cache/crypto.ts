import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Application-level encryption for the local cache. We store ciphertext in
 * plain SQLite rather than depending on a native SQLCipher build — the sensitive
 * fields (amounts, descriptions, counterparties, account names) never hit disk
 * in the clear.
 *
 * AES-256-GCM. Each record gets a fresh 12-byte IV; the stored blob is
 * iv(12) || authTag(16) || ciphertext. GCM's auth tag also detects tampering.
 *
 * Key handling for now: a 32-byte key in `<dataDir>/cache.key` (0600). Moving
 * this into the OS keychain is a tracked follow-up; the API
 * here won't change when that happens.
 */

const IV_BYTES = 12;
const KEY_BYTES = 32;

export class Cipher {
  constructor(private readonly key: Buffer) {}

  encryptJson(value: unknown): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const plaintext = Buffer.from(JSON.stringify(value), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  decryptJson<T>(blob: Buffer): T {
    const iv = blob.subarray(0, IV_BYTES);
    const authTag = blob.subarray(IV_BYTES, IV_BYTES + 16);
    const ciphertext = blob.subarray(IV_BYTES + 16);
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  }
}

/** Load the cache key from disk, generating one on first run. */
export async function loadOrCreateKey(dataDir: string): Promise<Buffer> {
  const keyPath = join(dataDir, "cache.key");
  try {
    const existing = await readFile(keyPath);
    if (existing.length === KEY_BYTES) return existing;
    throw new Error(`Cache key at ${keyPath} is malformed (${existing.length} bytes).`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    const key = randomBytes(KEY_BYTES);
    await mkdir(dirname(keyPath), { recursive: true });
    await writeFile(keyPath, key, { mode: 0o600 });
    await chmod(keyPath, 0o600); // enforce perms even if umask loosened them
    return key;
  }
}
