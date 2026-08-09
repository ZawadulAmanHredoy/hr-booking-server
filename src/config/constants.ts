export const USER_ROLES = {
  USER: 'USER',
  HR: 'HR',
  ADMIN: 'ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
} as const

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES]

export const USER_STATUS = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const

export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS]

export const AUTH_COOKIES = {
  ACCESS: 'hrb_access_token',
  REFRESH: 'hrb_refresh_token',
} as const

export const TOKEN_TYPES = {
  ACCESS: 'access',
  REFRESH: 'refresh',
  VERIFY_EMAIL: 'verify-email',
  RESET_PASSWORD: 'reset-password',
  OAUTH_STATE: 'oauth-state',
} as const

export type TokenType = (typeof TOKEN_TYPES)[keyof typeof TOKEN_TYPES]

export const AUTH_LIMITS = {
  MAX_FAILED_ATTEMPTS: 5,
  LOCKOUT_MS: 15 * 60 * 1000,
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_MAX_LENGTH: 128,
} as const

export const SPECIALIZATIONS = {
  RECRUITMENT: 'RECRUITMENT',
  COMPENSATION_BENEFITS: 'COMPENSATION_BENEFITS',
  EMPLOYEE_RELATIONS: 'EMPLOYEE_RELATIONS',
  PERFORMANCE_MANAGEMENT: 'PERFORMANCE_MANAGEMENT',
  TRAINING_DEVELOPMENT: 'TRAINING_DEVELOPMENT',
  HR_OPERATIONS: 'HR_OPERATIONS',
  LABOR_LAW_COMPLIANCE: 'LABOR_LAW_COMPLIANCE',
  ORGANIZATIONAL_DEVELOPMENT: 'ORGANIZATIONAL_DEVELOPMENT',
  HRIS: 'HRIS',
  DIVERSITY_INCLUSION: 'DIVERSITY_INCLUSION',
} as const

export type Specialization = (typeof SPECIALIZATIONS)[keyof typeof SPECIALIZATIONS]

export const PROFILE_STATUS = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
} as const

export type ProfileStatus = (typeof PROFILE_STATUS)[keyof typeof PROFILE_STATUS]

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'BDT', 'INR', 'CAD', 'AUD'] as const

export type Currency = (typeof CURRENCIES)[number]

export const PROFILE_LIMITS = {
  SPECIALIZATIONS_MIN: 1,
  SPECIALIZATIONS_MAX: 5,
  LANGUAGES_MIN: 1,
  LANGUAGES_MAX: 5,
  CERTIFICATIONS_MAX: 10,
  WORK_HISTORY_MAX: 10,
  HOURLY_RATE_CENTS_MIN: 500,
  HOURLY_RATE_CENTS_MAX: 10_000_00,
} as const

export const UPLOAD_LIMITS = {
  MAX_BYTES: 5 * 1024 * 1024,
  ALLOWED_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp'] as const,
} as const

export const MEETING_PROVIDERS = {
  GOOGLE_MEET: 'GOOGLE_MEET',
  ZOOM: 'ZOOM',
} as const

export type MeetingProvider = (typeof MEETING_PROVIDERS)[keyof typeof MEETING_PROVIDERS]

/**
 * Providers with a working adapter today. `MEETING_PROVIDERS` keeps the wider set so stored
 * bookings stay readable if another provider is added (or removed) later.
 */
export const SUPPORTED_MEETING_PROVIDERS = [MEETING_PROVIDERS.GOOGLE_MEET] as const

export type SupportedMeetingProvider = (typeof SUPPORTED_MEETING_PROVIDERS)[number]

export const MEETING_STATUS = {
  PENDING: 'PENDING',
  CREATED: 'CREATED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const

export type MeetingStatus = (typeof MEETING_STATUS)[keyof typeof MEETING_STATUS]

export const OAUTH_PROVIDERS = {
  GOOGLE: 'GOOGLE',
} as const

export type OAuthProvider = (typeof OAUTH_PROVIDERS)[keyof typeof OAUTH_PROVIDERS]

export const GOOGLE_OAUTH = {
  AUTH_URL: 'https://accounts.google.com/o/oauth2/v2/auth',
  TOKEN_URL: 'https://oauth2.googleapis.com/token',
  REVOKE_URL: 'https://oauth2.googleapis.com/revoke',
  CALENDAR_API: 'https://www.googleapis.com/calendar/v3',
  USERINFO_URL: 'https://www.googleapis.com/oauth2/v3/userinfo',
  SCOPES: ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events'],
  /** Refresh a little early so a request never races the expiry. */
  TOKEN_EXPIRY_SKEW_MS: 60_000,
  STATE_TTL: '10m',
} as const

export const BOOKING_STATUS = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
  NO_SHOW: 'NO_SHOW',
} as const

export type BookingStatus = (typeof BOOKING_STATUS)[keyof typeof BOOKING_STATUS]

// Statuses that still occupy a slot. Only these carry a `slotKey`, which is what the
// sparse unique index uses to make double booking impossible.
export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  BOOKING_STATUS.PENDING,
  BOOKING_STATUS.CONFIRMED,
]

export const CANCELLED_BY = {
  USER: 'USER',
  HR: 'HR',
  ADMIN: 'ADMIN',
  SYSTEM: 'SYSTEM',
} as const

export type CancelledBy = (typeof CANCELLED_BY)[keyof typeof CANCELLED_BY]

export const SLOT_DURATIONS = [15, 30, 45, 60, 90] as const

export type SlotDuration = (typeof SLOT_DURATIONS)[number]

export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const

export const AVAILABILITY_DEFAULTS = {
  TIMEZONE: 'UTC',
  SLOT_DURATION_MINUTES: 30,
  BUFFER_MINUTES: 0,
  MIN_NOTICE_MINUTES: 120,
  MAX_ADVANCE_DAYS: 60,
} as const

export const AVAILABILITY_LIMITS = {
  INTERVALS_PER_DAY_MAX: 4,
  BLOCKED_DATES_MAX: 90,
  BUFFER_MINUTES_MAX: 60,
  MIN_NOTICE_MINUTES_MAX: 14 * 24 * 60,
  MAX_ADVANCE_DAYS_MIN: 1,
  MAX_ADVANCE_DAYS_MAX: 180,
  SLOT_RANGE_DAYS_MAX: 31,
  BLOCK_REASON_MAX: 120,
} as const

export const BOOKING_LIMITS = {
  NOTES_MAX: 1000,
  CANCEL_REASON_MAX: 300,
  CANCEL_NOTICE_MINUTES: 60,
  RESCHEDULE_MAX: 3,
  PAGE_SIZE_MAX: 50,
  PAGE_SIZE_DEFAULT: 10,
} as const
