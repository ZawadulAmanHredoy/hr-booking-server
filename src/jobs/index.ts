import { createEmailWorker } from './email.job.js'
import { createMeetingWorker } from './meeting.job.js'
import { createReminderWorker } from './reminder.job.js'
import { createLifecycleWorker, scheduleLifecycleSweep } from './lifecycle.job.js'
import { logger } from '../config/logger.js'

interface Closeable {
  close(): Promise<void>
}

let workers: Closeable[] = []

export async function startWorkers(): Promise<void> {
  workers = [
    createEmailWorker(),
    createMeetingWorker(),
    createReminderWorker(),
    createLifecycleWorker(),
  ]

  await scheduleLifecycleSweep()

  logger.info({ count: workers.length }, 'BullMQ workers started')
}

export async function stopWorkers(): Promise<void> {
  await Promise.all(workers.map((w) => w.close()))
  workers = []
  logger.info('BullMQ workers stopped')
}
