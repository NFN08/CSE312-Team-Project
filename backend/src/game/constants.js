export const ARENA = Object.freeze({ width: 1200, height: 700 });
export const TANK_RADIUS = 22;
export const TANK_SPEED = 185;
export const TANK_REVERSE_SPEED = 115;
export const ROTATION_SPEED = 2.8;
export const MAX_HEALTH = 100;
export const PROJECTILE_SPEED = 520;
export const PROJECTILE_RADIUS = 5;
export const PROJECTILE_DAMAGE = 34;
export const PROJECTILE_LIFETIME_MS = 1800;
export const FIRE_COOLDOWN_MS = 360;
export const RESPAWN_DELAY_MS = 2000;
export const INPUT_TIMEOUT_MS = 1200;
export const MAX_PROJECTILES = 96;
export const MAX_PLAYERS = 32;

export const DEFAULT_SPAWN_POINTS = Object.freeze([
  { x: 120, y: 120, rotation: 0 },
  { x: 1080, y: 580, rotation: Math.PI },
  { x: 1080, y: 120, rotation: Math.PI },
  { x: 120, y: 580, rotation: 0 },
  { x: 600, y: 110, rotation: Math.PI / 2 },
  { x: 600, y: 590, rotation: -Math.PI / 2 },
  { x: 270, y: 350, rotation: 0 },
  { x: 930, y: 350, rotation: Math.PI },
  { x: 410, y: 210, rotation: Math.PI / 4 },
  { x: 790, y: 490, rotation: -3 * Math.PI / 4 },
  { x: 790, y: 210, rotation: 3 * Math.PI / 4 },
  { x: 410, y: 490, rotation: -Math.PI / 4 },
]);
