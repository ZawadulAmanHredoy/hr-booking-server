# Architecture — HR Booking

> Code-level architecture written from the actual implementation (Phase 1 + Phase 2).
> Last updated: 2026-08-08.

## 1. System overview

```
┌──────────────────────┐      ┌──────────────────────┐
│  React SPA (client)  │      │  Express API (server)│
│  Vite / nginx :8080  │      │  Node 22 :5000       │
└──────────┬───────────┘      └──────────┬───────────┘
           │ /api, /health (proxy)       │
           │                             │
           │                  ┌──────────┴──────────────┐
           │                  │ MongoDB (users, tokens) │
           │                  │ Redis (future queues)   │
           │                  │ SMTP (Mailpit dev)      │
           └──────────────────┴─────────────────────────┘
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
| field | notes |
| --- | --- |
| email | unique, lowercase, indexed |
| password | argon2id hash, `select: false` |
| firstName / lastName | trimmed, ≤50 |
| role | enum, default `USER`, indexed |
| status | enum, default `ACTIVE`, indexed |
| isEmailVerified / emailVerifiedAt | |
| phone, profileImageUrl | optional |
| failedLoginAttempts / lockedUntil | lockout state |

**RefreshToken**
| field | notes |
| --- | --- |
| userId | ref User, indexed |
| tokenHash | sha-256 of the raw token, unique |
| expiresAt | indexed + **TTL index** (`expireAfterSeconds: 0`) for auto-cleanup |
| revokedAt / replacedByTokenHash | rotation chain |
| userAgent / ip | device context |

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

**reset-password** → verify JWT → rehash password → **delete all the user's refresh tokens** →
200.

**GET /auth/me** → `authenticate` (decodes cookie or Bearer access JWT into `req.user`) +
`loadUser` (re-loads from DB, rejects non-ACTIVE) → returns `toPublicUser` (never includes
password).

**RBAC** — `requireRole(...roles)` returns 403 for the wrong role; `loadUser` must run after
`authenticate`. No route uses it yet.

### 2.6 Email (`src/services/email/`)

- `email.service.ts` — `EmailMessage { to, subject, html, text? }`, `EmailTransport` interface.
- `index.ts` — lazy singleton transport (`console` default, `smtp` if `EMAIL_TRANSPORT=smtp`);
  `sendEmail` wraps delivery in try/catch and only logs failures.
- `transports/console.transport.ts` — logs the message (dev).
- `transports/smtp.transport.ts` — nodemailer; secure on port 465, auth only if credentials set.
- `templates/auth.templates.ts` — verify/reset HTML with `escapeHtml` on the recipient name; links
  point at `${CLIENT_URL}/verify-email?token=…` and `/reset-password?token=…`.

### 2.7 Rate limiting

- `apiRateLimiter()`: global, 120 req / 60 s, applied app-wide in `createApp`.
- `authRateLimiter()`: 10 req / 15 min, applied to the whole `/api/v1/auth` router.
- Both return a no-op middleware when `NODE_ENV=test` so the test suite isn't throttled.

### 2.8 Seed (`src/scripts/seed.ts`)

`npm run seed` → connect DB → if `SUPER_ADMIN_EMAIL`/`SUPER_ADMIN_PASSWORD` set and no such user,
create a verified `SUPER_ADMIN` (argon2-hashed). Otherwise logs and exits.

### 2.9 Tests (`tests/`)

Vitest + Supertest. `health.test.ts` (4) and `auth.test.ts` (16) boot the app with `createApp()`,
connect to **live** MongoDB/Redis when reachable (warn otherwise), use unique emails per run, and
clean up users/tokens in afterAll. Auth tests generate verify/reset tokens directly with
`signGenericToken` (the dev `JWT_REFRESH_SECRET` is used since email is console-only). Both test
files run in separate workers, so they share the DB but not Mongoose connections.

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

| Route | Guard | Notes |
| --- | --- | --- |
| `/` | — | HomePage |
| `/login`, `/register`, `/forgot-password`, `/reset-password` | `RedirectIfAuthed` | bounce to `/` when logged in |
| `/verify-email` | — | reads `?token`, calls verify-email |
| `/hr`, `/about` | — | placeholders |
| `/dashboard` | `RequireAuth` | placeholder, first protected route |
| `*` | — | NotFoundPage |

Guards (`components/auth/guards.tsx`): `RequireAuth` → `<Navigate to="/login" state={{from}}>`;
`RedirectIfAuthed` → `<Navigate to="/">`. Login reads `state.from` to return the user.

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
and redis:7 services; client: none yet) → build. `npm test` on the server therefore runs the
auth/health suites against fresh service containers.

---

## 5. Security posture (current)

- Passwords argon2id; tokens httpOnly (not JS-readable), secure in prod, SameSite=Lax.
- Refresh tokens opaque + hashed at rest; rotation with revocation; TTL auto-expiry in Mongo.
- Brute-force: 5-attempt lockout + auth rate limit + generic login errors.
- Enumeration: delayed unknown-email login, generic forgot-password response.
- Pino redacts auth material from logs; Mongo URI redacted.
- Helmet, CORS restricted to one origin, 100 KB body cap, request-id correlation.
- **Not yet implemented:** CSRF token (SameSite=Lax mitigates for most browsers), refresh-token
  reuse detection (tokens are revoked but no alerting on reuse), dedicated verify/reset JWT
  secrets, `requireRole` usage, Redis-backed rate limiting (in-memory store), audit logging.
