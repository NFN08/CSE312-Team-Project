// Server-side AI tanks. Bots are ordinary tanks inside the authoritative
// GameEngine: they move, shoot, take damage, respawn, and score through the
// same step() loop as human players. They have no socket, so they add no
// network entry point and cannot be driven by any client.
import { FIRE_COOLDOWN_MS } from '../game/constants.js';
import { DEFAULT_ITERATIONS, createRandom, searchBestAction } from './mcts.js';

export const DEFAULT_BOT_COUNT = 3;
export const MAX_BOT_COUNT = 8;
export const DEFAULT_DECISION_MS = 200;
const IDLE_INPUT = Object.freeze({ forward: false, backward: false, left: false, right: false, fire: false });
// Bots prefer human targets; another bot must be this much closer to be chosen instead.
const BOT_TARGET_PENALTY = 1.6;
const CROWDING_PENALTY = 0.6;
const THREAT_RADIUS = 650;

// Bot names contain a space, which the auth server never allows in a username,
// so a bot can never be mistaken for or impersonate a real account.
const BOT_NAMES = Object.freeze(['Bot Viper', 'Bot Rook', 'Bot Atlas', 'Bot Nova', 'Bot Kestrel', 'Bot Onyx', 'Bot Talon', 'Bot Ember']);

function parseInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function parseBotConfig(env = process.env) {
  return {
    count: parseInteger(env.BOT_COUNT, DEFAULT_BOT_COUNT, 0, MAX_BOT_COUNT),
    iterations: parseInteger(env.BOT_SEARCH_ITERATIONS, DEFAULT_ITERATIONS, 20, 2000),
  };
}

function toTank(player, now) {
  return {
    x: player.x,
    y: player.y,
    rotation: player.rotation,
    health: player.health,
    cooldown: Math.max(0, FIRE_COOLDOWN_MS - (now - player.lastShotAt)) / 1000,
    throttle: Number(player.input.forward) - Number(player.input.backward),
  };
}

export class BotController {
  constructor({
    engine,
    count = DEFAULT_BOT_COUNT,
    iterations = DEFAULT_ITERATIONS,
    decisionMs = DEFAULT_DECISION_MS,
    random = createRandom(),
  }) {
    this.engine = engine;
    this.count = Math.min(MAX_BOT_COUNT, Math.max(0, count));
    this.iterations = iterations;
    this.decisionMs = decisionMs;
    this.random = random;
    this.bots = new Map();
    this.lastDecision = new Map();
  }

  start(now = Date.now()) {
    for (let index = 0; index < this.count; index += 1) {
      const id = `bot-${index + 1}`;
      if (this.bots.has(id)) continue;
      if (!this.engine.addBot(id, BOT_NAMES[index % BOT_NAMES.length], now)) continue;
      // Stagger decisions so bots never all search on the same tick.
      this.bots.set(id, { nextDecisionAt: now + Math.round((index * this.decisionMs) / Math.max(1, this.count)) });
    }
  }

  stop() {
    for (const id of this.bots.keys()) this.engine.removeBot(id);
    this.bots.clear();
  }

  chooseTarget(bot) {
    // Count how many other bots already chase each player so bots spread out
    // instead of all piling onto a single human.
    const chasers = new Map();
    for (const [botId, decision] of this.lastDecision) {
      if (botId === bot.id || !decision.targetId) continue;
      chasers.set(decision.targetId, (chasers.get(decision.targetId) ?? 0) + 1);
    }

    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const player of this.engine.players.values()) {
      if (player.id === bot.id || player.respawnAt !== null) continue;
      const distance = Math.hypot(player.x - bot.x, player.y - bot.y);
      const crowding = 1 + CROWDING_PENALTY * (chasers.get(player.id) ?? 0);
      const score = (player.isBot ? distance * BOT_TARGET_PENALTY : distance) * crowding;
      if (score < bestScore) {
        best = player;
        bestScore = score;
      }
    }
    return best;
  }

  buildWorld(bot, target, now) {
    const shots = [];
    for (const projectile of this.engine.projectiles) {
      if (Math.hypot(projectile.x - bot.x, projectile.y - bot.y) > THREAT_RADIUS) continue;
      const owner = projectile.ownerId === bot.id ? 'me' : 'foe';
      shots.push({
        owner,
        x: projectile.x,
        y: projectile.y,
        vx: projectile.vx,
        vy: projectile.vy,
        ttl: Math.max(0, projectile.expiresAt - now) / 1000,
      });
    }
    return {
      me: toTank(bot, now),
      foe: target ? toTank(target, now) : null,
      shots,
      arena: this.engine.arena,
    };
  }

  decide(botId, now = Date.now()) {
    const bot = this.engine.players.get(botId);
    if (!bot?.isBot || bot.respawnAt !== null) return null;
    const target = this.chooseTarget(bot);
    const result = searchBestAction(this.buildWorld(bot, target, now), {
      iterations: this.iterations,
      random: this.random,
    });
    this.engine.setBotInput(botId, result.input, now);
    this.lastDecision.set(botId, { ...result, targetId: target?.id ?? null, at: now });
    return result;
  }

  // Called by the game loop before each engine.step().
  update(now = Date.now()) {
    const humansPresent = this.engine.humanCount > 0;
    for (const [botId, schedule] of this.bots) {
      if (!humansPresent) {
        // Nobody to play against: idle instead of burning CPU on bot-vs-bot matches.
        this.engine.setBotInput(botId, IDLE_INPUT, now);
        continue;
      }
      if (now < schedule.nextDecisionAt) continue;
      schedule.nextDecisionAt = now + this.decisionMs;
      this.decide(botId, now);
    }
  }
}
