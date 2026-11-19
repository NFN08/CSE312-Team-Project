import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Loads the RS256 signing key pair from disk, generating it on first start.
 *
 * The private key lives on a volume that only the auth container mounts, so it
 * survives restarts and is never visible to the game server. The public key is
 * written to a separate shared volume that the game server mounts read-only.
 */
export function loadOrCreateKeyPair({ privateKeyPath, publicKeyPath }) {
  let privateKey;
  let publicKey;

  if (existsSync(privateKeyPath) && existsSync(publicKeyPath)) {
    privateKey = readFileSync(privateKeyPath, 'utf8');
    publicKey = readFileSync(publicKeyPath, 'utf8');
    console.log('Loaded existing JWT signing key pair');
  } else {
    ({ privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    }));

    mkdirSync(dirname(privateKeyPath), { recursive: true, mode: 0o700 });
    mkdirSync(dirname(publicKeyPath), { recursive: true });
    writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
    writeFileSync(publicKeyPath, publicKey, { mode: 0o644 });
    console.log('Generated a new JWT signing key pair');
  }

  return { privateKey, publicKey };
}
