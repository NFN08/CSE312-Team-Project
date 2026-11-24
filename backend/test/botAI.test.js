import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACTIONS,
  SEARCH_DEPTH,
  actionToInput,
  createRandom,
  searchBestAction,
  simulateAction,
} from '../src/ai/mcts.js';
import { parseBotConfig } from '../src/ai/botController.js';
import { PROJECTILE_SPEED } from '../src/game/constants.js';

const tank = (overrides = {}) => ({ x: 300, y: 350, rotation: 0, health: 100, cooldown: 0, throttle: 0, ...overrides });

function search(world, seed = 1, iterations = 300) {
  return searchBestAction({ shots: [], ...world }, { iterations, random: createRandom(seed) });
}

function cloneWorld(world) {
  return {
    me: { ...world.me },
    foe: world.foe && { ...world.foe },
    shots: world.shots.map((shot) => ({ ...shot })),
    arena: { width: 1200, height: 700 },
  };
}

test('action space mirrors the five boolean client controls', () => {
  assert.equal(ACTIONS.length, 18);
  for (const action of ACTIONS) {
    const input = actionToInput(action);
    assert.deepEqual(Object.keys(input), ['forward', 'backward', 'left', 'right', 'fire']);
    assert.ok(!(input.forward && input.backward));
    assert.ok(!(input.left && input.right));
  }
});

test('fires when the barrel is already lined up with a target in range', () => {
  for (const seed of [1, 2, 3]) {
    const result = search({ me: tank(), foe: tank({ x: 650, rotation: Math.PI / 2, cooldown: 1 }) }, seed);
    assert.equal(result.action.fire, true, `seed ${seed}`);
    assert.equal(result.action.turn, 0, `seed ${seed}`);
  }
});

test('turns toward a target that is off to either side', () => {
  const below = search({ me: tank(), foe: tank({ x: 300, y: 620, cooldown: 1 }) });
  assert.equal(below.action.turn, 1, 'target below (clockwise in screen space) means turn right');
  const above = search({ me: tank(), foe: tank({ x: 300, y: 80, cooldown: 1 }) });
  assert.equal(above.action.turn, -1, 'target above means turn left');
});

test('dodges an incoming projectile that would hit if the bot stayed still', () => {
  // A shot 260px to the left travelling straight at the bot; the bot faces up the screen.
  const world = {
    me: tank({ x: 600, y: 350, rotation: -Math.PI / 2 }),
    foe: null,
    shots: [{ owner: 'foe', x: 340, y: 350, vx: PROJECTILE_SPEED, vy: 0, ttl: 1.5 }],
  };

  const idle = cloneWorld(world);
  const idleAction = ACTIONS.find((action) => action.throttle === 0 && action.turn === 0 && !action.fire);
  let idleReward = 0;
  for (let step = 0; step < SEARCH_DEPTH; step += 1) idleReward += simulateAction(idle, idleAction);
  assert.ok(idleReward < 0 && idle.me.health < 100, 'standing still must be hit');

  const { action } = search(world);
  const moved = cloneWorld(world);
  const firstReward = simulateAction(moved, action);
  assert.notEqual(action.throttle, 0, 'the bot must drive out of the line of fire');
  assert.equal(firstReward, 0);
  assert.equal(moved.me.health, 100);
});

test('is a real UCT search: visits add up, every action is explored, results are reproducible', () => {
  const world = { me: tank(), foe: tank({ x: 700, y: 500 }) };
  const first = search(world, 42, 250);
  const second = search(world, 42, 250);
  assert.equal(first.rootVisits.reduce((sum, visits) => sum + visits, 0), 250);
  assert.ok(first.rootVisits.every((visits) => visits >= 1));
  assert.equal(Math.max(...first.rootVisits), first.rootVisits[ACTIONS.indexOf(first.action)]);
  assert.deepEqual(first, second);
});

test('a decision with the default budget stays well inside one 33ms game tick', () => {
  const world = {
    me: tank(),
    foe: tank({ x: 700, y: 500 }),
    shots: Array.from({ length: 20 }, (_, index) => ({ owner: index % 2 ? 'me' : 'foe', x: 50 * index, y: 100, vx: 300, vy: 100, ttl: 1 })),
  };
  search(world, 5, 200);
  const started = performance.now();
  for (let run = 0; run < 10; run += 1) search(world, run, 200);
  const averageMs = (performance.now() - started) / 10;
  assert.ok(averageMs < 15, `average decision took ${averageMs.toFixed(2)}ms`);
});

test('bot configuration has sensible defaults and is clamped', () => {
  assert.deepEqual(parseBotConfig({}), { count: 3, iterations: 200 });
  assert.deepEqual(parseBotConfig({ BOT_COUNT: '0', BOT_SEARCH_ITERATIONS: '50' }), { count: 0, iterations: 50 });
  assert.deepEqual(parseBotConfig({ BOT_COUNT: '500', BOT_SEARCH_ITERATIONS: '1' }), { count: 8, iterations: 20 });
  assert.deepEqual(parseBotConfig({ BOT_COUNT: 'many', BOT_SEARCH_ITERATIONS: '' }), { count: 3, iterations: 200 });
});
