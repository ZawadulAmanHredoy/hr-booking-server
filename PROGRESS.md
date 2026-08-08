# Progress — HR Booking

> Living document. Update at the end of each phase. Last updated: 2026-08-08.

## Phase roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| **1 — Foundation** | Repo scaffold, health checks, error handling, logging, CI/CD, Docker | ✅ Done |
| **2 — Authentication** | Register/login, email verify, password reset, refresh rotation, RBAC | ✅ Done |
| **3 — HR profiles** | HR role + profile management, public consultant listings | ⏳ Next |
| 4 — Availability & bookings | Time slots, calendar sync (Google/Zoom), booking flow | Not started |
| 5 — Payments | Checkout, receipts, refunds | Not started |
| 6 — Admin & operations | User/booking admin, analytics, jobs/queues | Not started |

Everything below is written from the actual code (not the original plan).

---

## Phase 1 — Foundation ✅

### Server (`hr-booking-server`)
- Express 5 + TypeScript 6 (strict, ESM/NodeNext), Zod-validated env
- Middleware stack: request-id, pino-http, helmet, compression, CORS (`CLIENT_URL`, credentials),
  JSON/urlencoded (100 KB), cookie-parser, not-found + centralized error handler
- `AppError` hierarchy + consistent `{ success, error: { code, message, details } }` shape;
  413 and 500 handling (no stack leak in prod)
- Pino logging with redaction (`req.headers.authorization`, `req.headers.cookie`, `password`,
  `accessToken`, `refreshToken`, `secret`)
- Health: `/health` (liveness), `/health/ready` (Mongo readyState + Redis ping) → 200/503
- Graceful shutdown (SIGTERM/SIGINT, 10 s force timeout), Redis optional at boot
- Vitest + Supertest (4 health tests), Dockerfile, docker-compose (mongo/redis/mailpit/backend/
  frontend), GitHub Actions CI
- Repo: `1f52dcb` — *feat: Phase 1 foundation — Express + TypeScript API with health checks*

### Client (`hr-booking-client`)
- Vite 8 + React 19 + TS 6 strict, React Router 7, TanStack Query 5, Zustand 5, Axios
- Tailwind 4 `@theme` + shadcn-style primitives: `button`, `card`, `input`, `badge`, `skeleton`
- `RootLayout` (sticky header, responsive nav, footer), `HomePage`, `NotFoundPage`,
  `PlaceholderPage` for `/hr`, `/about`
- Axios client (`withCredentials`), `getApiErrorMessage`, `cn` util, `env` lib, `ui` store
- Dockerfile (nginx multi-stage), nginx.conf (SPA fallback + `/api` proxy), CI
- Repo: `59768bf` — *feat: Phase 1 foundation — Vite + React + TypeScript scaffold*

---

## Phase 2 — Authentication ✅

### Server
- Models: `User` (email unique, password `select:false`, role/status, failed-attempt lock fields),
  `RefreshToken` (sha-256 hash, TTL index, `replacedByTokenHash`, `userAgent`, `ip`)
- Utils: argon2id hashing + strength check, token sign/verify (type-checked), cookie helpers,
  refresh-token generator/hasher
- Email service: `EmailTransport` interface, `ConsoleTransport`/`SmtpTransport`, escaped HTML
  templates for verify + reset; `sendEmail` never throws
- `auth.service.ts`: register, login (lockout + anti-enumeration delay), refresh (rotation +
  revocation), logout, verifyEmail, forgotPassword (no enumeration), resetPassword (revokes all
  refresh tokens), `toPublicUser`, `getUserById`
- Middleware: `authenticate` (cookie or Bearer), `requireRole`, `loadUser`, `validateBody`,
  auth limiter (10/15 min) + global limiter (120/min), both no-op under test
- Routes at `/api/v1/auth`: register, login, refresh, logout, verify-email, forgot-password,
  reset-password, me
