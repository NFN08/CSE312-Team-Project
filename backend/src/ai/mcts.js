// Monte Carlo tree search (UCT) for a single bot tank.
//
// The search plans over a simplified duel: the bot, one target tank, and every
// nearby projectile. A small forward model reuses the real game constants to
// predict movement, firing cooldowns, projectile flight, and hits. Each tree
// edge is one "macro action" (a set of held controls for ACTION_SECONDS), so a
// path from the root is a short plan the bot could execute.
import {
  ARENA,
  FIRE_COOLDOWN_MS,
  PROJECTILE_DAMAGE,
  PROJECTILE_LIFETIME_MS,
  PROJECTILE_RADIUS,
  PROJECTILE_SPEED,
  ROTATION_SPEED,
  TANK_RADIUS,
  TANK_REVERSE_SPEED,
  TANK_SPEED,
} from '../game/constants.js';

export const ACTION_SECONDS = 0.3;
export const SUBSTEP_SECONDS = 0.1;
export const SEARCH_DEPTH = 4;
export const DEFAULT_ITERATIONS = 200;

const SUBSTEPS = Math.round(ACTION_SECONDS / SUBSTEP_SECONDS);
const FIRE_COOLDOWN_SECONDS = FIRE_COOLDOWN_MS / 1000;
const PROJECTILE_LIFETIME_SECONDS = PROJECTILE_LIFETIME_MS / 1000;
const MUZZLE_DISTANCE = TANK_RADIUS + 12;
const HIT_DISTANCE_SQUARED = (TANK_RADIUS + PROJECTILE_RADIUS) ** 2;
const DISCOUNT = 0.9;
const EXPLORATION = 1.2;
const REWARD_SCALE = 100;
const PREFERRED_RANGE = 320;
// The modelled opponent fires when its barrel is within this angle of the bot.
const OPPONENT_AIM_TOLERANCE = 0.12;
const OPPONENT_FIRE_RANGE = 700;

// All 18 combinations of throttle x turn x fire, mirroring the five boolean
// controls a human client can send.
export const ACTIONS = Object.freeze(
  [1, 0, -1].flatMap((throttle) => [-1, 0, 1].flatMap((turn) => [false, true].map((fire) => Object.freeze({
    throttle,
    turn,
    fire,
  })))),
);

export function actionToInput(action) {
  return {
    forward: action.throttle > 0,
    backward: action.throttle < 0,
    left: action.turn < 0,
    right: action.turn > 0,
    fire: action.fire,
  };
}

export function createRandom(seed = Date.now()) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeAngle(angle) {
  let result = angle % (Math.PI * 2);
  if (result > Math.PI) result -= Math.PI * 2;
  if (result < -Math.PI) result += Math.PI * 2;
  return result;
}

function angleTo(from, to) {
  return normalizeAngle(Math.atan2(to.y - from.y, to.x - from.x) - from.rotation);
}

function cloneTank(tank) {
  return tank && { ...tank };
}

function cloneState(state) {
  return {
    me: cloneTank(state.me),
    foe: cloneTank(state.foe),
    shots: state.shots.map((shot) => ({ ...shot })),
    arena: state.arena,
  };
}

function moveTank(tank, throttle, turn, seconds, arena) {
  tank.rotation = normalizeAngle(tank.rotation + turn * ROTATION_SPEED * seconds);
  const speed = throttle >= 0 ? TANK_SPEED : TANK_REVERSE_SPEED;
  tank.x = clamp(tank.x + Math.cos(tank.rotation) * throttle * speed * seconds, TANK_RADIUS, arena.width - TANK_RADIUS);
  tank.y = clamp(tank.y + Math.sin(tank.rotation) * throttle * speed * seconds, TANK_RADIUS, arena.height - TANK_RADIUS);
  tank.cooldown = Math.max(0, tank.cooldown - seconds);
}

function tryFire(tank, owner, shots) {
  if (tank.cooldown > 0) return;
  tank.cooldown = FIRE_COOLDOWN_SECONDS;
  const cos = Math.cos(tank.rotation);
  const sin = Math.sin(tank.rotation);
  shots.push({
    owner,
    x: tank.x + cos * MUZZLE_DISTANCE,
    y: tank.y + sin * MUZZLE_DISTANCE,
    vx: cos * PROJECTILE_SPEED,
    vy: sin * PROJECTILE_SPEED,
    ttl: PROJECTILE_LIFETIME_SECONDS,
  });
}

// Opponent model: hold its current throttle, swing the turret toward the bot,
// and fire when lined up. This is a cautious "the target fights back" model.
function opponentControls(foe, me) {
  const offset = angleTo(foe, me);
  const distance = Math.hypot(me.x - foe.x, me.y - foe.y);
  return {
    throttle: foe.throttle ?? 0,
    turn: Math.abs(offset) < 0.05 ? 0 : Math.sign(offset),
    fire: Math.abs(offset) < OPPONENT_AIM_TOLERANCE && distance < OPPONENT_FIRE_RANGE,
  };
}

/**
 * Advances the simplified world by one macro action.
 * @returns {number} immediate reward: damage dealt minus damage taken, plus kill bonuses.
 */
