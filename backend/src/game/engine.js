import {
  ARENA,
  DEFAULT_SPAWN_POINTS,
  FIRE_COOLDOWN_MS,
  INPUT_TIMEOUT_MS,
  MAX_HEALTH,
  MAX_PLAYERS,
  MAX_PROJECTILES,
  PROJECTILE_DAMAGE,
  PROJECTILE_LIFETIME_MS,
  PROJECTILE_RADIUS,
  PROJECTILE_SPEED,
  RESPAWN_DELAY_MS,
  ROTATION_SPEED,
  TANK_RADIUS,
  TANK_REVERSE_SPEED,
  TANK_SPEED,
} from './constants.js';

const EMPTY_INPUT = Object.freeze({ forward: false, backward: false, left: false, right: false, fire: false });

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function publicPlayer(player, now) {
  return {
    id: player.id,
    username: player.username,
    x: player.x,
    y: player.y,
    rotation: player.rotation,
    health: player.health,
    maxHealth: MAX_HEALTH,
    score: player.score,
    alive: player.respawnAt === null,
    respawnIn: player.respawnAt === null ? 0 : Math.max(0, player.respawnAt - now),
    bot: player.isBot,
  };
}

export class GameEngine {
  constructor({ arena = ARENA, spawnPoints = DEFAULT_SPAWN_POINTS, maxPlayers = MAX_PLAYERS } = {}) {
    this.arena = arena;
    this.spawnPoints = spawnPoints;
    this.maxPlayers = maxPlayers;
    this.players = new Map();
    this.projectiles = [];
    this.nextProjectileId = 1;
    this.nextSpawnIndex = 0;
  }

  get playerCount() {
    return this.players.size;
  }

  // Human players only. Server-side bots never take a connection slot.
  get humanCount() {
    let count = 0;
    for (const player of this.players.values()) if (!player.isBot) count += 1;
    return count;
  }

  hasPlayer(userId) {
    return this.players.has(userId);
  }

  chooseSpawn() {
    const candidates = this.spawnPoints.length ? this.spawnPoints : DEFAULT_SPAWN_POINTS;
    let best = candidates[this.nextSpawnIndex % candidates.length];
    let bestDistance = -1;

    for (let offset = 0; offset < candidates.length; offset += 1) {
      const candidate = candidates[(this.nextSpawnIndex + offset) % candidates.length];
      let nearest = Number.POSITIVE_INFINITY;
      for (const player of this.players.values()) {
        if (player.respawnAt !== null) continue;
        nearest = Math.min(nearest, Math.hypot(candidate.x - player.x, candidate.y - player.y));
      }
      if (nearest > bestDistance) {
        best = candidate;
        bestDistance = nearest;
      }
    }

    this.nextSpawnIndex = (this.nextSpawnIndex + 1) % candidates.length;
    return best;
  }

  createTank({ id, username, socketId, isBot }, now) {
    const spawn = this.chooseSpawn();
    const player = {
      id,
      username,
      socketId,
      isBot,
      x: spawn.x,
      y: spawn.y,
      rotation: spawn.rotation ?? 0,
      health: MAX_HEALTH,
      score: 0,
      respawnAt: null,
      input: { ...EMPTY_INPUT },
      lastInputAt: now,
      lastShotAt: now - FIRE_COOLDOWN_MS,
    };
    this.players.set(player.id, player);
    return player;
  }

  addPlayer(identity, socketId, now = Date.now()) {
    if (typeof socketId !== 'string' || !socketId) return null;
    const existing = this.players.get(identity.userId);
    if (existing) {
      // A WebSocket session can never take over a server-controlled bot.
      if (existing.isBot) return null;
      existing.socketId = socketId;
      existing.username = identity.username;
      existing.input = { ...EMPTY_INPUT };
      existing.lastInputAt = now;
      return existing;
    }
    if (this.humanCount >= this.maxPlayers) return null;
    return this.createTank({ id: identity.userId, username: identity.username, socketId, isBot: false }, now);
  }

  // Bots are created only by server code; they have no socket and no network entry point.
  addBot(botId, username, now = Date.now()) {
    if (this.players.has(botId)) return null;
    return this.createTank({ id: botId, username, socketId: null, isBot: true }, now);
  }

  removeBot(botId) {
    const player = this.players.get(botId);
    if (!player?.isBot) return false;
    this.players.delete(botId);
    this.projectiles = this.projectiles.filter((projectile) => projectile.ownerId !== botId);
    return true;
  }

  removePlayer(userId, socketId) {
    const player = this.players.get(userId);
    if (!player || player.isBot || player.socketId !== socketId) return false;
    this.players.delete(userId);
    this.projectiles = this.projectiles.filter((projectile) => projectile.ownerId !== userId);
    return true;
  }