- `.env.example` auth vars, super-admin seed script (`npm run seed`), 16 auth integration tests
- **Verification:** typecheck ✅ lint ✅ **20/20 tests** ✅ build ✅ CI (mongo+redis services) ✅
- Repo: `0a5179b` — *feat(auth): full authentication flow — register, login, refresh rotation,
  email verification, password reset*

### Client
- Auth API service + Axios **silent refresh-on-401** interceptor (single retry; refresh call
  excluded) with `setSessionExpiredHandler`
- Zustand auth store (`user`, `isInitialized`, login/register/logout/clearSession)
- `AuthBootstrap` hydrates session from `GET /auth/me` (spinner until done)
- Pages: `LoginPage` (redirects back to `from`), `RegisterPage` (check-your-inbox state),
  `VerifyEmailPage` (reads `?token`), `ForgotPasswordPage` (generic success), `ResetPasswordPage`
  (reads `?token`); new UI primitives `label`, plus `AuthShell`/`FormAlert`
- Guards `RequireAuth` / `RedirectIfAuthed`; protected `/dashboard`; auth-aware header nav
  (user name, Dashboard, Log out) desktop + mobile
- **Verification:** typecheck ✅ lint ✅ build ✅ CI ✅
- **End-to-end smoke tested** through the Vite proxy: register → verify → login → `/me` →
  refresh rotation → logout; rate limiting and no-enumeration confirmed
- Repo: `3d99056` — *feat(auth): full auth UI — login, register, email verify, password reset,
  session handling*

---

## Verification status

| Repo | Lint | Typecheck | Tests | Build | CI |
| --- | --- | --- | --- | --- | --- |
| server | ✅ | ✅ | ✅ 20 (4 health + 16 auth) | ✅ | ✅ |
| client | ✅ | ✅ | n/a (no tests yet) | ✅ | ✅ |

Both repos pushed to `main`. Tests require live MongoDB (27017) + Redis (6379); they degrade
gracefully with a warning if unavailable.

---

## Known notes / caveats (from actual code)

- `asyncHandler` util (`src/utils/async-handler.ts`) is unused; controllers hand-roll
  `try/catch { next(err) }`.
- `requireRole` middleware exists but no route uses it yet (no admin-protected endpoints).
- Refresh TTL is hardcoded to 7 days in `auth.service.ts` (`REFRESH_TOKEN_TTL_MS`); there is no
  env knob — keep in sync with `JWT_REFRESH_EXPIRES_IN` / cookie maxAge (all 7 d today).
- Verify-email and reset-password tokens are signed with `JWT_REFRESH_SECRET` (the
  `getSecret()` fallback), not dedicated secrets. They are 15-min-access-token style JWTs with a
  `type` claim that is verified.
- Client `register()` stores the returned (unverified) user in the store, so the header shows an
  authenticated state before the email is verified; the server still blocks login until verified.
- The refresh interceptor is a simple retry; it does not single-flight concurrent 401s (multiple
  parallel refreshes are possible) — acceptable for now, candidate for later hardening.
- gh CLI is installed but unauthenticated; all GitHub interaction is via SSH git.
- A GitHub PAT was shared in chat (scope `repo, workflow`) — **recommend revocation**; not used
  since SSH push works.
- `src/features`, `src/hooks`, `src/types`, `src/utils` (client) and `src/integrations`,
  `src/jobs`, `src/modules`, `src/queues`, `src/middlewares/validators`, `src/validators`,
  `src/models` `.gitkeep` dirs (server) are placeholders for future phases.
- `shared/types` (server) is an empty placeholder; no cross-repo shared types exist yet.

---

## Next up — Phase 3 (HR profiles)

Candidate scope (not yet planned in detail):
- Server: `HRProfile` model, HR profile CRUD (own profile), public listing/search endpoints
  (filter by specialization/rating/availability), `requireRole('HR')` first real use, more tests
- Client: HR onboarding/onboarding-stepper, consultant profile page, public directory page
  replacing `/hr` placeholder, `features/` module structure
