# HR Booking — Server

Backend API for the HR consultation booking platform. Built with Node.js, Express, TypeScript, MongoDB (Mongoose), Redis, and BullMQ.

## Status

Phases 1–4 are complete:

- **Foundation** — health checks (`/health`, `/health/ready`), centralized error handling,
  consistent response format, Zod-validated env, Pino logging with secret redaction, request IDs,
  Helmet/CORS/rate limiting, Docker + docker-compose, GitHub Actions CI
- **Authentication** — argon2id passwords, access/refresh JWT cookies with rotation and
  revocation, email verification, password reset, login lockout, RBAC
- **HR profiles** — profile onboarding (auto-upgrades `USER` → `HR`), publish workflow, public
  directory with search/filters/sort/pagination
- **Availability & bookings** — per-consultant working hours in an IANA timezone, DST-correct slot
  generation, booking creation with race-proof double-booking protection, cancellation and
  rescheduling
- **Meeting integration** — Google OAuth with encrypted token storage, automatic Google Meet
  links via Google Calendar, and a provider abstraction so other conferencing tools can be added

## Tech Stack

- Node.js 22+ / TypeScript (strict)
- Express 5
- MongoDB + Mongoose
- Redis + ioredis (BullMQ in later phases)
- Pino + pino-http
- Zod
- Luxon (IANA timezone handling)
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

| Script              | Description                      |
| ------------------- | -------------------------------- |
| `npm run dev`       | Start dev server with hot reload |
| `npm run build`     | Compile TypeScript to `dist/`    |
| `npm start`         | Run the compiled server          |
| `npm run lint`      | ESLint                           |
| `npm run typecheck` | TypeScript strict type check     |
| `npm run format`    | Prettier write                   |
| `npm test`          | Run Vitest suite                 |

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

## API

All routes are versioned under `/api/v1`.

### Auth (`/auth`)

| Method | Path               | Auth           | Notes                                             |
| ------ | ------------------ | -------------- | ------------------------------------------------- |
| POST   | `/register`        | —              | 201, sends a verification email                   |
| POST   | `/login`           | —              | sets httpOnly access + refresh cookies            |
| POST   | `/refresh`         | refresh cookie | rotates and revokes the previous token            |
| POST   | `/logout`          | —              | clears cookies, deletes the refresh record        |
| POST   | `/verify-email`    | —              | `{ token }`                                       |
| POST   | `/forgot-password` | —              | always the same generic response                  |
| POST   | `/reset-password`  | —              | `{ token, password }`, revokes all refresh tokens |
| GET    | `/me`              | access token   | current user                                      |

### HR profiles (`/profiles`)

| Method | Path               | Auth     | Notes                                                  |
| ------ | ------------------ | -------- | ------------------------------------------------------ |
| PUT    | `/me`              | any user | onboarding; upgrades `USER` → `HR`                     |
| GET    | `/me`              | `HR`     | own profile                                            |
| PATCH  | `/me/publish`      | `HR`     | `DRAFT` ⇄ `PUBLISHED`                                  |
| PATCH  | `/me/availability` | `HR`     | accepting-bookings switch                              |
| GET    | `/`                | —        | published directory: search, filters, sort, pagination |
| GET    | `/:id`             | —        | published profile                                      |

### Availability (`/availability`)

| Method | Path                | Auth | Notes                                                                       |
| ------ | ------------------- | ---- | --------------------------------------------------------------------------- |
| GET    | `/me`               | `HR` | own schedule (created empty on first read)                                  |
| PUT    | `/me`               | `HR` | timezone, slot length, buffer, notice, horizon, weekly hours, blocked dates |
| GET    | `/:profileId/slots` | —    | bookable slots; `from`/`to` ISO, ≤31 days, defaults to 14 days              |

### Bookings (`/bookings`)

| Method | Path                 | Auth          | Notes                                                             |
| ------ | -------------------- | ------------- | ----------------------------------------------------------------- |
| POST   | `/`                  | authenticated | `{ profileId, startAt, timezone?, notes?, meetingProvider? }`     |
| GET    | `/`                  | authenticated | `role=user\|hr`, `scope=upcoming\|past\|all`, `status`, paginated |
| GET    | `/:id`               | participant   | non-participants get 404                                          |
| PATCH  | `/:id/cancel`        | participant   | optional `reason`; clients need 60 minutes' notice                |
| PATCH  | `/:id/reschedule`    | participant   | `{ startAt, timezone? }`, max 3 times                             |
| POST   | `/:id/meeting/retry` | participant   | re-attempts the conference after a provider failure               |

### Integrations (`/integrations`)

| Method | Path               | Auth | Notes                                                     |
| ------ | ------------------ | ---- | --------------------------------------------------------- |
| GET    | `/`                | `HR` | Google connection status; never returns tokens            |
| GET    | `/google/connect`  | `HR` | `{ url }` for the consent screen; 503 when unconfigured   |
| GET    | `/google/callback` | —    | Google redirects here; always redirects back into the SPA |
| DELETE | `/google`          | `HR` | revokes at Google (best effort) and forgets locally       |

## Google Meet setup

Google Meet links are created automatically once a consultant connects their calendar. Without
credentials the platform still works — bookings are confirmed, they just carry no meeting link,
and either participant can retry once a calendar is connected.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and **enable
   the Google Calendar API**.
2. Configure the OAuth consent screen (External is fine for testing; add yourself as a test user).
3. Create an **OAuth client ID → Web application** and add the redirect URI:
   `http://localhost:5000/api/v1/integrations/google/callback`
4. Put the id/secret in `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, and set a strong
   `OAUTH_ENCRYPTION_KEY` (it encrypts stored refresh tokens — changing it later forces every
   consultant to reconnect).
5. Restart the server, then visit `/profile/integrations` as an HR account and click **Connect
   Google Calendar**.

The scope requested is `calendar.events` only. The application never sees a Google password, and
tokens are stored AES-256-GCM encrypted and never returned by any endpoint.

## API Response Format

Success:

```json
{ "success": true, "data": {} }
```

Paginated:

```json
{
  "success": true,
  "data": [],
  "pagination": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 }
}
```

Error:

```json
{ "success": false, "error": { "code": "NOT_FOUND", "message": "Resource not found." } }
```

Domain-specific codes: `SLOT_ALREADY_BOOKED` (409) when a slot is taken or not offered, and
`INTEGRATION_UNAVAILABLE` (503) when a third-party integration is not configured or reachable.

## Scheduling model

- Instants are stored and returned in **UTC**; working hours are wall-clock `HH:mm` values
  interpreted in the consultant's IANA timezone via Luxon, so DST is handled by the zone database.
- Slots are generated from working hours minus buffer, minimum notice, booking horizon, blocked
  dates and existing bookings. The same rule is re-checked server-side on every write.
- Double booking is prevented by a unique sparse `slotKey` index plus a post-insert overlap sweep,
  so no replica set / transaction support is required.

## Testing

```bash
npm test
```

113 tests: health, auth, HR profiles, pure slot generation (timezones and DST), availability,
bookings (including a concurrent double-booking race), token encryption, Google integration
endpoints, and the meeting lifecycle. API suites boot the Express app via Supertest and hit live
MongoDB/Redis when available; Google is stubbed at the `fetch` boundary, so no test makes a
network call.

## License

Private.
