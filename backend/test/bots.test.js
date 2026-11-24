import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { io as createClient } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { JWT_AUDIENCE, JWT_ISSUER, createTokenVerifier } from '../src/auth/jwt.js';
import { BotController } from '../src/ai/botController.js';
import { createRandom } from '../src/ai/mcts.js';
import { MAX_HEALTH } from '../src/game/constants.js';
import { GameEngine } from '../src/game/engine.js';
import { attachGameServer } from '../src/realtime/gameServer.js';

const input = (overrides = {}) => ({ forward: false, backward: false, left: false, right: false, fire: false, ...overrides });
const TICK_MS = 33;

// Drives the controller and engine exactly like the gateway's setInterval loop.
function runLoop(engine, bots, startMs, durationMs, beforeTick = () => {}) {
  let now = startMs;
  for (; now < startMs + durationMs; now += TICK_MS) {
    beforeTick(now);
    bots.update(now);
    engine.step(TICK_MS / 1000, now);
  }
  return now;
}

test('bots join the engine as tanks, appear on the scoreboard, and never use human capacity', () => {
  const engine = new GameEngine({ maxPlayers: 1 });
  const bots = new BotController({ engine, count: 3, random: createRandom(1) });
  bots.start(0);

  assert.equal(engine.playerCount, 3);
  assert.equal(engine.humanCount, 0);
  assert.ok(engine.addPlayer({ userId: '7', username: 'alice' }, 'socket-a', 0), 'a human still fits when maxPlayers is 1');
  assert.equal(engine.addPlayer({ userId: '8', username: 'bob' }, 'socket-b', 0), null, 'human capacity is still enforced');

  const players = engine.snapshot(0).players;
  const botPlayers = players.filter((player) => player.bot);
  assert.equal(botPlayers.length, 3);
  assert.ok(botPlayers.every((player) => / /.test(player.username) && player.health === MAX_HEALTH && player.score === 0));
  assert.equal(players.find((player) => player.id === '7').bot, false);
});

test('client-facing engine APIs can never control, replace, or remove a bot', () => {
  const engine = new GameEngine();
  const bots = new BotController({ engine, count: 1, random: createRandom(1) });
  bots.start(0);
  const bot = engine.players.get('bot-1');

  for (const socketId of [null, undefined, '', 'socket-x']) {
    assert.equal(engine.setInput('bot-1', socketId, input({ forward: true }), 10), false);
    assert.equal(engine.removePlayer('bot-1', socketId), false);
  }
  assert.equal(engine.addPlayer({ userId: 'bot-1', username: 'mallory' }, 'socket-x', 10), null);
  assert.equal(engine.addPlayer({ userId: '9', username: 'mallory' }, null, 10), null, 'tanks without a socket are bot-only');
  assert.equal(bot.username, 'Bot Viper');
  assert.equal(bot.socketId, null);
  assert.deepEqual(bot.input, input());

  assert.equal(engine.setBotInput('bot-1', input({ fire: true }), 20), true);
  engine.addPlayer({ userId: '3', username: 'carol' }, 'socket-c', 20);
  assert.equal(engine.setBotInput('3', input({ fire: true }), 20), false, 'bot control cannot drive a human tank');
});

test('bots stay idle while no human is in the arena', () => {
  const engine = new GameEngine();
  const bots = new BotController({ engine, count: 2, random: createRandom(3) });
  bots.start(0);
  const before = engine.snapshot(0).players.map(({ x, y, rotation }) => ({ x, y, rotation }));
  runLoop(engine, bots, 0, 3000);
  assert.deepEqual(engine.snapshot(3000).players.map(({ x, y, rotation }) => ({ x, y, rotation })), before);
  assert.equal(engine.projectiles.length, 0);
});

test('in the game loop a bot hunts a human: it moves, fires, damages, and scores eliminations', () => {
  const engine = new GameEngine();
  engine.addPlayer({ userId: '1', username: 'alice' }, 'socket-a', 0);
  const bots = new BotController({ engine, count: 1, random: createRandom(11) });
  bots.start(0);
  const bot = engine.players.get('bot-1');
  const start = { x: bot.x, y: bot.y, rotation: bot.rotation };

  let humanDamaged = false;
  let botFired = false;
  runLoop(engine, bots, 0, 20_000, (now) => {
    // The human only holds still; the client heartbeat keeps the input fresh.
    engine.setInput('1', 'socket-a', input(), now);
    if (engine.players.get('1').health < MAX_HEALTH) humanDamaged = true;
    if (engine.projectiles.some((projectile) => projectile.ownerId === 'bot-1')) botFired = true;
  });

  assert.ok(Math.hypot(bot.x - start.x, bot.y - start.y) > 1 || bot.rotation !== start.rotation, 'bot moved');
  assert.ok(botFired, 'bot fired projectiles');
  assert.ok(humanDamaged, 'bot projectiles damaged the human');
  assert.ok(bot.score >= 1, `bot eliminated the human (score ${bot.score})`);
  assert.equal(engine.players.get('1').score, 0);
});

