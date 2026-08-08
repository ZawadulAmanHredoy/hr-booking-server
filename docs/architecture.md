# Architecture — HR Booking

> Code-level architecture written from the actual implementation (Phases 1–5).
> Last updated: 2026-08-08.

## 1. System overview

```
┌──────────────────────┐      ┌──────────────────────┐
│  React SPA (client)  │      │  Express API (server)│
│  Vite / nginx :8080  │      │  Node 22 :5000       │
└──────────┬───────────┘      └──────────┬───────────┘
           │ /api, /health (proxy)       │
           │                             │
           │                  ┌──────────┴──────────────────────────────────┐
           │                  │ MongoDB (users, tokens, profiles,           │
           │                  │   availability, bookings, meetings, oauth)  │
           │                  │ Redis (future queues)                       │
           │                  │ SMTP (Mailpit dev)                          │
           │                  │ Google OAuth + Calendar API (Meet links)    │
           └──────────────────┴─────────────────────────────────────────────┘
```

- Dev: Vite dev server (5173) proxies `/api` and `/health` → `http://localhost:5000`.
- Prod (docker-compose): nginx serves the SPA and proxies `/api/` + `/health` to
  `backend:5000`. Compose also runs mongodb, redis, mailpit.

---

## 2. Server (`server/`)

### 2.1 Layering and request lifecycle

```
middlewares → routes → controllers → services → models
                   └→ validators (Zod) → utils
```

Order of middleware in `createApp()` (`src/app.ts`):

1. `requestId` — set `req.id` + `X-Request-Id` (echoes inbound header or UUID)
2. `pinoHttp` — request logging; log level by status (err/≥500 → error, ≥400 → warn, else info)
3. `helmet` — security headers
4. `compression` — gzip
5. `cors` — single `CLIENT_URL` origin, credentials allowed
6. `express.json` / `urlencoded` — 100 KB limit
7. `cookieParser`
8. `apiRateLimiter()` — 120 req/min (no-op under test)
9. `/` routes → `routes/index.ts`: `/health` + `/api/v1`
10. `notFoundHandler` → 404 `NOT_FOUND`
11. `errorHandler` — the only place errors become responses

`server.ts` is the bootstrap: connects MongoDB (required), attempts Redis (optional, warn only),
listens, and handles SIGTERM/SIGINT with a 10 s force-exit timer.

### 2.2 Error handling

