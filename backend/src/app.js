import express from 'express';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/api/health', (_request, response) => {
    response.json({
      status: 'ok',
      service: 'tank-battle-arena-api',
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'API route not found' });
  });

  return app;
}

