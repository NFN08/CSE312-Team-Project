// Client helpers for the auth server (/register, /login, /logout) and the
// app server's identity endpoint (/api/me). The JWT lives in an HttpOnly
// cookie, so JavaScript never touches the token itself.

async function postJson(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body ?? {}),
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    // Non-JSON error page (e.g. nginx 502); fall through to the generic message.
  }
  if (!response.ok) {
    throw new Error(data.error ?? `Request failed (${response.status})`);
  }
  return data;
}

export function register(username, password) {
  return postJson('/register', { username, password });
}

export function login(username, password) {
  return postJson('/login', { username, password });
}

export function logout() {
  return postJson('/logout');
}

/** @returns {Promise<string|null>} the logged-in username, or null. */
export async function fetchCurrentUser(signal) {
  const response = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store', signal });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('Could not check login status');
  const data = await response.json();
  return data.username;
}
