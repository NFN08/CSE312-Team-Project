import { createApp } from './app.js';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const app = createApp();

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Tank Battle Arena API listening on port ${port}`);
});

function shutDown(signal) {
  console.log(`${signal} received; closing HTTP server`);
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutDown('SIGTERM'));
process.on('SIGINT', () => shutDown('SIGINT'));