All domain errors extend `AppError` (`src/utils/http-errors.ts`): `BadRequestError`,
`UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `ValidationError`.

`errorHandler` ordering (`src/middlewares/error-handler.ts`):

1. `AppError` → its `statusCode`/`code`/`message`/`details`
2. `ZodError` → 400 `VALIDATION_ERROR` with `err.flatten()`
3. body-parser `entity.too.large` → 413 `PAYLOAD_TOO_LARGE`
4. anything else → logged, 500 `INTERNAL_SERVER_ERROR`; real message only in non-production

### 2.3 Configuration (`src/config/`)

- `env.ts` — one Zod schema over `process.env`, defaults for dev. In **production**, access and
  refresh secrets must be ≥32 chars and not start with `dev-`. Exports `env`, `isProduction`,
  `isTest`.
- `logger.ts` — pino; pretty transport in development; redaction paths: `req.headers.authorization`,
  `req.headers.cookie`, `password`, `accessToken`, `refreshToken`, `secret`.
- `database.ts` — Mongoose connect/disconnect (serverSelectionTimeoutMS 5000), URI redacted in logs.
- `redis.ts` — ioredis singleton (lazy connect, ready check), `pingRedis`, disconnect.
- `constants.ts` — `USER_ROLES` (USER/HR/ADMIN/SUPER_ADMIN), `USER_STATUS` (ACTIVE/SUSPENDED),
  `AUTH_COOKIES` (`hrb_access_token`/`hrb_refresh_token`), `TOKEN_TYPES`
  (access/refresh/verify-email/reset-password), `AUTH_LIMITS` (5 attempts, 15-min lock, password
  8–128).

### 2.4 Data models (`src/models/`)

**User**

| field                             | notes                           |
| --------------------------------- | ------------------------------- |
| email                             | unique, lowercase, indexed      |
| password                          | argon2id hash, `select: false`  |
| firstName / lastName              | trimmed, ≤50                    |
| role                              | enum, default `USER`, indexed   |
| status                            | enum, default `ACTIVE`, indexed |
| isEmailVerified / emailVerifiedAt |                                 |
| phone, profileImageUrl            | optional                        |
| failedLoginAttempts / lockedUntil | lockout state                   |

**RefreshToken**

| field                           | notes                                                              |
| ------------------------------- | ------------------------------------------------------------------ |
| userId                          | ref User, indexed                                                  |
| tokenHash                       | sha-256 of the raw token, unique                                   |
| expiresAt                       | indexed + **TTL index** (`expireAfterSeconds: 0`) for auto-cleanup |
| revokedAt / replacedByTokenHash | rotation chain                                                     |
| userAgent / ip                  | device context                                                     |

**HRProfile**

| field                                       | notes                                            |
| ------------------------------------------- | ------------------------------------------------ |
| userId                                      | ref User, unique                                 |
| headline / bio                              | ≤80 / ≤2000 chars                                |
| specializations                             | enum array, 1–5                                  |
| yearsOfExperience                           | 0–70                                             |
| hourlyRateCents / currency                  | pricing basis for bookings                       |
| languages / city / country / certifications | profile detail                                   |
| status                                      | `DRAFT` \| `PUBLISHED`, only PUBLISHED is public |
| isAvailable                                 | consultant accepts new bookings                  |
| rating / ratingCount                        | populated in a later phase                       |

Indexes: `specializations`, `status+rating`, `status+hourlyRateCents`.

**Availability**

| field                             | notes                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| hrUserId                          | ref User, unique                                                                        |
| timezone                          | IANA zone the working hours are written in                                              |
| slotDurationMinutes               | 15 / 30 / 45 / 60 / 90                                                                  |
| bufferMinutes                     | gap appended after each slot                                                            |
| minNoticeMinutes / maxAdvanceDays | booking window                                                                          |
| weeklyHours                       | `[{ weekday 0–6, intervals: [{ start: 'HH:mm', end: 'HH:mm' }] }]`                      |
| blockedDates                      | `[{ date: 'YYYY-MM-DD', startTime?, endTime?, reason? }]` — full day when times omitted |

An empty `weeklyHours` means nothing is bookable; the record is created empty on first read.

**Booking**

| field                                          | notes                                                       |
| ---------------------------------------------- | ----------------------------------------------------------- |
| userId / hrUserId / hrProfileId                | participants and the profile booked                         |
| startAt / endAt                                | **UTC** instants                                            |
| durationMinutes                                | snapshot of the slot length                                 |
| hrTimezone / userTimezone                      | display zones captured at booking time                      |
| status                                         | `PENDING`, `CONFIRMED`, `CANCELLED`, `COMPLETED`, `NO_SHOW` |
| priceCents / currency                          | hourly rate prorated to the slot                            |
| meetingProvider                                | `GOOGLE_MEET` \| `ZOOM` (link created in Phase 5)           |
| notes                                          | client's agenda, ≤1000 chars                                |
| slotKey                                        | `${hrUserId}:${startAt}` — **present only while active**    |
| cancelledAt / cancelledBy / cancellationReason | cancellation record                                         |
| previousStartAt / rescheduleCount              | reschedule history                                          |

Indexes: **unique sparse** `slotKey`, `userId+startAt`, `hrUserId+startAt`,
`hrUserId+status+startAt`, `status+startAt`.

**OAuthAccount**

| field                              | notes                                                         |
| ---------------------------------- | ------------------------------------------------------------- |
| userId + provider                  | unique together — reconnecting overwrites                     |
| providerAccountId / accountEmail   | who the consultant authorised as                              |
| refreshToken                       | **AES-256-GCM ciphertext**, `select: false`                   |
| accessToken / accessTokenExpiresAt | short-lived, also encrypted, refreshed on demand              |
| scopes / calendarId                | granted scopes; target calendar (default `primary`)           |
| lastError                          | set when Google refuses the credentials → prompt to reconnect |

**Meeting**

| field                                  | notes                                                   |
| -------------------------------------- | ------------------------------------------------------- |
| bookingId                              | ref Booking, unique — one conference per booking        |
| provider / status                      | `GOOGLE_MEET`; `PENDING`/`CREATED`/`FAILED`/`CANCELLED` |
| externalMeetingId / externalCalendarId | Google Calendar event and calendar                      |
| meetingUrl                             | the Meet join link                                      |
| startTime / endTime                    | mirrored from the booking                               |
| lastError / attempts                   | why the last attempt failed, and how many there were    |

Index: `status+startTime`.

### 2.5 Auth flow (`src/services/auth.service.ts` + middleware)

Tokens:

- Access: JWT 15 min, `{ sub, role, type: 'access' }`, signed `JWT_ACCESS_SECRET`.
- Verify-email: JWT 24 h, `{ sub, type: 'verify-email' }`.
- Reset-password: JWT 1 h, `{ sub, type: 'reset-password' }`.
- Refresh: opaque `randomBytes(48)` base64url, **not a JWT**, stored hashed.

Both generic JWTs are signed with `JWT_REFRESH_SECRET` (fallback in `getSecret` in
`src/utils/tokens.ts`) and `verifyGenericToken` rejects a `type` mismatch. This is a deliberate
simplification — there are no dedicated verify/reset secrets.

**register** → hash password (argon2id m=19456 KiB, t=2, p=1) → create `USER` → send verify email
→ 201. Duplicate email → 409 `EMAIL_ALREADY_REGISTERED`.

**login** → find by email:

- unknown email → simulate 150 ms delay (timing anti-enumeration) → 401
- suspended → 403 `ACCOUNT_SUSPENDED`
- locked (`lockedUntil` future) → 401 `ACCOUNT_LOCKED`
- wrong password → increment attempts; at 5, set `lockedUntil` = now + 15 min → 401
- unverified → resend verify email → 401 `EMAIL_NOT_VERIFIED`
- success → reset attempts → `issueTokens`

**issueTokens** → sign access JWT, generate + hash refresh token, persist, optionally revoke the
`previous` token (rotation). Cookies set by the controller via `setAuthCookies` (httpOnly,
`secure` in prod, SameSite=Lax, `path=/`).

**refresh** → hash incoming token → find record → reject if revoked/missing → TTL check → re-fetch
user (must be ACTIVE) → rotate.

**logout** → delete the refresh token record (if any) → clear cookies.

**verify-email** → verify JWT (type-checked) → set `isEmailVerified` + `emailVerifiedAt`.

**forgot-password** → always 200 generic message; send only if the account exists (no
enumeration).

**reset-password** → verify JWT → rehash password → **delete all the user's refresh tokens** → 200.

**GET /auth/me** → `authenticate` (decodes cookie or Bearer access JWT into `req.user`) +
`loadUser` (re-loads from DB, rejects non-ACTIVE) → returns `toPublicUser` (never includes
password).

**RBAC** — `requireRole(...roles)` returns 403 for the wrong role; `loadUser` must run after
`authenticate`. No route uses it yet.

### 2.6 HR profiles (`src/services/hr-profile.service.ts`)

Routes at `/api/v1/profiles`:

| Route                    | Auth                   | Notes                                                                           |
| ------------------------ | ---------------------- | ------------------------------------------------------------------------------- |
| `PUT /me`                | any authenticated user | onboarding — creates the profile and upgrades `USER` → `HR`                     |
| `GET /me`                | `HR`                   | own profile including `status`                                                  |
| `PATCH /me/publish`      | `HR`                   | DRAFT ⇄ PUBLISHED                                                               |
| `PATCH /me/availability` | `HR`                   | the coarse "accepting bookings" switch                                          |
| `GET /`                  | public                 | PUBLISHED only; search, specialization/language/price filters, sort, pagination |
| `GET /:id`               | public                 | PUBLISHED only                                                                  |

### 2.7 Scheduling and bookings

**Timezones.** Instants are stored and transported in UTC. Working hours are wall-clock `HH:mm`
strings interpreted in the consultant's IANA `timezone`; `src/utils/datetime.ts` wraps **Luxon**
(`wallTimeToUtc`, `dateKeysBetween`, `weekdayOfDateKey`, `isValidTimezone`) so no code ever
computes an offset by hand.

**Slot generation** (`src/services/slot.service.ts`) is a pure function:

```
generateSlots(config, { rangeStart, rangeEnd, now, busy })
  earliest = max(rangeStart, now + minNotice)
  latest   = min(rangeEnd,   now + maxAdvanceDays)
  for each calendar day in the consultant's zone
    for each working interval
      step = slotDuration + buffer
      drop slots that overrun the interval, fall on a blocked date/range,
      land outside [earliest, latest), or overlap an active booking
  dedupe by instant (spring-forward gaps can map two wall times to one instant), sort
