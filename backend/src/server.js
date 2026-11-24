import { createServer } from 'node:http';
import { createApp } from './app.js';
import { createTokenVerifier } from './auth/jwt.js';
import { attachGameServer, parseAllowedOrigins } from './realtime/gameServer.js';
import { BotController, parseBotConfig } from './ai/botController.js';
import { GameEngine } from './game/engine.js';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const tokenVerifier = createTokenVerifier({
  publicKeyPath: process.env.JWT_PUBLIC_KEY_PATH ?? '/keys/public/jwt_public.pem',
});
const app = createApp({ tokenVerifier });
const server = createServer(app);
const engine = new GameEngine();
const botConfig = parseBotConfig();
const gameGateway = attachGameServer(server, {
  tokenVerifier,
  engine,
  bots: new BotController({ engine, ...botConfig }),
  allowedOrigins: parseAllowedOrigins(
    process.env.ALLOWED_ORIGINS ?? 'http://localhost:8080,https://tankbattle312.duckdns.org',
  ),
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Tank Battle Arena API listening on port ${port}`);
  console.log(`AI bots: ${botConfig.count} (MCTS, ${botConfig.iterations} iterations per decision)`);
});

function shutDown(signal) {
  console.log(`${signal} received; closing HTTP server`);
  gameGateway.stop();
  gameGateway.io.close(() => server.close(() => process.exit(0)));
}

process.on('SIGTERM', () => shutDown('SIGTERM'));
process.on('SIGINT', () => shutDown('SIGINT'));

