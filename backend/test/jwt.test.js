import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { after, before, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { createTokenVerifier, JWT_AUDIENCE, JWT_ISSUER } from '../src/auth/jwt.js';

const pem = { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } };
const authKeys = generateKeyPairSync('rsa', { modulusLength: 2048, ...pem });
const attackerKeys = generateKeyPairSync('rsa', { modulusLength: 2048, ...pem });
const verifier = createTokenVerifier({ publicKey: authKeys.publicKey });

const claims = { username: 'alice' };
const goodOptions = { algorithm: 'RS256', expiresIn: 60, issuer: JWT_ISSUER, audience: JWT_AUDIENCE, subject: '1' };

function b64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

let server;
let baseUrl;

before(async () => {
  server = createApp({ tokenVerifier: verifier }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test('accepts a valid RS256 token from the auth server', () => {
  const token = jwt.sign(claims, authKeys.privateKey, goodOptions);
  assert.deepEqual(verifier.verify(token), { userId: '1', username: 'alice' });
});

test('rejects a token signed with a different private key', () => {
  const token = jwt.sign(claims, attackerKeys.privateKey, goodOptions);
  assert.equal(verifier.verify(token), null);
});

test('rejects a token whose payload was tampered with', () => {
  const [header, , signature] = jwt.sign(claims, authKeys.privateKey, goodOptions).split('.');
  const forgedPayload = b64url({ username: 'admin', sub: '1', exp: Math.floor(Date.now() / 1000) + 60, iss: JWT_ISSUER, aud: JWT_AUDIENCE });
  assert.equal(verifier.verify(`${header}.${forgedPayload}.${signature}`), null);
});

test('rejects an expired token', () => {
  const token = jwt.sign(
    { ...claims, exp: Math.floor(Date.now() / 1000) - 10 },
    authKeys.privateKey,
    { algorithm: 'RS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE, subject: '1' },
  );
  assert.equal(verifier.verify(token), null);
});

test('rejects a token without an exp claim', () => {
  const { expiresIn: _omit, ...noExpiry } = goodOptions;
  const token = jwt.sign(claims, authKeys.privateKey, noExpiry);
  assert.equal(verifier.verify(token), null);
});

test('rejects an unsigned "alg: none" token', () => {
  const payload = { username: 'alice', sub: '1', exp: Math.floor(Date.now() / 1000) + 60, iss: JWT_ISSUER, aud: JWT_AUDIENCE };
  const token = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(payload)}.`;
  assert.equal(verifier.verify(token), null);
});

test('rejects an HS256 token that uses the public key as the HMAC secret', async () => {
  const { createHmac } = await import('node:crypto');
  const payload = { username: 'alice', sub: '1', exp: Math.floor(Date.now() / 1000) + 60, iss: JWT_ISSUER, aud: JWT_AUDIENCE };
  const signingInput = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}`;
  const signature = createHmac('sha256', authKeys.publicKey).update(signingInput).digest('base64url');
  assert.equal(verifier.verify(`${signingInput}.${signature}`), null);
});

test('rejects an RS512 token even when signed with the real key', () => {
  const token = jwt.sign(claims, authKeys.privateKey, { ...goodOptions, algorithm: 'RS512' });
  assert.equal(verifier.verify(token), null);
});

test('rejects tokens with the wrong issuer or audience', () => {
  assert.equal(verifier.verify(jwt.sign(claims, authKeys.privateKey, { ...goodOptions, issuer: 'evil' })), null);
  assert.equal(verifier.verify(jwt.sign(claims, authKeys.privateKey, { ...goodOptions, audience: 'evil' })), null);
});

test('rejects garbage', () => {
  for (const value of [undefined, '', 'abc', 'a.b.c', 42]) {
    assert.equal(verifier.verify(value), null);
  }
});

test('GET /api/me returns 401 without a token', async () => {
  const response = await fetch(`${baseUrl}/api/me`);
  assert.equal(response.status, 401);
});

test('GET /api/me returns 401 for a forged token', async () => {
  const token = jwt.sign(claims, attackerKeys.privateKey, goodOptions);
  const response = await fetch(`${baseUrl}/api/me`, { headers: { cookie: `auth_token=${token}` } });
  assert.equal(response.status, 401);
});

test('GET /api/me returns the username from a valid token cookie', async () => {
  const token = jwt.sign(claims, authKeys.privateKey, goodOptions);
  const response = await fetch(`${baseUrl}/api/me`, { headers: { cookie: `other=1; auth_token=${token}` } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { username: 'alice' });
});
