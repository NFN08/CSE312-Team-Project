import { readFileSync, statSync } from 'node:fs';
import jwt from 'jsonwebtoken';

export const TOKEN_COOKIE = 'auth_token';
export const JWT_ALGORITHM = 'RS256';
export const JWT_ISSUER = 'tank-battle-arena-auth';
export const JWT_AUDIENCE = 'tank-battle-arena-app';

/**
 * Verifies JWTs issued by the auth server using only its public key.
 *
 * The game server never contacts the auth server or the database to learn who
 * a user is: identity comes solely from a token whose RS256 signature checks
 * out against the public key the auth server published to the shared volume.
 */
export function createTokenVerifier({ publicKey, publicKeyPath } = {}) {
  let cachedKey = publicKey ?? null;
  let cachedMtimeMs = null;

  function currentKey() {
    if (publicKey) return publicKey;
    // Re-read when the file changes (e.g. the key volume was recreated).
    const { mtimeMs } = statSync(publicKeyPath);
    if (cachedKey === null || mtimeMs !== cachedMtimeMs) {
      cachedKey = readFileSync(publicKeyPath, 'utf8');
      cachedMtimeMs = mtimeMs;
    }
    return cachedKey;
  }

  /**
   * @returns {{ userId: string, username: string } | null} the verified identity,
   *   or null for a missing, forged, expired, wrong-algorithm, or malformed token.
   */
  function verify(token) {
    if (typeof token !== 'string' || token.length === 0) return null;
    try {
      const payload = jwt.verify(token, currentKey(), {
        // Only RS256 is accepted: this rejects "alg: none", HS256 tokens
        // "signed" with the public key, and any other algorithm.
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      // jsonwebtoken only enforces exp when present, so require it explicitly.
      if (typeof payload.exp !== 'number') return null;
      if (typeof payload.username !== 'string' || typeof payload.sub !== 'string') return null;
      return { userId: payload.sub, username: payload.username };
    } catch {
      return null;
    }
  }

  return { verify, currentKey };
}

export function parseCookies(cookieHeader) {
  const cookies = {};
  if (typeof cookieHeader !== 'string') return cookies;
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name || Object.hasOwn(cookies, name)) continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

/** Resolves the user from a raw Cookie header (usable for HTTP and WebSocket handshakes). */
export function userFromCookieHeader(verifier, cookieHeader) {
  return verifier.verify(parseCookies(cookieHeader)[TOKEN_COOKIE]);
}

/** Express middleware: sets request.user to the verified identity or null. */
export function authenticate(verifier) {
  return (request, _response, next) => {
    request.user = userFromCookieHeader(verifier, request.headers.cookie);
    next();
  };
}

/** Express middleware: rejects the request with 401 unless a valid token is present. */
export function requireAuth(request, response, next) {
  if (!request.user) {
    return response.status(401).json({ error: 'Authentication required' });
  }
  return next();
}
