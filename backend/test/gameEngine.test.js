import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameEngine, parsePlayerInput } from '../src/game/engine.js';
import { MAX_HEALTH, RESPAWN_DELAY_MS, TANK_RADIUS } from '../src/game/constants.js';

const input = (overrides = {}) => ({
  forward: false,
  backward: false,
  left: false,
  right: false,
  fire: false,
  ...overrides,
});

function duelEngine() {
  const engine = new GameEngine({
    spawnPoints: [
      { x: 100, y: 100, rotation: 0 },
      { x: 200, y: 100, rotation: Math.PI },
    ],
  });
  engine.addPlayer({ userId: '1', username: 'alice' }, 'socket-a', 1000);
  engine.addPlayer({ userId: '2', username: 'bob' }, 'socket-b', 1000);
  return engine;
}

test('validates complete boolean input and rejects extra client state', () => {
  assert.deepEqual(parsePlayerInput(input({ forward: true })), input({ forward: true }));
  assert.equal(parsePlayerInput({ ...input(), username: 'admin' }), null);
  assert.equal(parsePlayerInput({ forward: true }), null);
  assert.equal(parsePlayerInput({ ...input(), fire: 'yes' }), null);
  assert.equal(parsePlayerInput(null), null);
});

test('moves simultaneous players from inputs and keeps tanks inside the arena', () => {
  const engine = duelEngine();
  engine.setInput('1', 'socket-a', input({ forward: true }), 1000);
  engine.setInput('2', 'socket-b', input({ forward: true }), 1000);
  engine.step(0.05, 1020);

  const state = engine.snapshot(1020);
  const alice = state.players.find((player) => player.id === '1');
  const bob = state.players.find((player) => player.id === '2');
  assert.ok(alice.x > 100);
  assert.ok(bob.x < 200);

  for (let index = 0; index < 1000; index += 1) engine.step(0.05, 1030 + index);
  const bounded = engine.snapshot(3000).players.find((player) => player.id === '1');
  assert.ok(bounded.x >= TANK_RADIUS && bounded.x <= state.arena.width - TANK_RADIUS);
  assert.ok(bounded.y >= TANK_RADIUS && bounded.y <= state.arena.height - TANK_RADIUS);
});

test('projectile hits cause damage, award a score, and respawn the destroyed tank', () => {
  const engine = duelEngine();
  engine.setInput('1', 'socket-a', input({ fire: true }), 2000);

  for (let shot = 0; shot < 3; shot += 1) {
    const firedAt = 2000 + shot * 400;
    engine.step(0, firedAt);
    engine.step(0.05, firedAt + 50);
    engine.step(0.025, firedAt + 75);
  }

  let state = engine.snapshot(2875);
  const alice = state.players.find((player) => player.id === '1');
  const bob = state.players.find((player) => player.id === '2');
  assert.equal(alice.score, 1);
  assert.equal(bob.health, 0);
  assert.equal(bob.alive, false);
  assert.ok(bob.respawnIn > 0);

  engine.setInput('1', 'socket-a', input(), 2900);
  engine.step(0, 2875 + RESPAWN_DELAY_MS + 1);
  state = engine.snapshot(2875 + RESPAWN_DELAY_MS + 1);
  const respawned = state.players.find((player) => player.id === '2');
  assert.equal(respawned.alive, true);
  assert.equal(respawned.health, MAX_HEALTH);
  assert.equal(state.players.find((player) => player.id === '1').score, 1);
});

test('stale socket disconnects cannot remove a replacement session', () => {
  const engine = duelEngine();
  engine.addPlayer({ userId: '1', username: 'alice' }, 'new-socket', 2000);
  assert.equal(engine.removePlayer('1', 'socket-a'), false);
  assert.equal(engine.hasPlayer('1'), true);
  assert.equal(engine.removePlayer('1', 'new-socket'), true);
});