```

`getAvailableSlots` subtracts the consultant's active bookings; `isOfferedSlot` reuses the same
generator as the server-side gate for every create/reschedule, so a hand-crafted request cannot
book a time the consultant never published.

**Booking creation** (`src/services/booking.service.ts`) checks, in order: profile is PUBLISHED →
consultant is accepting → not booking yourself → the slot is offered → the client has no
overlapping booking → the consultant has no overlapping booking → insert.

**Double-booking protection** — the dev MongoDB runs standalone, so no multi-document
transactions. Three layers instead:

1. the pre-checks above,
2. `slotKey` (`${hrUserId}:${startAt}`) under a **unique sparse index** — a duplicate key becomes
   409 `SLOT_ALREADY_BOOKED`,
3. a post-insert overlap sweep for partial overlaps: if a conflicting active booking exists with a
   lower `_id`, the newer one deletes itself and reports the conflict.

Cancelling `$unset`s `slotKey`, which frees the slot immediately.

**Cancellation** requires 60 minutes' notice for clients; consultants and admins may cancel until
the consultation starts. **Rescheduling** re-runs the offered-slot and conflict checks, moves
`slotKey` atomically, records `previousStartAt` and increments `rescheduleCount` (max 3).

Routes:

| Route                                       | Auth                   | Notes                                                                     |
| ------------------------------------------- | ---------------------- | ------------------------------------------------------------------------- |
| `GET /api/v1/availability/me`               | `HR`                   | creates an empty schedule on first read                                   |
| `PUT /api/v1/availability/me`               | `HR`                   | full replace, Zod-validated                                               |
| `GET /api/v1/availability/:profileId/slots` | public                 | `from`/`to` (ISO instant or date), ≤31 days, defaults to the next 14 days |
| `POST /api/v1/bookings`                     | authenticated          | 201 with the created booking                                              |
| `GET /api/v1/bookings`                      | authenticated          | `role=user\|hr`, `scope=upcoming\|past\|all`, `status`, paginated         |
| `GET /api/v1/bookings/:id`                  | participant (or admin) | non-participants get 404, not 403                                         |
| `PATCH /api/v1/bookings/:id/cancel`         | participant            | optional `reason`                                                         |
| `PATCH /api/v1/bookings/:id/reschedule`     | participant            | new `startAt`                                                             |

### 2.8 Meeting integration (Google Meet)

**Scope:** Google Meet only. Zoom was descoped by the project owner; the abstraction below is
what keeps that a cheap decision to revisit.

```
Booking service
      ↓
