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
  HOURLY_RATE_CENTS_MIN: 500,
  HOURLY_RATE_CENTS_MAX: 10_000_00,
} as const
