import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { after, afterEach, before, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { io as createClient } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { JWT_AUDIENCE, JWT_ISSUER, createTokenVerifier } from '../src/auth/jwt.js';
import { GameEngine } from '../src/game/engine.js';
import { attachGameServer } from '../src/realtime/gameServer.js';

const ORIGIN = 'http://localhost:8080';
const pem = {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
};
const authKeys = generateKeyPairSync('rsa', { modulusLength: 2048, ...pem });
const attackerKeys = generateKeyPairSync('rsa', { modulusLength: 2048, ...pem });
const verifier = createTokenVerifier({ publicKey: authKeys.publicKey });

const normalInput = (overrides = {}) => ({
  forward: false,
  backward: false,
  left: false,
  right: false,
  fire: false,
  ...overrides,
});

function signToken(username, subject, options = {}) {
  return jwt.sign({ username, ...options.claims }, options.privateKey ?? authKeys.privateKey, {
    algorithm: 'RS256',
    expiresIn: 60,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    subject,
    ...options.signOptions,
  });
}

function waitForEvent(emitter, event, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const handler = (...args) => {
      clearTimeout(timer);
      resolve(args.length > 1 ? args : args[0]);
    };
    emitter.once(event, handler);
  });
}

function waitForState(socket, predicate, timeoutMs = 2000) {
  if (socket.latestState && predicate(socket.latestState)) return Promise.resolve(socket.latestState);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('game:state', handler);
      reject(new Error('Timed out waiting for matching game state'));
    }, timeoutMs);
    const handler = (state) => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      socket.off('game:state', handler);
      resolve(state);
    };
    socket.on('game:state', handler);
  });
}

function makeClient(token, origin = ORIGIN) {
  const headers = { Origin: origin };
  if (token) headers.Cookie = `auth_token=${token}`;
  const socket = createClient(baseUrl, {
    path: '/socket.io',
    transports: ['websocket'],
    extraHeaders: headers,
    reconnection: false,
    forceNew: true,
  });
  socket.on('game:state', (state) => { socket.latestState = state; });
  return socket;
}

async function connectAuthenticated(token) {
  const socket = makeClient(token);
  const welcomePromise = waitForEvent(socket, 'game:welcome');
  await waitForEvent(socket, 'connect');
  socket.welcome = await welcomePromise;
  sockets.add(socket);
  return socket;
}

async function expectRejected(token, origin = ORIGIN) {
  const socket = makeClient(token, origin);
  const error = await waitForEvent(socket, 'connect_error');
  socket.close();
  assert.ok(error instanceof Error);
}

let httpServer;
let gateway;
let baseUrl;
const sockets = new Set();

before(async () => {
  const app = createApp({ tokenVerifier: verifier });
  httpServer = createServer(app);
  const engine = new GameEngine({
    spawnPoints: [
      { x: 100, y: 100, rotation: 0 },
      { x: 200, y: 100, rotation: Math.PI },
    ],
  });
  gateway = attachGameServer(httpServer, {
    tokenVerifier: verifier,
    allowedOrigins: new Set([ORIGIN]),
    engine,
    autoStart: false,
  });
  httpServer.listen(0, '127.0.0.1');
  await waitForEvent(httpServer, 'listening');
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
});

afterEach(async () => {
  for (const socket of sockets) socket.close();
  sockets.clear();
  await new Promise((resolve) => setTimeout(resolve, 20));
});

after(async () => {
  for (const socket of sockets) socket.close();
  gateway.stop();
  await new Promise((resolve) => gateway.io.close(resolve));
  if (httpServer.listening) {
    await new Promise((resolve, reject) => httpServer.close((error) => (error ? reject(error) : resolve())));
  }
});

