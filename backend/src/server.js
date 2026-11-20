import { createServer } from 'node:http';
import { createApp } from './app.js';
import { createTokenVerifier } from './auth/jwt.js';
import { attachGameServer, parseAllowedOrigins } from './realtime/gameServer.js';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const tokenVerifier = createTokenVerifier({
  publicKeyPath: process.env.JWT_PUBLIC_KEY_PATH ?? '/keys/public/jwt_public.pem',
});
const app = createApp({ tokenVerifier });
const server = createServer(app);
const gameGateway = attachGameServer(server, {
  tokenVerifier,
  allowedOrigins: parseAllowedOrigins(
    process.env.ALLOWED_ORIGINS ?? 'http://localhost:8080,https://tankbattle312.duckdns.org',
  ),
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Tank Battle Arena API listening on port ${port}`);
});

function shutDown(signal) {
  console.log(`${signal} received; closing HTTP server`);
  gameGateway.stop();
  gameGateway.io.close(() => server.close(() => process.exit(0)));
}

process.on('SIGTERM', () => shutDown('SIGTERM'));
process.on('SIGINT', () => shutDown('SIGINT'));

