import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface KeyPair { privateKey: string; publicKey: string }

/**
 * Loads the RS256 signing key, creating it the first time the auth server starts.
 * Both files live in Docker volumes, so the same key survives restarts and old JWTs stay valid.
 * The private key volume is mounted only in the auth container; the public key volume is shared read-only.
 */
export function loadOrCreateKeys(privateKeyPath: string, publicKeyPath: string): KeyPair {
  if (!existsSync(privateKeyPath)) {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    mkdirSync(dirname(privateKeyPath), { recursive: true });
    writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
  }
  const privateKey = readFileSync(privateKeyPath, "utf8");

  // The public key is derived from the private key on every start, so the two can never get out of sync.
  const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  mkdirSync(dirname(publicKeyPath), { recursive: true });
  writeFileSync(publicKeyPath, publicKey);
  return { privateKey, publicKey };
}