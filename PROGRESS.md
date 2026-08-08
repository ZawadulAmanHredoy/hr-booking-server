# Progress — HR Booking

> Living document. Update at the end of each phase. Last updated: 2026-08-08.

## Phase roadmap

| Phase                           | Scope                                                                | Status      |
| ------------------------------- | -------------------------------------------------------------------- | ----------- |
| **1 — Foundation**              | Repo scaffold, health checks, error handling, logging, CI/CD, Docker | ✅ Done     |
| **2 — Authentication**          | Register/login, email verify, password reset, refresh rotation, RBAC | ✅ Done     |
| **3 — HR profiles**             | HR role + profile management, public consultant listings             | ✅ Done     |
| **4 — Availability & bookings** | Working hours, slot generation, booking lifecycle, timezones         | ✅ Done     |
| 5 — Meeting integration         | Google OAuth + Calendar/Meet, Zoom OAuth, provider abstraction       | ⏳ Next     |
| 6 — Email & background jobs     | Redis, BullMQ, confirmation mail, 30-min reminders                   | Not started |
| 7 — Payments                    | Checkout, webhooks, receipts, refunds                                | Not started |
| 8 — Notifications               | Notification model, Socket.IO, notification centre                   | Not started |
| 9 — Reviews                     | Ratings, review validation, duplicate protection                     | Not started |
| 10 — Admin                      | Admin dashboard, user/booking management, audit logs                 | Not started |
| 11 — Testing                    | Broader unit/integration coverage, Playwright E2E                    | Not started |
| 12 — Production readiness       | Nginx, Sentry, security hardening, performance                       | Not started |

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
- Repo: `1f52dcb` — _feat: Phase 1 foundation — Express + TypeScript API with health checks_

### Client (`hr-booking-client`)

- Vite 8 + React 19 + TS 6 strict, React Router 7, TanStack Query 5, Zustand 5, Axios
- Tailwind 4 `@theme` + shadcn-style primitives: `button`, `card`, `input`, `badge`, `skeleton`
- `RootLayout` (sticky header, responsive nav, footer), `HomePage`, `NotFoundPage`,
  `PlaceholderPage` for `/hr`, `/about`
- Axios client (`withCredentials`), `getApiErrorMessage`, `cn` util, `env` lib, `ui` store
- Dockerfile (nginx multi-stage), nginx.conf (SPA fallback + `/api` proxy), CI
- Repo: `59768bf` — _feat: Phase 1 foundation — Vite + React + TypeScript scaffold_

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
- Repo: `0a5179b` — _feat(auth): full authentication flow — register, login, refresh rotation,
  email verification, password reset_

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
- Repo: `3d99056` — _feat(auth): full auth UI — login, register, email verify, password reset,
  session handling_

---

## Phase 3 — HR profiles ✅

### Server

- `config/constants.ts`: `SPECIALIZATIONS` (10), `PROFILE_STATUS` (DRAFT/PUBLISHED), `CURRENCIES`
  (7), `PROFILE_LIMITS` (rate 500–100_000 cents, specs/langs 1–5, certs ≤10, years 0–70)
- `HRProfile` model: unique `userId` ref, headline (≤80), bio (≤2000), specializations enum,
  `hourlyRateCents`/`currency`, languages, city/country, certifications subdocs, `status`
  (default DRAFT), `isAvailable`, rating/ratingCount; compound indexes
  (specializations; status+rating; status+hourlyRateCents)
- `validators/hrProfile.validator.ts`: `upsertProfileSchema`, `profileStatusSchema`,
  `availabilitySchema`, `profileIdParamsSchema` (24-hex), `listProfilesQuerySchema`
- `hr-profile.service.ts`: `upsertProfile` (creates profile and **upgrades USER → HR** on first
  onboarding), own-profile get/publish/availability, `listPublicProfiles` (PUBLISHED-only,
  `$or` search on headline/bio, specialization/language/price filters, sort rating|rate|newest,
  pagination) + `toOwnProfile`/`toPublicProfile`
- Routes at `/api/v1/profiles`: public `GET /` + `GET /:id`; own `PUT /me` (onboarding),
  HR-only `GET /me`, `PATCH /me/publish`, `PATCH /me/availability` — **first real use of
  `requireRole('HR')`**
- `validate.ts` now also exports `validateQuery`/`validateParams`; Express 5 exposes
  `req.query`/`req.params` as getter-only, so they are shadowed with an own property
  (`Object.defineProperty`) instead of assigned
- 16 profile integration tests (onboarding + role upgrade, dedupe, RBAC, publish filtering,
  search/filters/sort/pagination, detail visibility)
- Fixed duplicate-schema-index warnings (`HRProfile.userId`, `RefreshToken.expiresAt`)
- **Verification:** lint ✅ typecheck ✅ **36/36 tests** ✅ build ✅
- Repo: `64d9fca` — _feat(hr-profiles): HR profile model, own-profile routes, and public
  directory_; `575ae61` — _fix(models): remove duplicate schema indexes_