Meeting service            (owns the Meeting document + failure policy)
      ↓
MeetingProviderAdapter     (createMeeting / updateMeeting / cancelMeeting)
      ↓
googleMeetProvider
      ↓
oauth.service (tokens) ─── google-calendar.client (REST)
```

`SUPPORTED_MEETING_PROVIDERS` gates what the API accepts, while `MEETING_PROVIDERS` keeps `ZOOM`
so stored documents and the schema survive the decision either way.

**No SDK.** The integration is four REST calls (token exchange, token refresh, userinfo, calendar
events) made with the built-in `fetch` — a deliberate trade against pulling in the very large
`googleapis` package. Both clients live in `src/integrations/google/`.

**Connect flow**

```
HR clicks Connect
   → GET /integrations/google/connect        (HR-only, returns a URL — not a redirect,
                                              because the browser must navigate itself)
   → accounts.google.com consent             (state = 10-min signed JWT holding the user id)
   → GET /integrations/google/callback       (PUBLIC: identity comes from `state`, not a cookie)
   → exchange code, read identity, encrypt + upsert OAuthAccount
   → 302 to ${CLIENT_URL}/profile/integrations?status=connected
```

Failures redirect with `?status=error&reason=…` (`invalid_state`, `access_denied`,
`missing_refresh_token`, `missing_parameters`, `google_error`) so the SPA can explain itself.

**Token handling.** `getGoogleAccess(userId)` returns a usable access token, refreshing it 60 s
before expiry and re-encrypting it. A refresh rejection writes `lastError` on the account, which
the UI turns into a "reconnect" prompt.

**Meeting lifecycle**

| Booking event | Meeting service           | Google call                                                                                                        |
| ------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| created       | `ensureMeetingForBooking` | `events.insert` with `conferenceData.createRequest` (`hangoutsMeet`), `conferenceDataVersion=1`, `sendUpdates=all` |
| rescheduled   | `syncMeetingTimes`        | `events.patch` with the new times                                                                                  |
| cancelled     | `cancelMeetingForBooking` | `events.delete` (404/410 count as success)                                                                         |
| retried       | `ensureMeetingForBooking` | same insert; `requestId` is `booking-<id>`, so no duplicate conference                                             |

**Failure policy — the important part.** Meeting errors are _recorded, never thrown_. A booking
made while Google is unreachable, or before the consultant connects a calendar, is still
`CONFIRMED`; its meeting is `FAILED` with `lastError`, and the response carries
`canRetryMeeting: true` so either participant can call
`POST /api/v1/bookings/:id/meeting/retry`. Cancellation likewise proceeds even if the calendar
delete fails.

Creation currently runs **inline** in the booking request — safe, but it puts a Google round-trip
on the response. Phase 6 moves it to a BullMQ queue.

Routes:

| Route                                      | Auth        | Notes                                                                                                     |
| ------------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/integrations`                 | `HR`        | connection status; never includes tokens                                                                  |
| `GET /api/v1/integrations/google/connect`  | `HR`        | `{ url }` for the consent screen; 503 `INTEGRATION_UNAVAILABLE` when the server has no client credentials |
| `GET /api/v1/integrations/google/callback` | public      | always redirects back into the SPA                                                                        |
| `DELETE /api/v1/integrations/google`       | `HR`        | best-effort revoke, then forget locally                                                                   |
| `POST /api/v1/bookings/:id/meeting/retry`  | participant | 409 when the meeting does not need creating                                                               |

