import bcrypt from 'bcryptjs';
import express from 'express';
import jwt from 'jsonwebtoken';
import { UsernameTakenError } from './userStore.js';

export const TOKEN_COOKIE = 'auth_token';
export const JWT_ALGORITHM = 'RS256';
export const JWT_ISSUER = 'tank-battle-arena-auth';
export const JWT_AUDIENCE = 'tank-battle-arena-app';

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_BYTES = 72; // bcrypt ignores anything past 72 bytes
const BCRYPT_ROUNDS = 11;
const GENERIC_LOGIN_ERROR = 'Invalid username or password.';

// Compared against when the username does not exist so that a failed login
// takes the same time whether or not the account exists.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-password', BCRYPT_ROUNDS);

function validateCredentials(body) {
  const { username, password } = body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return 'Username and password are required.';
  }
  if (!USERNAME_PATTERN.test(username)) {
    return 'Username must be 3-20 characters: letters, numbers, or underscores.';
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    return `Password must be at most ${MAX_PASSWORD_BYTES} bytes.`;
  }
  return null;
}

/**
 * @param {object} options
 * @param {object} options.userStore    account storage (see userStore.js)
 * @param {string} options.privateKey   PEM RSA private key used to sign tokens
 * @param {number} options.tokenTtlSeconds  lifetime of issued tokens (exp claim)
 * @param {'auto'|'true'|'false'} options.cookieSecure  whether to add the Secure cookie flag
 */
export function createAuthApp({ userStore, privateKey, tokenTtlSeconds = 60 * 60 * 24, cookieSecure = 'auto' }) {
  const app = express();

  app.disable('x-powered-by');

  function isSecureRequest(request) {
    if (cookieSecure === 'true') return true;
    if (cookieSecure === 'false') return false;
    return request.get('x-forwarded-proto')?.split(',')[0].trim() === 'https';
  }

  function cookieOptions(request) {
    return {
      httpOnly: true,
      secure: isSecureRequest(request),
      sameSite: 'strict',
      path: '/',
    };
  }

  app.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });

  // These routes are reached from the browser only through fetch() with a JSON
  // body. Requiring application/json blocks cross-site HTML form submissions
  // (which cannot set that content type without a CORS preflight), adding XSRF
  // protection on top of the SameSite=Strict cookie.
  function requireJson(request, response, next) {
    if (!request.is('application/json')) {
      return response.status(415).json({ error: 'Requests must use Content-Type: application/json.' });
    }
    return next();
  }

  app.use(express.json({ limit: '10kb' }));

  app.post('/register', requireJson, async (request, response, next) => {
    try {
      const problem = validateCredentials(request.body);
      if (problem) return response.status(400).json({ error: problem });

      const { username, password } = request.body;
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const user = await userStore.create(username, passwordHash);
      return response.status(201).json({ username: user.username });
    } catch (error) {
      if (error instanceof UsernameTakenError) {
        return response.status(409).json({ error: 'That username is already taken.' });
      }
      return next(error);
    }
  });

  app.post('/login', requireJson, async (request, response, next) => {
    try {
      const { username, password } = request.body ?? {};
      if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
        return response.status(400).json({ error: 'Username and password are required.' });
      }

      const user = USERNAME_PATTERN.test(username) ? await userStore.findByUsername(username) : null;
      const passwordMatches = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
      if (!user || !passwordMatches) {
        return response.status(401).json({ error: GENERIC_LOGIN_ERROR });
      }

      const token = jwt.sign({ username: user.username }, privateKey, {
        algorithm: JWT_ALGORITHM,
        expiresIn: tokenTtlSeconds,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        subject: String(user.id),
      });

      response.cookie(TOKEN_COOKIE, token, { ...cookieOptions(request), maxAge: tokenTtlSeconds * 1000 });
      return response.json({ username: user.username });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/logout', requireJson, (request, response) => {
    response.clearCookie(TOKEN_COOKIE, cookieOptions(request));
    response.json({ loggedOut: true });
  });

  // Someone typing /login, /register, or /logout into the address bar lands
  // back on the home page with the matching panel open.
  app.get(['/login', '/register', '/logout'], (request, response) => {
    const panel = request.path.slice(1);
    response.redirect(303, panel === 'logout' ? '/' : `/?auth=${panel}`);
  });

  app.get('/auth/health', async (_request, response) => {
    try {
      await userStore.ping();
      response.json({ status: 'ok', service: 'tank-battle-arena-auth' });
    } catch {
      response.status(503).json({ status: 'unavailable', service: 'tank-battle-arena-auth' });
    }
  });

  app.use((_request, response) => {
    response.status(404).json({ error: 'Not found' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, _request, response, _next) => {
    if (error.type === 'entity.parse.failed') {
      return response.status(400).json({ error: 'Malformed JSON body.' });
    }
    if (error.type === 'entity.too.large') {
      return response.status(413).json({ error: 'Request body too large.' });
    }
    console.error(error);
    return response.status(500).json({ error: 'Internal server error.' });
  });

  return app;
}