### Client

- `services/api/hrProfiles.ts` (typed list/get/own/upsert/publish/availability) + `lib/format.ts`
  (`formatRate` via `Intl.NumberFormat` per-currency locale) + `lib/constants.ts` mirror
- `HrDirectoryPage` (`/hr`): debounced search, specialization filter, sort, paginated grid of
  `ProfileCard`s with skeletons and empty state
- `ProfileDetailPage` (`/hr/:id`): avatar, headline, badges, bio, certifications, rate,
  availability banner, booking CTA
- `ProfileOnboardingPage` (`/profile`): create/edit form (specialization chips 1–5, rate in
  whole units → cents, currency select, comma-separated languages); 403/404 → create mode
- `ProfileManagePage` (`/profile/manage`): own-profile overview, publish/unpublish +
  availability toggles, edit link; empty state CTA when no profile
- New UI: `avatar`, `select`; `RequireRole` guard; nav shows "My profile" for HR users
- **Fix:** client API base now defaults to `/api/v1` (was `/api`), matching the server's
  versioned routes — this was broken in Phase 2 for proxied dev traffic
- **Verification:** typecheck ✅ lint ✅ build ✅
- **End-to-end smoke tested** through the Vite proxy: register → verify → login → onboard
  (role becomes HR) → publish → public list/detail → availability toggle
- Repo: `ad2eaeb` — _feat(hr-profiles): directory, detail, onboarding, and manage pages_

---

## Phase 4 — Availability & bookings ✅

### Server

- New dependency: **luxon** (IANA timezone maths); no manual offset arithmetic anywhere
- `config/constants.ts`: `BOOKING_STATUS` (PENDING/CONFIRMED/CANCELLED/COMPLETED/NO_SHOW),
  `ACTIVE_BOOKING_STATUSES`, `MEETING_PROVIDERS` (GOOGLE_MEET/ZOOM), `CANCELLED_BY`,
  `SLOT_DURATIONS` (15/30/45/60/90), `AVAILABILITY_DEFAULTS`, `AVAILABILITY_LIMITS`,
  `BOOKING_LIMITS` (notes 1000, cancel reason 300, 60-min cancel notice, 3 reschedules)
- `Availability` model: unique `hrUserId`, IANA `timezone`, slot duration, buffer, min notice,
  booking horizon, `weeklyHours[{ weekday 0–6, intervals[{ start, end }] }]`,
  `blockedDates[{ date, startTime?, endTime?, reason? }]` (full-day when times are omitted)
- `Booking` model: participants + profile refs, UTC `startAt`/`endAt`, `durationMinutes`,
  `hrTimezone`/`userTimezone`, status, prorated `priceCents`/`currency`, meeting provider, notes,
  cancellation fields, `previousStartAt`/`rescheduleCount`, and **`slotKey`** —
  `${hrUserId}:${startAt}` carried only while the booking is active
- Indexes: unique **sparse** `slotKey`, `userId+startAt`, `hrUserId+startAt`,
  `hrUserId+status+startAt`, `status+startAt`
- `utils/datetime.ts`: luxon helpers (`wallTimeToUtc`, `dateKeysBetween`, `weekdayOfDateKey`,
  `isValidTimezone`, `overlaps`, …)
- `slot.service.ts`: pure `generateSlots(config, { rangeStart, rangeEnd, now, busy })` — walks each
  day in the consultant's zone, applies slot duration + buffer, min notice, booking horizon,
  blocked dates and existing bookings; **DST-correct** (offset follows the real transition) and
  deduplicates instants across a spring-forward gap. `getAvailableSlots` subtracts active bookings;
  `isOfferedSlot` is the server-side gate used before any write
- `availability.service.ts`: own record created empty on first read (nothing bookable until the
  consultant publishes hours), upsert, published-profile lookup, own/public response mappers
- `booking.service.ts`: `createBooking` (published + accepting + not self + offered slot + client
  free + consultant free), role-aware `listBookings`, participant-scoped `getBookingForActor`,
  `cancelBooking`, `rescheduleBooking`
- **Double-booking protection in three layers** (MongoDB may be standalone here, so no multi-doc
  transactions): pre-checks → unique sparse `slotKey` index (duplicate key → `SLOT_ALREADY_BOOKED`)
  → post-insert overlap sweep where the later `_id` stands down and deletes itself
- New error `SlotUnavailableError` → 409 `SLOT_ALREADY_BOOKED`
- Validators `availability.validator.ts` (timezone existence, `HH:mm`, interval ordering, overlap,
  duplicate weekday, slot-duration enum) and `booking.validator.ts` (ISO instants, 24-hex ids,
  list scope/role/status)
- Routes: `/api/v1/availability` — HR `GET|PUT /me`, public `GET /:profileId/slots`;
  `/api/v1/bookings` — `POST /`, `GET /`, `GET /:id`, `PATCH /:id/cancel`, `PATCH /:id/reschedule`
