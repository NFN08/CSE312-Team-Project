## Live Deployment

The application is publicly available at:

https://tankbattle312.duckdns.org

The production deployment runs on an Ubuntu server using Docker Compose,
nginx, Node.js/Express, React, and PostgreSQL.

HTTPS is provided through Let's Encrypt, with HTTP requests redirected to HTTPS.

# Tank Battle Arena

Objective 1 local application foundation for the University at Buffalo CSE 312 team project. The current build contains a responsive React landing page, an Express health API, nginx routing, and PostgreSQL infrastructure. Gameplay, authentication, WebSockets, bots, and public deployment are intentionally out of scope.

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
  nginx  ── static files ── React/Vite production build
    |
    └── /api/* ── Express :3000
                       |
                 PostgreSQL :5432 (internal network only)
```

The services are isolated in separate containers. Only nginx publishes a host port. PostgreSQL data is stored in the `postgres_data` named volume, and port 5432 is not published to the host.

The source layout leaves clear extension points:

- `frontend/src/` — React UI; a future Phaser game can live under `frontend/src/game/`.
- `backend/src/` — HTTP API; future Socket.IO modules can live under `backend/src/realtime/`.
- `backend/src/config/database.js` — reserved database pool factory for later persistence work.
- A future authentication service can be added as its own top-level directory and Compose service without coupling it to the game server.

## Prerequisites (Windows)

- Docker Desktop with Docker Compose v2
- Windows PowerShell

No host installation of Node.js or PostgreSQL is required for the container workflow.

## Configure the local environment

From PowerShell in the repository root:

```powershell
Copy-Item .env.example .env
```

Open `.env` and replace `change-this-local-password` with a local password. The `.env` file is ignored by Git and must not be committed.

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

This keeps the PostgreSQL named volume. To also delete local database data, explicitly run `docker compose down --volumes`; that deletion is irreversible for data stored only in the volume.

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



