import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { createAuthApp, JWT_AUDIENCE, JWT_ISSUER } from '../src/app.js';
import { loadOrCreateKeyPair } from '../src/keys.js';
import { createMemoryUserStore } from '../src/userStore.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

let server;
let baseUrl;

before(async () => {
  const app = createAuthApp({ userStore: createMemoryUserStore(), privateKey, tokenTtlSeconds: 3600 });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

function post(path, body, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    redirect: 'manual',
  });
}

function tokenFrom(response) {
  const cookie = response.headers.get('set-cookie') ?? '';
  return { cookie, token: /auth_token=([^;]*)/.exec(cookie)?.[1] };
}

test('registers a new account', async () => {
  const response = await post('/register', { username: 'alice', password: 'correct horse' });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { username: 'alice' });
  assert.equal(response.headers.get('set-cookie'), null);
});

test('rejects duplicate usernames case-insensitively', async () => {
  const response = await post('/register', { username: 'ALICE', password: 'another password' });
  assert.equal(response.status, 409);
});

test('rejects invalid usernames and short passwords', async () => {
  assert.equal((await post('/register', { username: '<script>', password: 'password123' })).status, 400);
  assert.equal((await post('/register', { username: 'ab', password: 'password123' })).status, 400);
  assert.equal((await post('/register', { username: 'bob', password: 'short' })).status, 400);
  assert.equal((await post('/register', { username: 'bob', password: 'x'.repeat(73) })).status, 400);
  assert.equal((await post('/register', { username: ['bob'], password: 'password123' })).status, 400);
});

test('rejects non-JSON submissions (XSRF via HTML form)', async () => {
  const response = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'username=alice&password=correct+horse',
  });
  assert.equal(response.status, 415);
});

test('rejects malformed JSON', async () => {
  assert.equal((await post('/login', '{not json')).status, 400);
});

test('login with a wrong password fails with a generic message', async () => {
  const response = await post('/login', { username: 'alice', password: 'wrong password' });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('set-cookie'), null);
  const unknown = await post('/login', { username: 'nobody', password: 'wrong password' });
  assert.equal(unknown.status, 401);
  assert.deepEqual(await unknown.json(), await response.json());
});

test('login issues an RS256 JWT with exp in a secure cookie', async () => {
  const response = await post('/login', { username: 'Alice', password: 'correct horse' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { username: 'alice' });

  const { cookie, token } = tokenFrom(response);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  assert.doesNotMatch(cookie, /Secure/);

  const payload = jwt.verify(token, publicKey, { algorithms: ['RS256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
  assert.equal(payload.username, 'alice');
  assert.equal(typeof payload.exp, 'number');
  assert.equal(payload.exp - payload.iat, 3600);
  assert.equal(jwt.decode(token, { complete: true }).header.alg, 'RS256');
});

test('cookie gets the Secure flag behind HTTPS', async () => {
  const response = await post('/login', { username: 'alice', password: 'correct horse' }, { 'x-forwarded-proto': 'https' });
  assert.match(tokenFrom(response).cookie, /Secure/);
});

test('logout clears the token cookie', async () => {
  const response = await post('/logout', {});
  assert.equal(response.status, 200);
  const { cookie, token } = tokenFrom(response);
  assert.equal(token, '');
  assert.match(cookie, /Expires=Thu, 01 Jan 1970/);
});

test('GET on auth paths redirects to the home page', async () => {
  const response = await fetch(`${baseUrl}/login`, { redirect: 'manual' });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/?auth=login');
});

test('key pair is generated once and reused across restarts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'keys-'));
  try {
    const paths = { privateKeyPath: join(dir, 'private', 'k.pem'), publicKeyPath: join(dir, 'public', 'k.pem') };
    const first = loadOrCreateKeyPair(paths);
    const second = loadOrCreateKeyPair(paths);
    assert.equal(first.privateKey, second.privateKey);
    assert.equal(readFileSync(paths.publicKeyPath, 'utf8'), first.publicKey);
    assert.equal(statSync(paths.privateKeyPath).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