export function simulateAction(state, action) {
  const { me, arena } = state;
  let reward = 0;

  for (let substep = 0; substep < SUBSTEPS; substep += 1) {
    if (me.health <= 0) break;
    const foe = state.foe && state.foe.health > 0 ? state.foe : null;

    moveTank(me, action.throttle, action.turn, SUBSTEP_SECONDS, arena);
    if (action.fire) tryFire(me, 'me', state.shots);

    if (foe) {
      const controls = opponentControls(foe, me);
      moveTank(foe, controls.throttle, controls.turn, SUBSTEP_SECONDS, arena);
      if (controls.fire) tryFire(foe, 'foe', state.shots);
    }

    const remaining = [];
    for (const shot of state.shots) {
      shot.x += shot.vx * SUBSTEP_SECONDS;
      shot.y += shot.vy * SUBSTEP_SECONDS;
      shot.ttl -= SUBSTEP_SECONDS;
      if (shot.ttl <= 0 || shot.x < 0 || shot.y < 0 || shot.x > arena.width || shot.y > arena.height) continue;

      const target = shot.owner === 'me' ? foe : me;
      if (target && target.health > 0) {
        const dx = target.x - shot.x;
        const dy = target.y - shot.y;
        if (dx * dx + dy * dy <= HIT_DISTANCE_SQUARED) {
          const damage = Math.min(target.health, PROJECTILE_DAMAGE);
          target.health -= damage;
          if (target === me) reward -= damage * 1.25 + (me.health === 0 ? 120 : 0);
          else reward += damage + (target.health === 0 ? 100 : 0);
          continue;
        }
      }
      remaining.push(shot);
    }
    state.shots = remaining;
  }

  return reward;
}

// Positional heuristic applied at the search horizon: face the target, keep a
// useful firing range, and stay away from walls where dodging is harder.
export function evaluatePosition(state) {
  const { me, foe, arena } = state;
  if (me.health <= 0) return 0;
  let score = me.health * 0.2;
  if (foe && foe.health > 0) {
    const distance = Math.hypot(foe.x - me.x, foe.y - me.y);
    score += Math.cos(angleTo(me, foe)) * 12;
    score -= Math.abs(distance - PREFERRED_RANGE) / 40;
    score -= Math.max(0, Math.cos(angleTo(foe, me))) * 4;
  }
  const wallGap = Math.min(me.x, me.y, arena.width - me.x, arena.height - me.y);
  if (wallGap < 70) score -= (70 - wallGap) / 10;
  return score;
}

// Rollout policy: mostly aim-and-shoot with some random exploration, which
// gives far better value estimates than uniform random play.
function rolloutAction(state, random) {
  if (random() < 0.35 || !state.foe || state.foe.health <= 0) {
    return ACTIONS[Math.floor(random() * ACTIONS.length)];
  }
  const offset = angleTo(state.me, state.foe);
  const turn = Math.abs(offset) < 0.08 ? 0 : Math.sign(offset);
  const throttle = random() < 0.5 ? 0 : (random() < 0.5 ? 1 : -1);
  return ACTIONS.find((action) => action.throttle === throttle && action.turn === turn && action.fire === (Math.abs(offset) < 0.2));
}

function createNode() {
  return { visits: 0, total: 0, children: new Array(ACTIONS.length).fill(null) };
}

function selectChild(node, random) {
  const unexplored = [];
  for (let index = 0; index < ACTIONS.length; index += 1) if (!node.children[index]) unexplored.push(index);
  if (unexplored.length) return { index: unexplored[Math.floor(random() * unexplored.length)], expand: true };

  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  const logVisits = Math.log(node.visits);
  for (let index = 0; index < ACTIONS.length; index += 1) {
    const child = node.children[index];
    const score = child.total / child.visits + EXPLORATION * Math.sqrt(logVisits / child.visits);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return { index: bestIndex, expand: false };
}

/**
 * Runs UCT Monte Carlo tree search from a world description.
 * @param {{ me, foe, shots, arena? }} world tanks use { x, y, rotation, health, cooldown, throttle? }.
 * @returns {{ action, input, iterations, rootVisits: number[], expectedValue: number }}
 */
export function searchBestAction(world, { iterations = DEFAULT_ITERATIONS, random = createRandom(), depth = SEARCH_DEPTH } = {}) {
  const root = createNode();
  const rootState = cloneState({ ...world, arena: world.arena ?? ARENA });

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const state = cloneState(rootState);
    const path = [root];
    const rewards = [];
    let node = root;

    // Selection and expansion: walk the tree with UCT until a new node is added.
    while (rewards.length < depth && state.me.health > 0) {
      const { index, expand } = selectChild(node, random);
      if (expand) node.children[index] = createNode();
      node = node.children[index];
      rewards.push(simulateAction(state, ACTIONS[index]));
      path.push(node);
      if (expand) break;
    }

    // Simulation: finish the horizon with the rollout policy.
    let rolloutReturn = 0;
    let discount = 1;
    for (let step = rewards.length; step < depth && state.me.health > 0; step += 1) {
      rolloutReturn += discount * simulateAction(state, rolloutAction(state, random));
      discount *= DISCOUNT;
    }
    rolloutReturn += discount * evaluatePosition(state);

    // Backpropagation: a node's value is the reward of the action that reached
    // it plus the discounted return of everything after it.
    let value = rolloutReturn;
    for (let level = path.length - 1; level >= 1; level -= 1) {
      value = rewards[level - 1] + DISCOUNT * value;
      path[level].visits += 1;
      path[level].total += value / REWARD_SCALE;
    }
    root.visits += 1;
    root.total += value / REWARD_SCALE;
  }

  let bestIndex = 0;
  for (let index = 1; index < ACTIONS.length; index += 1) {
    const candidate = root.children[index];
    const best = root.children[bestIndex];
    if (!candidate) continue;
    if (!best || candidate.visits > best.visits
      || (candidate.visits === best.visits && candidate.total > best.total)) bestIndex = index;
  }

  const chosen = root.children[bestIndex];
  return {
    action: ACTIONS[bestIndex],
    input: actionToInput(ACTIONS[bestIndex]),
    iterations,
    rootVisits: root.children.map((child) => child?.visits ?? 0),
    expectedValue: chosen ? (chosen.total / chosen.visits) * REWARD_SCALE : 0,
  };
}