  setInput(userId, socketId, input, now = Date.now()) {
    const player = this.players.get(userId);
    if (!player || player.isBot || player.socketId !== socketId) return false;
    player.input = { ...input };
    player.lastInputAt = now;
    return true;
  }

  setBotInput(botId, input, now = Date.now()) {
    const player = this.players.get(botId);
    if (!player?.isBot) return false;
    player.input = { ...input };
    player.lastInputAt = now;
    return true;
  }

  fire(player, now) {
    if (this.projectiles.length >= MAX_PROJECTILES || now - player.lastShotAt < FIRE_COOLDOWN_MS) return;
    player.lastShotAt = now;
    const muzzleDistance = TANK_RADIUS + 12;
    const cos = Math.cos(player.rotation);
    const sin = Math.sin(player.rotation);
    this.projectiles.push({
      id: String(this.nextProjectileId++),
      ownerId: player.id,
      x: player.x + cos * muzzleDistance,
      y: player.y + sin * muzzleDistance,
      vx: cos * PROJECTILE_SPEED,
      vy: sin * PROJECTILE_SPEED,
      expiresAt: now + PROJECTILE_LIFETIME_MS,
    });
  }

  respawn(player, now) {
    const spawn = this.chooseSpawn();
    player.x = spawn.x;
    player.y = spawn.y;
    player.rotation = spawn.rotation ?? 0;
    player.health = MAX_HEALTH;
    player.respawnAt = null;
    player.lastShotAt = now;
    player.input = { ...EMPTY_INPUT };
  }

  step(deltaSeconds, now = Date.now()) {
    const delta = clamp(deltaSeconds, 0, 0.05);

    for (const player of this.players.values()) {
      if (player.respawnAt !== null) {
        if (now >= player.respawnAt) this.respawn(player, now);
        continue;
      }

      if (now - player.lastInputAt > INPUT_TIMEOUT_MS) player.input = { ...EMPTY_INPUT };
      const turn = Number(player.input.right) - Number(player.input.left);
      player.rotation = (player.rotation + turn * ROTATION_SPEED * delta + Math.PI * 2) % (Math.PI * 2);

      const throttle = Number(player.input.forward) - Number(player.input.backward);
      const speed = throttle >= 0 ? TANK_SPEED : TANK_REVERSE_SPEED;
      player.x = clamp(player.x + Math.cos(player.rotation) * throttle * speed * delta, TANK_RADIUS, this.arena.width - TANK_RADIUS);
      player.y = clamp(player.y + Math.sin(player.rotation) * throttle * speed * delta, TANK_RADIUS, this.arena.height - TANK_RADIUS);

      if (player.input.fire) this.fire(player, now);
    }

    const survivors = [];
    for (const projectile of this.projectiles) {
      projectile.x += projectile.vx * delta;
      projectile.y += projectile.vy * delta;

      if (
        now >= projectile.expiresAt
        || projectile.x < -PROJECTILE_RADIUS
        || projectile.x > this.arena.width + PROJECTILE_RADIUS
        || projectile.y < -PROJECTILE_RADIUS
        || projectile.y > this.arena.height + PROJECTILE_RADIUS
      ) continue;

      let hit = false;
      for (const target of this.players.values()) {
        if (target.id === projectile.ownerId || target.respawnAt !== null) continue;
        const collisionDistance = TANK_RADIUS + PROJECTILE_RADIUS;
        const dx = target.x - projectile.x;
        const dy = target.y - projectile.y;
        if (dx * dx + dy * dy > collisionDistance * collisionDistance) continue;

        target.health = Math.max(0, target.health - PROJECTILE_DAMAGE);
        if (target.health === 0) {
          target.respawnAt = now + RESPAWN_DELAY_MS;
          target.input = { ...EMPTY_INPUT };
          const attacker = this.players.get(projectile.ownerId);
          if (attacker) attacker.score += 1;
        }
        hit = true;
        break;
      }
      if (!hit) survivors.push(projectile);
    }
    this.projectiles = survivors;
  }

  snapshot(now = Date.now()) {
    const players = [...this.players.values()].map((player) => publicPlayer(player, now));
    const highestScore = players.length ? Math.max(...players.map((player) => player.score)) : 0;
    const leaders = players.filter((player) => player.score === highestScore).map((player) => player.id);
    return {
      serverTime: now,
      arena: this.arena,
      players,
      projectiles: this.projectiles.map(({ id, ownerId, x, y }) => ({ id, ownerId, x, y })),
      leaders,
    };
  }
}

export function parsePlayerInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = ['forward', 'backward', 'left', 'right', 'fire'];
  if (Object.keys(value).some((key) => !keys.includes(key))) return null;
  if (keys.some((key) => typeof value[key] !== 'boolean')) return null;
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}
