import express from 'express';
import { authenticate, createTokenVerifier, requireAuth } from './auth/jwt.js';

export function createApp({ tokenVerifier } = {}) {
  const app = express();
  const verifier = tokenVerifier ?? createTokenVerifier({
    publicKeyPath: process.env.JWT_PUBLIC_KEY_PATH ?? '/keys/public/jwt_public.pem',
  });

  app.disable('x-powered-by');
  app.use(express.json());
  app.use(authenticate(verifier));

  app.get('/api/health', (_request, response) => {
    response.json({
      status: 'ok',
      service: 'tank-battle-arena-api',
      timestamp: new Date().toISOString(),
    });
  });

  // Identity comes only from the verified JWT; no auth-server or database lookup.
  app.get('/api/me', requireAuth, (request, response) => {
    response.set('Cache-Control', 'no-store');
    response.json({ username: request.user.username });
  });

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'API route not found' });
  });

  return app;
}
