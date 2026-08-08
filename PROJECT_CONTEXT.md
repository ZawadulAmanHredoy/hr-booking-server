# Project Context — HR Booking

> Living document. Keep it in sync with the actual code. Last reviewed: 2026-08-08.

## What this project is

An HR consultation booking platform. Clients discover HR consultants, check their real-time
availability, and book paid consultations over Google Meet or Zoom. Meeting links and receipts are
delivered automatically by email.

Current status: **Phase 4 (Availability & bookings) is complete** on both client and server. See
[`PROGRESS.md`](./PROGRESS.md) for the phase roadmap.

## Repositories

The workspace `D:\HR Booking` is **not** a git repo. It contains two independent repos that are
deployed together:

| Repo                   | Remote                                                   | Purpose                                  |
| ---------------------- | -------------------------------------------------------- | ---------------------------------------- |
| `D:\HR Booking\server` | `git@github.com:ZawadulAmanHredoy/hr-booking-server.git` | Node/Express API, DB, jobs, integrations |
| `D:\HR Booking\client` | `git@github.com:ZawadulAmanHredoy/hr-booking-client.git` | React SPA                                |

Both are public, `main` branch only, CI passing. Pushed via SSH (see constraints below).

## Tech stack (as implemented)

### Server

- Node.js 22+, TypeScript 6 (strict), **ESM** (`"type": "module"`, NodeNext, `.js` import extensions)
- Express 5, Mongoose 9 (MongoDB), ioredis 6 (Redis)
- Zod 4 (env config + request validation), Pino + pino-http (structured logging), Luxon (timezones)
- @node-rs/argon2 (password hashing), jsonwebtoken (JWT), cookie-parser, nodemailer
- express-rate-limit, helmet, compression, cors
- Vitest 4 + Supertest (integration tests)

### Client

- React 19, TypeScript 6 (strict), Vite 8
- React Router 7 (data router), TanStack Query 5, Zustand 5, Axios
- Tailwind CSS 4 (CSS-first `@theme`) + shadcn-style UI primitives
- lucide-react icons, clsx + tailwind-merge + cva (`cn` helper)

## Environment constraints (Windows machine)

- Windows, Node v22.17.1, npm 10.9.2, 8 GB RAM, only ~2.8 GB free on C:
- **Nothing installs to C:.** npm prefix/cache redirected via `~/.npmrc` to `D:\npm-global` /
  `D:\npm-cache`. Projects live on D:.
- Portable infrastructure (all on D:, not system services):
  - MongoDB 8.3.7 on port **27017** (`D:\mongodb\...`, cache capped at 1 GB via mongod.conf;
    helpers `start-mongod.bat` / `stop-mongod.bat`)
  - mongosh 2.9.2 (`D:\mongodb\mongosh-2.9.2-win32-x64\bin\mongosh.exe`)
  - Redis 8.8.0 on port **6379**
  - gh CLI 2.97.0 (`D:\gh\bin\gh.exe`, **not authenticated** — git uses SSH, gh is unused)
- Git: global `core.sshCommand = ssh -i /d/ssh/id_ed25519 -o IdentitiesOnly=yes`. SSH key lives on
  D: (`D:\ssh\id_ed25519`), verified GitHub account `ZawadulAmanHredoy`.
- **Security note:** a GitHub PAT was pasted in chat earlier (scope `repo, workflow`). It should be
  revoked in GitHub settings; SSH is the only push method and needs no PAT.

## Conventions

- Strict TypeScript everywhere: `strict`, `noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`. Type-only imports use `import type`.
- Prettier (single quotes, no semicolons, trailing commas, width 100) + ESLint. Run
  `npm run lint`, `npm run typecheck`, `npm run format:check` before pushing.
- Server is ESM/NodeNext: relative imports must include `.js` (e.g. `./config/env.js`).
- Client uses the `@/` alias → `client/src`; no relative imports across feature boundaries.
- Server layering: `routes → controllers → services → models`, with Zod validators and `AppError`
  subclasses in `middlewares`/`utils`. Controllers use `try/catch { next(err) }` (see
  `auth.controller.ts`); the `asyncHandler` util exists but is currently unused.
- Single global npm cache/prefix means both repos share one `node_modules` cache; never install
  anything outside a project dir, never touch C:.
- No comments in code unless required; docs live in markdown.