test('rejects missing, forged, expired, and wrong-origin WebSocket handshakes', async () => {
  await expectRejected(null);
  await expectRejected(signToken('mallory', '9', { privateKey: attackerKeys.privateKey }));
  await expectRejected(jwt.sign(
    { username: 'alice', exp: Math.floor(Date.now() / 1000) - 5 },
    authKeys.privateKey,
    { algorithm: 'RS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE, subject: '1' },
  ));
  await expectRejected(signToken('alice', '1'), 'https://attacker.example');
});

test('two real clients synchronize movement, combat, respawn, disconnect, and reconnect', async () => {
  const aliceToken = signToken('alice', '1');
  const bobToken = signToken('bob', '2');
  const alice = await connectAuthenticated(aliceToken);
  const aliceSeesBob = waitForState(alice, (state) => state.players.length === 2);
  const bob = await connectAuthenticated(bobToken);
  await aliceSeesBob;
  let bobState = await waitForState(bob, (state) => state.players.length === 2);

  assert.equal(alice.welcome.username, 'alice');
  assert.equal(bob.welcome.username, 'bob');
  assert.deepEqual(new Set(bobState.players.map((player) => player.username)), new Set(['alice', 'bob']));

  const before = new Map(bobState.players.map((player) => [player.id, player.x]));
  alice.emit('player:input', normalInput({ forward: true }));
  bob.emit('player:input', normalInput({ forward: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  gateway.engine.step(0.05, Date.now());
  gateway.broadcast();
  bobState = await waitForState(
    bob,
    (state) => state.players.some((player) => player.id === '1' && player.x > before.get('1')),
  );
  assert.ok(bobState.players.find((player) => player.id === '2').x < before.get('2'));

  // Extra client fields are rejected, and the signed JWT remains the only identity source.
  alice.emit('player:input', { ...normalInput(), username: 'admin' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  gateway.broadcast();
  bobState = await waitForState(bob, (state) => state.players.some((player) => player.username === 'alice'));
  assert.equal(bobState.players.some((player) => player.username === 'admin'), false);

  bob.emit('player:input', normalInput());
  alice.emit('player:input', normalInput({ fire: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const startedAt = Date.now();
  for (let shot = 0; shot < 3; shot += 1) {
    const firedAt = startedAt + shot * 400;
    gateway.engine.step(0, firedAt);
    gateway.engine.step(0.05, firedAt + 50);
  }
  gateway.broadcast();
  bobState = await waitForState(
    bob,
    (state) => state.players.some((player) => player.id === '2' && !player.alive),
  );
  assert.equal(bobState.players.find((player) => player.id === '1').score, 1);
  assert.equal(bobState.players.find((player) => player.id === '2').health, 0);
  assert.deepEqual(bobState.leaders, ['1']);

  alice.emit('player:input', normalInput());
  await new Promise((resolve) => setTimeout(resolve, 10));
  gateway.engine.step(0, startedAt + 800 + 50 + 2001);
  gateway.broadcast();
  bobState = await waitForState(
    bob,
    (state) => state.players.some((player) => player.id === '2' && player.alive && player.health === 100),
  );
  assert.equal(bobState.players.find((player) => player.id === '1').score, 1);

  const bobRemoved = waitForState(alice, (state) => state.players.every((player) => player.id !== '2'));
  bob.close();
  sockets.delete(bob);
  await bobRemoved;

  const bobReconnected = await connectAuthenticated(bobToken);
  const rejoined = await waitForState(alice, (state) => state.players.some((player) => player.id === '2'));
  assert.equal(rejoined.players.find((player) => player.id === '2').username, 'bob');
  bobReconnected.close();
  sockets.delete(bobReconnected);
  alice.close();
  sockets.delete(alice);
});

test('a newer connection replaces a duplicate session without stale-state corruption', async () => {
  const token = signToken('alice', '1');
  const first = await connectAuthenticated(token);
  const replaced = waitForEvent(first, 'session:replaced');
  const second = await connectAuthenticated(token);
  await replaced;
  assert.equal(second.connected, true);
  assert.equal(gateway.engine.playerCount, 1);
  first.close();
  second.close();
  sockets.delete(first);
  sockets.delete(second);
});