### 2.9 Email (`src/services/email/`)

- `email.service.ts` — `EmailMessage { to, subject, html, text? }`, `EmailTransport` interface.
- `index.ts` — lazy singleton transport (`console` default, `smtp` if `EMAIL_TRANSPORT=smtp`);
  `sendEmail` wraps delivery in try/catch and only logs failures.
- `transports/console.transport.ts` — logs the message (dev).
- `transports/smtp.transport.ts` — nodemailer; secure on port 465, auth only if credentials set.
- `templates/auth.templates.ts` — verify/reset HTML with `escapeHtml` on the recipient name; links
  point at `${CLIENT_URL}/verify-email?token=…` and `/reset-password?token=…`.

### 2.10 Rate limiting

- `apiRateLimiter()`: global, 120 req / 60 s, applied app-wide in `createApp`.
- `authRateLimiter()`: 10 req / 15 min, applied to the whole `/api/v1/auth` router.
- Both return a no-op middleware when `NODE_ENV=test` so the test suite isn't throttled.

### 2.11 Seed (`src/scripts/seed.ts`)

`npm run seed` → connect DB → if `SUPER_ADMIN_EMAIL`/`SUPER_ADMIN_PASSWORD` set and no such user,
create a verified `SUPER_ADMIN` (argon2-hashed). Otherwise logs and exits.

