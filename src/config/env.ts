import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGO_URI: z.url().default('mongodb://127.0.0.1:27017/hr_booking'),
  REDIS_URL: z.url().default('redis://127.0.0.1:6379'),
  CLIENT_URL: z.url().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  JWT_ACCESS_SECRET: z.string().min(16).default('change-me-access-secret'),
  JWT_REFRESH_SECRET: z.string().min(16).default('change-me-refresh-secret'),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().default('no-reply@hrbooking.local'),
})

const result = envSchema.safeParse(process.env)

if (!result.success) {
  console.error(
    'Invalid environment variables:',
    JSON.stringify(result.error.issues, null, 2),
  )
  throw new Error('Invalid environment configuration')
}

export const env = result.data
