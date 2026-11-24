## Live Deployment

The application is publicly available at:

https://tankbattle312.duckdns.org

The production deployment runs on an Ubuntu server using Docker Compose,
nginx, Node.js/Express, React, and PostgreSQL.

HTTPS is provided through Let's Encrypt, with HTTP requests redirected to HTTPS.

# Tank Battle Arena

University at Buffalo CSE 312 team project. The current build covers Objective 1 (deployment), Objective 2 (accounts with JWTs issued by a separate auth server), Objective 3 (an authenticated real-time multiplayer tank game), and Objective 4 (AI bot tanks driven by Monte Carlo tree search).

## Technology Stack

- **Frontend (implemented):** React 19 and React DOM provide the component-based interface. Vite 7 powers local development and production builds. An HTML Canvas renders the arena, and `socket.io-client` carries real-time control inputs and game snapshots.
- **Backend (implemented):** Node.js 22 and Express 5 provide the HTTP API. Socket.IO shares the HTTP server and runs the authenticated, server-authoritative game connection. The `pg` driver provides PostgreSQL connectivity.
- **Database (implemented):** PostgreSQL 17 stores account records in a persistent named volume and remains private to the Compose network. Real-time match state stays in memory and is not written every tick.
- **Web Server / Reverse Proxy (implemented):** nginx 1.27 serves the Vite production build and forwards `/api/` requests to the Express service.
- **Containerization (implemented):** Docker packages nginx/frontend, the app server, and the auth server. Docker Compose coordinates those services with PostgreSQL on an isolated local network.
- **Real-Time Multiplayer (implemented):** Socket.IO provides WebSocket-only multiplayer communication. A lightweight HTML Canvas renderer displays the shared arena without adding Phaser 3.

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
    ├── /api/* ─────────────────────── app server :3000  (verifies JWTs with public key only)
    └── /socket.io/* ───────────────── Socket.IO game gateway on app server :3000
```

The services are isolated in separate containers. Only nginx publishes a host port. PostgreSQL data is stored in the `postgres_data` named volume, and port 5432 is not published to the host.

The source layout leaves clear extension points:

- `frontend/src/Arena.jsx` — Canvas renderer, match HUD, keyboard controls, and Socket.IO client lifecycle.
- `backend/src/game/` — deterministic authoritative movement, combat, scoring, and respawning.
- `backend/src/realtime/` — authenticated Socket.IO gateway, origin checks, rate limiting, and state broadcasts.
- `backend/src/ai/` — Objective 4 AI bots: the Monte Carlo tree search planner (`mcts.js`) and the controller that runs bots inside the game loop (`botController.js`).
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

## Objective 3: Real-Time Tank Battle

Authenticated players can enter one shared top-down arena. Every tank displays the username from its verified JWT. The app server owns all positions, rotations, projectiles, collision results, health, respawns, and scores; browsers send only five boolean control inputs and cannot submit usernames, coordinates, health, damage, or scores.

### Controls

- `W` — move forward
- `S` — reverse
- `A` / `D` — rotate left or right
- `Space` — fire

Three projectile hits destroy a tank. Destroyed tanks respawn after two seconds, and the attacker receives one elimination. The live standings and current leader remain visible beside the arena.

### Multiplayer and WebSocket security

- Socket.IO is configured for WebSocket transport only. The server simulates at 30 ticks per second and broadcasts snapshots at up to 20 per second.
- The JWT is read from the `HttpOnly` cookie and verified during the WebSocket handshake with the auth server's public key. Invalid, expired, forged, wrong-algorithm, wrong-issuer, and wrong-audience tokens are rejected without an auth-server or database lookup.
- The player ID and username always come from the signed token. Unexpected client fields are rejected.
- Handshakes require an exact allowed `Origin`; configure the comma-separated `ALLOWED_ORIGINS` value when adding a hostname.
- Input messages are limited to 2048 bytes and rate-limited. The world is capped at 32 players and 96 active projectiles to bound CPU, memory, and network use.
- Only one active arena connection is kept per account. A newer connection replaces the older session without allowing the stale socket to remove the new player.

### Test with two players

1. Start the complete stack and open <http://localhost:8080> in a normal browser window.
2. Register and log in as the first user, then select **Enter arena**.
3. Open a private/incognito window at the same URL. Register a different username, log in, and enter the arena.
4. Keep both windows visible. Move with `W`, `A`, `S`, and `D`, and fire with `Space` in each window.
5. Verify both usernames and tanks are visible, movement appears in both windows, hits reduce armor, three hits cause a respawn, and eliminations update the same scoreboard.
6. Close one arena tab and confirm that player disappears from the other. Re-enter and confirm the player rejoins normally.

Automated tests use real Socket.IO clients and cover handshake authentication, origin rejection, two simultaneous players, bidirectional movement, identity protection, combat, damage, respawning, scoring, disconnects, reconnects, and duplicate-session replacement:

```powershell
Set-Location auth
npm install
npm test

Set-Location ..\backend
npm install
npm test
```

### Production compatibility

The browser uses a same-origin Socket.IO path, so local HTTP automatically uses WS and production HTTPS automatically uses WSS. The container nginx configuration forwards WebSocket upgrade headers. The production TLS-terminating nginx proxy must also forward `/socket.io/` with HTTP/1.1 plus the `Upgrade` and `Connection` headers. Set `COOKIE_SECURE=true` and include `https://tankbattle312.duckdns.org` in `ALLOWED_ORIGINS`; do not expose the backend, auth, or PostgreSQL ports.

## Objective 4: AI Bot Tanks (AI and Machine Learning)

**What we built.** Server-side AI tanks that join the same shared arena as logged-in players. Each bot picks its controls with **Monte Carlo tree search (MCTS) using the UCT selection rule**, an algorithm not covered in CSE 312. Bots drive, aim, fire, dodge incoming shells, take damage, get destroyed, respawn, and score eliminations exactly like human players. They appear on the live scoreboard and above their tanks with an **AI** tag.

Start the stack with `docker compose up` and open <http://localhost:8080>. Log in, select **Enter arena**, and three bots (Bot Viper, Bot Rook, Bot Atlas) are already in the match. Set `BOT_COUNT` (0–8, default 3; `0` disables bots) and `BOT_SEARCH_ITERATIONS` (20–2000, default 200) in `.env` to change them.

### The algorithm

Five times per second, each bot runs a fresh search (`backend/src/ai/mcts.js`):

1. **Simplified game state.** The bot's tank, its target (the nearest living tank, preferring humans and avoiding targets other bots are already chasing), and every projectile within 650 px. Each tank carries position, heading, armor, and remaining fire cooldown.
2. **Actions.** The 18 combinations of throttle (forward / none / reverse) × turn (left / none / right) × fire, which are exactly the controls a human can send. Each tree edge holds that action for 0.3 s, and the tree plans 4 actions (1.2 s) ahead.
3. **Forward model.** A small simulator that uses the real game constants (speeds, turn rate, projectile speed, damage, cooldown, hit radius) to predict movement, shots, and hits in 0.1 s substeps. The target is modeled as fighting back: it keeps its current throttle, turns toward the bot, and fires when lined up.
4. **Search.** Each iteration does *selection* (UCB1: mean value + exploration bonus), *expansion* of one untried action, a *rollout* to the horizon with a mostly aim-and-fire policy, and *backpropagation* of the discounted return. The reward is damage dealt minus 1.25× damage taken, with bonuses or penalties for kills and deaths. A heuristic at the horizon rewards facing the target, staying near a 320 px firing range, and keeping away from walls.
5. **Decision.** The most-visited root action becomes the bot's input for the next 200 ms.

The search can line up shots and also step out of the path of incoming shells, which scripted chasing would not do. A decision with the default 200 iterations takes a few milliseconds, well inside one 33 ms game tick, and bots start on staggered schedules so their searches are spread across ticks.

### How it connects to Objective 3

- Bots are ordinary tanks in the same authoritative `GameEngine`. `BotController.update()` runs at the start of every tick of the Socket.IO game loop and writes each bot's input the same way a human's `player:input` message does. After that, `engine.step()` applies the same movement, collision, damage, respawn, and scoring rules to everyone.
- Bot tanks are included in the same `game:state` WebSocket broadcasts (with `bot: true`), so every connected browser sees them move and fire in real time.
- Bots only act while at least one human is in the arena. With no humans connected they sit idle and use no CPU on searching.

### Security (Objective 2 and 3 rules are unchanged)

- Bots are created only by server code. They have no socket, no HTTP route, and no WebSocket event, so the feature adds no way for an unauthenticated user to act. Handshakes still require a valid RS256 JWT and an allowed origin.
- The engine never lets a socket control, replace, or remove a bot: client inputs are matched by socket ID, and bots have none. Bot IDs (`bot-N`) cannot match a real account ID (numeric database IDs from the JWT `sub`). Even a validly signed token claiming a bot ID is refused.
- Bot names contain a space, which the auth server never allows in usernames, so a bot cannot impersonate a player and a player cannot impersonate a bot.
- Bots do not use human connection slots, and their projectiles count toward the existing 96-projectile cap.

### Tests

`cd backend && npm test` runs the Objective 4 tests along with every earlier test:

- `test/botAI.test.js` covers search decisions: it fires when lined up, turns toward an off-axis target, and dodges a shell that would hit if it stood still. It also checks that visit counts add up to the iteration budget, that results are reproducible with a seed, the time per decision, and config clamping.
- `test/bots.test.js` covers game-loop integration: bots appear on the scoreboard without using human slots, socket APIs cannot touch bots, bots idle without humans, a bot hunts down and eliminates a human, and a human eliminates a bot that then respawns. Over a real Socket.IO server it checks that bots are broadcast, move, and shoot live, that anonymous handshakes are still rejected, and that a token claiming a bot ID cannot take it over.

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



