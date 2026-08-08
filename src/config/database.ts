import mongoose from 'mongoose'
import { env } from './env.js'
import { logger } from './logger.js'

function redactMongoUri(uri: string): string {
  try {
    const parsed = new URL(uri)
    if (parsed.username) parsed.username = '***'
    if (parsed.password) parsed.password = '***'
    return parsed.toString()
  } catch {
    return 'mongodb://***'
  }
}

export async function connectDatabase(): Promise<void> {
  mongoose.set('strictQuery', true)
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 5000 })
  logger.info({ uri: redactMongoUri(env.MONGO_URI) }, 'MongoDB connected')
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect()
  logger.info('MongoDB disconnected')
}