### 2.12 Tests (`tests/`)

Vitest + Supertest — 83 tests across six files:

| File                   | Count | Covers                                                                      |
| ---------------------- | ----- | --------------------------------------------------------------------------- |
| `health.test.ts`       | 4     | liveness/readiness                                                          |
| `auth.test.ts`         | 16    | register, login, refresh rotation, verify, reset                            |
| `hrProfile.test.ts`    | 16    | onboarding + role upgrade, RBAC, directory filters                          |
| `slots.test.ts`        | 13    | **pure** slot generation — timezones, DST, buffers, blocks, notice, horizon |
| `availability.test.ts` | 14    | availability CRUD validation, public slots endpoint                         |
| `booking.test.ts`      | 20    | booking lifecycle, concurrent double-booking race, cancel, reschedule       |

API suites boot the app with `createApp()` and connect to **live** MongoDB/Redis when reachable
(warn otherwise), use a random per-run email prefix, and clean up only their own documents in
`afterAll`. Auth tests generate verify/reset tokens with `signGenericToken` (the dev
`JWT_REFRESH_SECRET` is used since email is console-only). `vitest.config.ts` sets
`fileParallelism: false` because every suite shares the same database.

---

## 3. Client (`client/`)

### 3.1 Bootstrap

`main.tsx` → `<App />` → `AppProviders` → `<AuthBootstrap>` wraps `RouterProvider`:

- `QueryClient` (TanStack Query): staleTime 30 s, no refetch-on-window-focus, retry 1.
- `AuthBootstrap`: on mount calls `getMe()`; on success `setUser`, on failure `clearSession`;
  renders a spinner until `isInitialized`.

### 3.2 Data flow

- `services/api/client.ts` — Axios instance (`baseURL = VITE_API_URL || '/api'`,
  `withCredentials`). **Response interceptor:** on 401 (and not already retried and not the
  refresh call) it silently posts `/auth/refresh` then retries the original request once; on
  failure (or a failed refresh) it calls the registered `onSessionExpired` handler. The auth store
  registers that handler to `clearSession()`.
- `services/api/auth.ts` — typed wrappers (register/login/logout/getMe/verifyEmail/forgotPassword/
  resetPassword) that normalize errors to `Error` with `cause` via `getApiErrorMessage`.
- `stores/auth.ts` (Zustand) — `user`, `isInitialized`, `setUser`, `clearSession`, `login`,
  `register`, `logout`.

### 3.3 Routing (`app/router.tsx`)

`RootLayout` wraps every route (header/footer/`<Outlet/>`).

| Route                                                        | Guard                 | Notes                                                         |
| ------------------------------------------------------------ | --------------------- | ------------------------------------------------------------- |
| `/`                                                          | —                     | HomePage                                                      |
| `/login`, `/register`, `/forgot-password`, `/reset-password` | `RedirectIfAuthed`    | bounce to `/` when logged in                                  |
| `/verify-email`                                              | —                     | reads `?token`, calls verify-email                            |
| `/hr`                                                        | —                     | consultant directory (search, filters, sort, pagination)      |
| `/hr/:id`                                                    | —                     | profile detail + `BookingPanel` (slot picker, notes, confirm) |
| `/about`                                                     | —                     | placeholder                                                   |
| `/profile`                                                   | `RequireAuth`         | onboarding / edit HR profile                                  |
| `/profile/manage`                                            | `RequireAuth`         | publish + accepting-bookings switches                         |
| `/profile/availability`                                      | `RequireRole(['HR'])` | weekly hours, booking rules, blocked dates                    |
| `/dashboard`                                                 | `RequireAuth`         | next-up bookings + quick links                                |
| `/dashboard/bookings`                                        | `RequireAuth`         | upcoming vs past; consultants can flip perspective            |
| `/dashboard/bookings/:id`                                    | `RequireAuth`         | detail, cancel, reschedule                                    |
| `*`                                                          | —                     | NotFoundPage                                                  |

