import { createAuthApp } from './app.js';
import { loadOrCreateKeyPair } from './keys.js';
import { createPostgresUserStore } from './userStore.js';

const port = Number.parseInt(process.env.PORT ?? '4000', 10);

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

const { privateKey } = loadOrCreateKeyPair({
  privateKeyPath: process.env.JWT_PRIVATE_KEY_PATH ?? '/keys/private/jwt_private.pem',
  publicKeyPath: process.env.JWT_PUBLIC_KEY_PATH ?? '/keys/public/jwt_public.pem',
});

const userStore = createPostgresUserStore(process.env.DATABASE_URL);
await userStore.init();

const app = createAuthApp({
  userStore,
  privateKey,
  tokenTtlSeconds: Number.parseInt(process.env.JWT_TTL_SECONDS ?? '86400', 10),
  cookieSecure: process.env.COOKIE_SECURE ?? 'auto',
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Tank Battle Arena auth server listening on port ${port}`);
});

function shutDown(signal) {
  console.log(`${signal} received; closing auth server`);
  server.close(async () => {
    await userStore.close();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutDown('SIGTERM'));
process.on('SIGINT', () => shutDown('SIGINT'));
