## Live Deployment

The application is publicly available at:

https://tankbattle312.duckdns.org

The production deployment runs on an Ubuntu server using Docker Compose,
nginx, Node.js/Express, React, and PostgreSQL.

HTTPS is provided through Let's Encrypt, with HTTP requests redirected to HTTPS.

# Tank Battle Arena

University at Buffalo CSE 312 team project. The current build covers Objective 1 (deployment) and Objective 2 (accounts with JWTs issued by a separate auth server): a responsive React landing page, an Express app server, a separate Express auth server, nginx routing, and PostgreSQL. Gameplay and WebSockets come in Objective 3.

## Technology Stack

- **Frontend (implemented):** React 19 and React DOM provide the component-based user interface. Vite 7 and `@vitejs/plugin-react` power local development and production builds. The browser client is written in JavaScript with semantic HTML and responsive CSS.
- **Backend (implemented):** Node.js 22 runs the server using ECMAScript modules, while Express 5 provides the HTTP API and health endpoint. The `pg` driver is included for PostgreSQL connectivity; the connection pool is prepared for future persistence features.
- **Database (implemented infrastructure):** PostgreSQL 17 stores application data in a persistent named volume. Objective 1 configures the database service but does not yet implement application data models or queries.
- **Web Server / Reverse Proxy (implemented):** nginx 1.27 serves the Vite production build and forwards `/api/` requests to the Express service.
- **Containerization (implemented):** Docker packages the frontend/nginx and backend services, and Docker Compose coordinates nginx, Node.js, and PostgreSQL on an isolated local network.
- **Real-Time Multiplayer (planned):** Socket.IO is planned for real-time client/server communication, and Phaser 3 is planned for browser-based game rendering and gameplay. Neither technology is currently installed or implemented.

## Architecture

```text
Browser :8080
    |
  nginx ── static files ── React/Vite production build
    |
    ├── /register, /login, /logout ── auth server :4000 ── PostgreSQL :5432
    |                                   │ (holds JWT private key)    (internal only)
    |                                   └─ writes public key ─┐
    |                                                         ▼  shared volume (read-only for app)
    └── /api/* ─────────────────────── app server :3000  (verifies JWTs with public key only)
```

The services are isolated in separate containers. Only nginx publishes a host port. PostgreSQL data is stored in the `postgres_data` named volume, and port 5432 is not published to the host.

The source layout leaves clear extension points:

- `frontend/src/` — React UI; a future Phaser game can live under `frontend/src/game/`.
- `backend/src/` — HTTP API; future Socket.IO modules can live under `backend/src/realtime/`.
- `backend/src/config/database.js` — reserved database pool factory for later persistence work.
- A future authentication service can be added as its own top-level directory and Compose service without coupling it to the game server.

## Objective 2: Authentication

**Using it:** open <http://localhost:8080>, click **Register** (top right) to create an account, then **Log in**. When logged in, the header shows your username next to a **Log out** button and the hero shows "Welcome, commander <name>". Refreshing the page, or restarting every container with `docker compose down && docker compose up`, keeps you logged in until the token expires (24 hours by default).

**How it works:**

- **Separate auth server** (`auth/`, its own container). nginx sends `/register`, `/login`, and `/logout` only to this container (`nginx/default.conf`); those requests never reach the app container. It stores accounts in PostgreSQL (`users` table, bcrypt password hashes, case-insensitive unique usernames, parameterized queries).
- **JWT issuing.** On login the auth server signs a JWT with **RS256** using an RSA private key. The token carries `sub`, `username`, `iss`, `aud`, `iat`, and `exp`, and is sent as an `HttpOnly; SameSite=Strict; Path=/` cookie (plus `Secure` over HTTPS). Logout clears the cookie.
- **Keys.** On first start the auth server generates a 2048-bit RSA key pair. The private key is on the `jwt_private_key` volume, which **only** the auth container mounts. The public key is written to the `jwt_public_key` volume, which the app server mounts **read-only**. Both are named volumes, so keys (and therefore sessions) survive restarts. This shared volume is the only link between the two servers.
- **Verification in the app server** (`backend/src/auth/jwt.js`). The app server reads the token from the cookie and verifies it locally with the public key. It never calls the auth server or the database to find out who the user is. It accepts **only** `RS256` and rejects:
  - bad or forged signatures and tampered payloads,
  - `alg: none`, HS256 tokens "signed" with the public key, or any other algorithm,
  - expired tokens, and tokens with no `exp` claim,
  - wrong issuer or audience.
- `GET /api/me` returns the logged-in username, or 401. The `authenticate` middleware and `userFromCookieHeader()` are the hooks for authenticating WebSocket handshakes in Objective 3.
- **XSRF.** Besides the `SameSite=Strict` cookie, the auth endpoints accept only `Content-Type: application/json`, so cross-site HTML form posts get a 415.

**Automated tests:** `cd auth && npm install && npm test`, and `cd backend && npm install && npm test`. They cover registration and login validation, the cookie flags, key persistence, and each forgery case listed above.

**Deployment note:** set `COOKIE_SECURE=true` in the production `.env`. With the default `auto`, the cookie gets `Secure` only if the outer proxy sends `X-Forwarded-Proto: https`.

## Prerequisites (Windows)

- Docker Desktop with Docker Compose v2
- Windows PowerShell

No host installation of Node.js or PostgreSQL is required for the container workflow.

## Configure the local environment

From PowerShell in the repository root:

```powershell
Copy-Item .env.example .env
```

Open `.env` and replace `change-this-local-password` with a local password. The `.env` file is ignored by Git and must not be committed. This step is optional locally: without a `.env`, `docker compose up` falls back to local defaults. Always use a `.env` with a real password on the deployed server.

## Validate, build, and start

```powershell
docker compose config
docker compose build
docker compose up -d
```

Wait for the services to become healthy, then open <http://localhost:8080>.

## Test through nginx

```powershell
# Homepage should return HTTP 200.
(Invoke-WebRequest -Uri http://localhost:8080/).StatusCode

# API should return JSON with status "ok".
Invoke-RestMethod -Uri http://localhost:8080/api/health | ConvertTo-Json

# Optional: inspect container state and health.
docker compose ps
```

Expected API shape (the timestamp varies):

```json
{
  "status": "ok",
  "service": "tank-battle-arena-api",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

## Stop the application

```powershell
docker compose down
```

This keeps the PostgreSQL and JWT key named volumes. To also delete local database data and signing keys, explicitly run `docker compose down --volumes`; that deletion is irreversible, and it logs everyone out because a new key pair is generated.

## Local development without Docker (optional)

Run each application in its own PowerShell window:

```powershell
Set-Location frontend
npm install
npm run dev
```

```powershell
Set-Location backend
npm install
npm run dev
```

The production container path remains the supported way to verify nginx routing and the full local infrastructure.



