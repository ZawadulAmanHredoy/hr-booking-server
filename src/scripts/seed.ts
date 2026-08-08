import { connectDatabase, disconnectDatabase } from '../config/database.js'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { User } from '../models/User.js'
import { USER_ROLES } from '../config/constants.js'
import { hashPassword } from '../utils/password.js'

async function seed(): Promise<void> {
  await connectDatabase()

  try {
    const email = env.SUPER_ADMIN_EMAIL
    const password = env.SUPER_ADMIN_PASSWORD

    if (!email || !password) {
      logger.warn('SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD not set. Skipping super admin seed.')
      return
    }

    const existing = await User.findOne({ email })
    if (existing) {
      logger.info({ email }, 'Super admin already exists. Skipping.')
      return
    }

    await User.create({
      email,
      password: await hashPassword(password),
      firstName: 'Super',
      lastName: 'Admin',
      role: USER_ROLES.SUPER_ADMIN,
      isEmailVerified: true,
      emailVerifiedAt: new Date(),
    })

    logger.info({ email }, 'Super admin seeded')
  } finally {
    await disconnectDatabase()
  }
}

void seed().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, 'Seed failed')
  process.exit(1)
})