- Cancel policy: clients need 60 minutes' notice, consultants/admins may cancel until start;
  cancelling `$unset`s `slotKey` so the slot is immediately bookable again
- Tests: 13 pure slot-generation tests (timezones, DST, buffers, blocks, notice, horizon),
  14 availability API tests, 20 booking API tests including a **concurrent double-booking race**
- `vitest.config.ts` now sets `fileParallelism: false` — the suites share one live MongoDB
- **Verification:** lint ✅ typecheck ✅ **83/83 tests** ✅ build ✅

### Client

- `services/api/availability.ts` + `services/api/bookings.ts` (typed, error-normalising)
- `lib/datetime.ts`: Intl-only helpers (`browserTimezone`, `dateKeyIn`, `formatTime/Date/DateTime`,
  `timezoneAbbreviation`, `groupByDay`) — the server sends UTC instants, the browser renders them
  in the viewer's own zone
- `SlotPicker`: 14-day window with prev/next paging, day strip, time grid, skeleton/empty/error
  states; `BookingPanel` on `/hr/:id` (login CTA when signed out, own-profile notice, meeting
  platform, notes, prorated fee, confirm)
- Pages: real `/dashboard` (next-up list + quick links), `/dashboard/bookings` (upcoming vs
  past/cancelled, consultants can flip between "bookings I made" and "bookings with me"),
  `/dashboard/bookings/:id` (both timezones side by side, cancel with reason, reschedule via the
  slot picker), `/profile/availability` (HR-only weekly-hours editor, rules, blocked dates)
- New primitives: `textarea`; new components `BookingCard`, `BookingStatusBadge`
- Nav gains a **Bookings** link; profile management gains an **Availability** link
- **Verification:** typecheck ✅ lint ✅ build ✅
- **End-to-end smoke tested** through the Vite proxy (25 checks): register → verify → login →
  onboard → refresh for the new HR role → publish → set Dhaka availability → public slots →
  book → slot disappears → both parties list it → reschedule → cancel → slot returns

---

## Verification status

| Repo   | Lint | Typecheck | Tests                                                                               | Build | CI  |
| ------ | ---- | --------- | ----------------------------------------------------------------------------------- | ----- | --- |
| server | ✅   | ✅        | ✅ 83 (4 health + 16 auth + 16 profiles + 13 slots + 14 availability + 20 bookings) | ✅    | ✅  |
| client | ✅   | ✅        | n/a (no tests yet)                                                                  | ✅    | ✅  |

Both repos pushed to `main`. Tests require live MongoDB (27017) + Redis (6379); they degrade
gracefully with a warning if unavailable.

---

## Known notes / caveats (from actual code)

- `asyncHandler` util (`src/utils/async-handler.ts`) is unused; controllers hand-roll
  `try/catch { next(err) }`.
- `requireRole` is now used by the HR-profile and availability own routes; admin-only endpoints are
  still future work.
- Bookings are created straight to `CONFIRMED`; `PENDING` exists for the future payment flow and
  nothing writes it yet. Nothing moves a booking to `COMPLETED`/`NO_SHOW` either — that needs the
  background jobs of Phase 6.
- `Meeting` is not modelled yet; `Booking.meetingProvider` records the client's choice and the
  detail page says the joining link arrives once meeting integration ships (Phase 5).
- Double booking is prevented without transactions (unique sparse `slotKey` + a post-insert overlap
  sweep) because the dev MongoDB runs standalone. If the deployment target is a replica set, the
  sweep could be replaced by a transaction.
- A consultant who changes slot duration or working hours does not invalidate bookings already
  made; existing bookings keep their original duration and simply block the slots they overlap.
- The reschedule endpoint keeps the original consultation length only if the consultant has not
  changed it; it re-reads `slotDurationMinutes` from the current availability.
- After onboarding upgrades a USER to HR, the access token still carries the old role until the
  next refresh. The client's auth store re-reads `/auth/me`, but a raw API consumer must call
  `/auth/refresh` (the smoke test does this explicitly).
- `validateQuery`/`validateParams` shadow `req.query`/`req.params` via `Object.defineProperty`
  because Express 5 ships them as getter-only properties; controllers read the validated values
  from `req.query`/`req.params` (typed with a cast).
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

## Next up — Phase 5 (meeting integration)

Candidate scope (not yet planned in detail):

- Server: `OAuthAccount` model with encrypted tokens, Google OAuth + Calendar/Meet event creation,
  Zoom OAuth + meeting creation, a `MeetingProvider` abstraction
  (`createMeeting`/`updateMeeting`/`cancelMeeting`) with `GoogleMeetProvider` / `ZoomProvider`,
  a `Meeting` model linked to `Booking`, and recovery when the provider call fails
- Client: `/profile/integrations` connect/disconnect cards, meeting link on the booking detail
  page, provider badge on booking cards