test('in the game loop a human can hit and eliminate a bot, and the bot respawns', () => {
  const engine = new GameEngine({ spawnPoints: [{ x: 600, y: 350, rotation: 0 }, { x: 300, y: 350, rotation: 0 }] });
  const bots = new BotController({ engine, count: 1, random: createRandom(5) });
  bots.start(0);
  engine.addPlayer({ userId: '1', username: 'alice' }, 'socket-a', 0);
  const human = engine.players.get('1');
  const bot = engine.players.get('bot-1');

  let botDamaged = false;
  let botDestroyed = false;
  let botRespawned = false;
  runLoop(engine, bots, 0, 30_000, (now) => {
    // A simple aim-bot human: rotate toward the bot and fire when lined up.
    const desired = Math.atan2(bot.y - human.y, bot.x - human.x);
    const offset = Math.atan2(Math.sin(desired - human.rotation), Math.cos(desired - human.rotation));
    engine.setInput('1', 'socket-a', input({ left: offset < -0.04, right: offset > 0.04, fire: Math.abs(offset) < 0.1 }), now);
    if (bot.health < MAX_HEALTH) botDamaged = true;
    if (bot.respawnAt !== null) botDestroyed = true;
    if (botDestroyed && bot.respawnAt === null && bot.health === MAX_HEALTH) botRespawned = true;
  });

  assert.ok(botDamaged, 'human projectiles hit the bot');
  assert.ok(botDestroyed, 'bot was destroyed');
  assert.ok(botRespawned, 'bot respawned with full armor');
  assert.ok(human.score >= 1, `human scored an elimination on the bot (score ${human.score})`);
});

// ---- WebSocket integration: bots run inside the real gateway tick loop ----

const ORIGIN = 'http://localhost:8080';
const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const verifier = createTokenVerifier({ publicKey: keys.publicKey });
let httpServer;
let gateway;
let baseUrl;

function signToken(username, subject) {
  return jwt.sign({ username }, keys.privateKey, {
    algorithm: 'RS256', expiresIn: 60, issuer: JWT_ISSUER, audience: JWT_AUDIENCE, subject,
  });
}

function connect(token) {
  const headers = { Origin: ORIGIN };
  if (token) headers.Cookie = `auth_token=${token}`;
  return createClient(baseUrl, {
    path: '/socket.io', transports: ['websocket'], extraHeaders: headers, reconnection: false, forceNew: true,
  });
}

function once(emitter, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
    emitter.once(event, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

function waitForState(socket, predicate, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('game:state', handler);
      reject(new Error('Timed out waiting for matching game state'));
    }, timeoutMs);
    function handler(state) {
      if (!predicate(state)) return;
      clearTimeout(timer);
      socket.off('game:state', handler);
      resolve(state);
    }
    socket.on('game:state', handler);
  });
}

before(async () => {
  httpServer = createServer(createApp({ tokenVerifier: verifier }));
  const engine = new GameEngine();
  gateway = attachGameServer(httpServer, {
    tokenVerifier: verifier,
    allowedOrigins: new Set([ORIGIN]),
    engine,
    bots: new BotController({ engine, count: 2, random: createRandom(9) }),
  });
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
});

after(async () => {
  gateway.stop();
  await new Promise((resolve) => gateway.io.close(resolve));
  if (httpServer.listening) await new Promise((resolve) => httpServer.close(resolve));
});

test('over the real WebSocket gateway, bots are broadcast to players and move and shoot live', async () => {
  const socket = connect(signToken('alice', '101'));
  try {
    await once(socket, 'connect');
    const first = await waitForState(socket, (state) => state.players.filter((player) => player.bot).length === 2);
    const startPositions = new Map(first.players.filter((player) => player.bot).map((player) => [player.id, player]));

    await waitForState(socket, (state) => state.players.some((player) => {
      const start = startPositions.get(player.id);
      return start && (Math.hypot(player.x - start.x, player.y - start.y) > 20 || player.rotation !== start.rotation);
    }));
    await waitForState(socket, (state) => state.projectiles.some((projectile) => projectile.ownerId.startsWith('bot-')));

    // The human's own controls still work alongside bots.
    socket.emit('player:input', input({ forward: true }));
    const alice = first.players.find((player) => player.id === '101');
    await waitForState(socket, (state) => {
      const me = state.players.find((player) => player.id === '101');
      return me && Math.hypot(me.x - alice.x, me.y - alice.y) > 10;
    });
  } finally {
    socket.close();
  }
});

test('bots add no unauthenticated path: anonymous handshakes fail and a token cannot claim a bot', async () => {
  const anonymous = connect(null);
  const error = await once(anonymous, 'connect_error');
  anonymous.close();
  assert.ok(error instanceof Error, 'the handshake is refused before any game event');
  assert.equal(gateway.engine.humanCount, 0);

  // Even a validly signed token whose subject equals a bot ID cannot take over that bot.
  const impostor = connect(signToken('mallory', 'bot-1'));
  const failure = await once(impostor, 'game:error');
  impostor.close();
  assert.equal(failure.code, 'ARENA_FULL');
  const bot = gateway.engine.players.get('bot-1');
  assert.equal(bot.isBot, true);
  assert.equal(bot.username, 'Bot Viper');
  assert.equal(bot.socketId, null);
});
