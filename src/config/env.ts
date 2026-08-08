import 'dotenv/config'
import { z } from 'zod'

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(5000),
    MONGO_URI: z.url().default('mongodb://127.0.0.1:27017/hr_booking'),
    REDIS_URL: z.url().default('redis://127.0.0.1:6379'),
    CLIENT_URL: z.url().default('http://localhost:5173'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    JWT_ACCESS_SECRET: z.string().min(16).default('dev-access-secret-change-me'),
    JWT_REFRESH_SECRET: z.string().min(16).default('dev-refresh-secret-change-me'),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
    JWT_VERIFY_EMAIL_EXPIRES_IN: z.string().default('1d'),
    JWT_RESET_PASSWORD_EXPIRES_IN: z.string().default('1h'),

    EMAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    EMAIL_FROM: z.string().default('no-reply@hrbooking.local'),

    SUPER_ADMIN_EMAIL: z.string().optional(),
    SUPER_ADMIN_PASSWORD: z.string().optional(),

    PAYMENT_API_KEY: z.string().optional(),
    PAYMENT_SECRET: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.NODE_ENV === 'production') {
      if (val.JWT_ACCESS_SECRET.startsWith('dev-') || val.JWT_ACCESS_SECRET.length < 32) {
        ctx.addIssue({
          code: 'custom',
          message: 'JWT_ACCESS_SECRET must be a strong secret in production',
          path: ['JWT_ACCESS_SECRET'],
        })
      }
      if (val.JWT_REFRESH_SECRET.startsWith('dev-') || val.JWT_REFRESH_SECRET.length < 32) {
        ctx.addIssue({
          code: 'custom',
          message: 'JWT_REFRESH_SECRET must be a strong secret in production',
          path: ['JWT_REFRESH_SECRET'],
        })
      }
    }
  })

const result = envSchema.safeParse(process.env)

if (!result.success) {
  console.error('Invalid environment variables:', JSON.stringify(result.error.issues, null, 2))
  throw new Error('Invalid environment configuration')
}

export const env = result.data

export const isProduction = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'
