# HR Booking — Server

Backend API for the HR consultation booking platform. Built with Node.js, Express, TypeScript, MongoDB (Mongoose), Redis, and BullMQ.

## Status

Phase 1 (Foundation) — Express + TypeScript scaffold with:
- Health checks (`/health`, `/health/ready`)
- Centralized error handling + consistent API response format
- Zod-validated environment configuration
- Pino structured logging (with secret redaction)
- Request IDs, Helmet, CORS, rate-limit-ready middleware stack
- Vitest + Supertest integration tests
- Docker + docker-compose (MongoDB, Redis, Mailpit, backend, frontend)
- GitHub Actions CI

## Tech Stack

- Node.js 22+ / TypeScript (strict)
- Express 5
- MongoDB + Mongoose
- Redis + ioredis (BullMQ in later phases)
- Pino + pino-http
- Zod
- Vitest + Supertest

## Project Structure

```
server/
├── src/
│   ├── config/        # Env, logger, database, redis
│   ├── controllers/   # HTTP layer
│   ├── middlewares/   # Auth, error handling, validation
│   ├── models/        # Mongoose models
│   ├── modules/       # Feature modules (later phases)
│   ├── routes/        # Express routers
│   ├── services/      # Business logic
│   ├── jobs/          # Scheduled jobs (later phases)
│   ├── queues/        # BullMQ queues (later phases)
│   ├── integrations/  # Google/Zoom/email/payment adapters (later phases)
│   ├── validators/    # Zod schemas (later phases)
│   ├── utils/         # Shared helpers
│   ├── types/         # Type declarations
│   ├── app.ts         # Express app factory
│   └── server.ts      # Bootstrap + graceful shutdown
├── tests/             # Integration tests
├── docker-compose.yml
├── Dockerfile
└── .env.example
```

## Prerequisites

- Node.js 22+
- npm (configured for this drive)
- MongoDB 8.x running on `mongodb://127.0.0.1:27017`
- Redis 7+ running on `redis://127.0.0.1:6379`
- Docker (optional, for compose-based dev)

## Installation

```bash
npm install
cp .env.example .env   # adjust values as needed
```

## Development

```bash
npm run dev            # tsx watch, restarts on change
```

The API listens on `http://localhost:5000` by default.

## Scripts

| Script            | Description                          |
| ----------------- | ------------------------------------ |
| `npm run dev`     | Start dev server with hot reload     |
| `npm run build`   | Compile TypeScript to `dist/`        |
| `npm start`       | Run the compiled server              |
| `npm run lint`    | ESLint                               |
| `npm run typecheck` | TypeScript strict type check       |
| `npm run format`  | Prettier write                       |
| `npm test`        | Run Vitest suite                     |

## Health Checks

- `GET /health` — liveness (200 when the process is up)
- `GET /health/ready` — readiness (200 when MongoDB and Redis are reachable, otherwise 503)

## Docker

Start the full local stack (frontend + backend + MongoDB + Redis + Mailpit):

```bash
# from this repo, with the client repo cloned as a sibling directory
docker compose up --build
```

- Frontend: http://localhost:8080
- API: http://localhost:5000
- Mailpit UI: http://localhost:8025

## API Response Format

Success:

```json
{ "success": true, "data": {} }
```

Error:

```json
{ "success": false, "error": { "code": "NOT_FOUND", "message": "Resource not found." } }
```

## Testing

```bash
npm test
```

Integration tests boot the Express app via Supertest and hit live MongoDB/Redis when available.

## License

Private.