## API conventions

- Base: `/api/v1`. Success: `{ "success": true, "data": ... }`. Error:
  `{ "success": false, "error": { "code", "message", "details? } }`.
- Error codes: `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`,
  `SLOT_ALREADY_BOOKED`, `VALIDATION_ERROR`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`,
  `INTERNAL_SERVER_ERROR`.
- JSON body limit 100 KB. Every response carries `X-Request-Id`.
- Auth uses **HTTP-only cookies** (`hrb_access_token`, `hrb_refresh_token`), not localStorage.
  `secure` only in production, `SameSite=Lax`.
- Health: `GET /health` (liveness), `GET /health/ready` (Mongo + Redis checks).
- Rate limits: global 120 req/min; auth routes 10 req/15 min. Both disabled under `NODE_ENV=test`.

## Auth design (implemented)

- Passwords: **Argon2id** (`m=19456 KiB, t=2, p=1`).
- Access JWT: 15 min, signed with `JWT_ACCESS_SECRET`. Refresh: opaque 48-byte token stored
  **SHA-256 hashed** in MongoDB, 7-day TTL (with a real TTL index).
- Refresh **rotation + revocation**: each refresh revokes the previous token and records
  `replacedByTokenHash`. Password reset revokes all of a user's refresh tokens.
- Login lockout: 5 failed attempts → 15-min lock (`lockedUntil`).
- Email verification required before login; a resend happens automatically on a blocked login.
- No user enumeration: unknown-email login simulates a delay; forgot-password always returns the
  same generic message.
- Verify-email / reset-password links are JWTs (`type` claim checked) signed with
  `JWT_REFRESH_SECRET`; verify-email 24 h, reset-password 1 h.
- RBAC roles: `USER`, `HR`, `ADMIN`, `SUPER_ADMIN`. `requireRole` middleware exists but no route
  uses it yet.

## Scheduling design (implemented)

- Every instant is stored and transported in **UTC**. Working hours are wall-clock strings
  (`HH:mm`) interpreted in the consultant's IANA `timezone`; conversion runs through **Luxon**, so
  DST transitions are handled by the zone database rather than by offset arithmetic.
- Slot generation is a pure function (`slot.service.ts`) driven by slot duration, buffer, minimum
  notice, booking horizon, blocked dates and existing bookings. The API only ever returns slots a
  client may actually book, and every write re-checks the same rule server-side (`isOfferedSlot`).
- Double booking is impossible by construction: an active booking carries
  `slotKey = ${hrUserId}:${startAt}` under a **unique sparse index**, cancelling `$unset`s it, and a
  post-insert overlap sweep resolves partial overlaps (the later `_id` withdraws). No multi-document
  transactions — the dev MongoDB is standalone.
- Booking statuses: `PENDING`, `CONFIRMED` (both hold a slot), `CANCELLED`, `COMPLETED`, `NO_SHOW`.
  Bookings are created `CONFIRMED` today; payments (Phase 7) will introduce `PENDING`.
- The consultation fee is the profile's hourly rate prorated to the slot length, snapshotted onto
  the booking.

## Email

- `EmailTransport` interface with two implementations: `ConsoleTransport` (dev default,
  `EMAIL_TRANSPORT=console`) and `SmtpTransport` (nodemailer; Mailpit in compose, SMTP 1025 /
  UI 8025). `sendEmail` swallows failures and logs them so auth never breaks on mail.
- Templates: verify-email, reset-password (HTML, escaped).

## How to run (dev)

Prereqs: MongoDB on 27017, Redis on 6379 (both running locally).

```bash
# Terminal 1 — server (D:\HR Booking\server)
npm run dev          # http://localhost:5000

# Terminal 2 — client (D:\HR Booking\client)
npm run dev          # http://localhost:5173, proxies /api and /health → :5000
```

Optional: `npm run seed` creates the SUPER_ADMIN from `SUPER_ADMIN_EMAIL`/`SUPER_ADMIN_PASSWORD`
(only if it doesn't exist). Full-stack compose: `docker compose up --build` from `server/` (client
must be a sibling dir; frontend at http://localhost:8080).

## Related documents

- `PROGRESS.md` — what's done vs. planned per phase, verification status, known notes
- `docs/architecture.md` — code-level architecture: request lifecycle, auth flow, data models,
  client state flow, deployment