Guards (`components/auth/guards.tsx`): `RequireAuth` → `<Navigate to="/login" state={{from}}>`;
`RequireRole` → `/dashboard` on the wrong role; `RedirectIfAuthed` → `<Navigate to="/">`. Login
reads `state.from` to return the user.

**Time rendering.** The API always returns UTC instants. `lib/datetime.ts` uses only
`Intl.DateTimeFormat` (no client-side date library) to format and group them in the viewer's own
timezone, which is also sent along on create/reschedule so it can be stored on the booking. The
booking detail page shows the viewer's and the consultant's local time side by side.

### 3.4 UI

Tailwind 4 CSS-first theme in `src/index.css` (`@theme` tokens for the shadcn palette + radii).
Primitives in `src/components/ui/`: `button`, `card`, `input`, `label`, `badge`, `skeleton`
(forwardRef, cva variants). `src/lib/utils.ts` exports `cn` (clsx + tailwind-merge). Shared auth
components: `AuthShell` (centered card), `FormAlert` (error/success), `AuthBootstrap`, `guards`.

### 3.5 Environment & proxy

- `src/lib/env.ts`: `apiUrl = VITE_API_URL` (trailing slash stripped), `apiBase = apiUrl || '/api'`.
- `vite.config.ts` dev proxy: `/api` and `/health` → `http://localhost:5000`.
- Production nginx (`nginx.conf`): SPA fallback (`try_files … /index.html`), `/api/` and `/health`
  proxied to `backend:5000`, `/assets/` cached immutable 1y.

---

## 4. Deployment & CI

### Docker (server)

Multi-stage: `deps` (npm ci) → `build` (tsc) → `runtime` (`npm ci --omit=dev`, copy `dist`,
`USER node`, CMD `node dist/server.js`, EXPOSE 5000).

### Docker (client)

`build` (npm ci + `npm run build`) → `runtime` nginx:1.27-alpine serving `dist` + nginx.conf.

### docker-compose (from `server/`)

`mongodb` (healthcheck via mongosh) · `redis` (healthcheck ping) · `mailpit` (1025/8025) ·
`backend` (depends on healthy mongo+redis) · `frontend` (nginx, :8080). Backend env sets
`CLIENT_URL=http://localhost:8080`; compose comments an `env_file: .env` for real secrets.

### CI (GitHub Actions, both repos)

Push to `main` + PRs → `setup-node 22` → `npm ci` → lint → typecheck → test (server: with mongo:8
and redis:7 services; client: none yet) → build. `npm test` on the server therefore runs the whole
suite (health, auth, profiles, slots, availability, bookings) against fresh service containers.

---

## 5. Security posture (current)

- Passwords argon2id; tokens httpOnly (not JS-readable), secure in prod, SameSite=Lax.
- Refresh tokens opaque + hashed at rest; rotation with revocation; TTL auto-expiry in Mongo.
- Brute-force: 5-attempt lockout + auth rate limit + generic login errors.
- Enumeration: delayed unknown-email login, generic forgot-password response.
- Pino redacts auth material from logs; Mongo URI redacted.
- Helmet, CORS restricted to one origin, 100 KB body cap, request-id correlation.
- Booking authorization is server-side only: slot eligibility is recomputed on every write, a
  booking is visible solely to its participants (non-participants get 404, never 403), and
  `role=hr` listings are refused to non-HR accounts.
- **Not yet implemented:** CSRF token (SameSite=Lax mitigates for most browsers), refresh-token
  reuse detection (tokens are revoked but no alerting on reuse), dedicated verify/reset JWT
  secrets, `requireRole` usage, Redis-backed rate limiting (in-memory store), audit logging.
