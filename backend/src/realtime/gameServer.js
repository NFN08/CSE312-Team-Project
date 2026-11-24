import { Server } from 'socket.io';
import { GameEngine, parsePlayerInput } from '../game/engine.js';
import { userFromCookieHeader } from '../auth/jwt.js';

const TICK_RATE = 30;
const BROADCAST_RATE = 20;
const INPUT_BURST = 40;
const INPUTS_PER_SECOND = 25;

function createRateLimiter(now = Date.now()) {
  return { tokens: INPUT_BURST, updatedAt: now, violations: 0 };
}

function consumeToken(limiter, now = Date.now()) {
  const elapsed = Math.max(0, now - limiter.updatedAt) / 1000;
  limiter.tokens = Math.min(INPUT_BURST, limiter.tokens + elapsed * INPUTS_PER_SECOND);
  limiter.updatedAt = now;
  if (limiter.tokens < 1) {
    limiter.violations += 1;
    return false;
  }
  limiter.tokens -= 1;
  limiter.violations = Math.max(0, limiter.violations - 0.1);
  return true;
}

export function parseAllowedOrigins(value) {
  return new Set(
    String(value ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

export function attachGameServer(httpServer, {
  tokenVerifier,
  allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
  engine = new GameEngine(),
  bots = null,
  autoStart = true,
} = {}) {
  if (!tokenVerifier) throw new Error('tokenVerifier is required for WebSocket authentication');
  if (allowedOrigins.size === 0) throw new Error('At least one ALLOWED_ORIGINS value is required');

  const activeSockets = new Map();
  const io = new Server(httpServer, {
    path: '/socket.io',
    transports: ['websocket'],
    serveClient: false,
    perMessageDeflate: false,
    maxHttpBufferSize: 2048,
    pingInterval: 15_000,
    pingTimeout: 10_000,
    allowRequest(request, callback) {
      const origin = request.headers.origin;
      if (typeof origin !== 'string' || !allowedOrigins.has(origin)) {
        callback('Origin not allowed', false);
        return;
      }

      const user = userFromCookieHeader(tokenVerifier, request.headers.cookie);
      if (!user) {
        callback('Authentication required', false);
        return;
      }
      if (engine.humanCount >= engine.maxPlayers && !engine.hasPlayer(user.userId)) {
        callback('Arena is full', false);
        return;
      }
      request.gameUser = user;
      callback(null, true);
    },
  });

  function broadcast() {
    io.emit('game:state', engine.snapshot());
  }

  io.use((socket, next) => {
    const identity = socket.request.gameUser
      ?? userFromCookieHeader(tokenVerifier, socket.handshake.headers.cookie);
    if (!identity) return next(new Error('Authentication required'));
    socket.data.identity = identity;
    return next();
  });

  io.on('connection', (socket) => {
    const identity = socket.data.identity;
    const previous = activeSockets.get(identity.userId);
    if (previous && previous.id !== socket.id) {
      previous.emit('session:replaced');
      previous.disconnect(true);
    }

    activeSockets.set(identity.userId, socket);
    const player = engine.addPlayer(identity, socket.id);
    if (!player) {
      socket.emit('game:error', { code: 'ARENA_FULL', message: 'The arena is currently full.' });
      socket.disconnect(true);
      return;
    }

    const limiter = createRateLimiter();
    socket.emit('game:welcome', {
      playerId: identity.userId,
      username: identity.username,
      controls: { move: 'WASD', fire: 'Space' },
    });
    socket.emit('game:state', engine.snapshot());
    socket.broadcast.emit('game:state', engine.snapshot());

    socket.on('player:input', (payload) => {
      if (!consumeToken(limiter)) {
        if (limiter.violations >= 8) socket.disconnect(true);
        return;
      }
      const input = parsePlayerInput(payload);
      if (!input) return;
      engine.setInput(identity.userId, socket.id, input);
    });

    socket.on('disconnect', () => {
      if (activeSockets.get(identity.userId)?.id === socket.id) activeSockets.delete(identity.userId);
      if (engine.removePlayer(identity.userId, socket.id)) broadcast();
    });
  });

  let tickTimer = null;
  let previousTick = Date.now();
  let previousBroadcast = previousTick;

  function start() {
    if (tickTimer) return;
    previousTick = Date.now();
    previousBroadcast = previousTick;
    bots?.start(previousTick);
    tickTimer = setInterval(() => {
      const now = Date.now();
      // AI bots pick their controls inside the same authoritative tick as human input.
      bots?.update(now);
      engine.step((now - previousTick) / 1000, now);
      previousTick = now;
      if (now - previousBroadcast >= 1000 / BROADCAST_RATE) {
        broadcast();
        previousBroadcast = now;
      }
    }, 1000 / TICK_RATE);
    tickTimer.unref?.();
  }

  function stop() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
  }

  if (autoStart) start();
  return { io, engine, bots, broadcast, start, stop };
}
