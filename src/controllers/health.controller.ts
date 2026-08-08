import type { Request, Response } from 'express'
import { checkDependencies } from '../services/health.service.js'

export function liveness(_req: Request, res: Response): void {
  res.status(200).json({
    success: true,
    data: { status: 'ok', uptime: process.uptime() },
  })
}

export async function readiness(_req: Request, res: Response): Promise<void> {
  const checks = await checkDependencies()
  const ready = checks.every((check) => check.status === 'ok')
  res.status(ready ? 200 : 503).json({
    success: ready,
    data: { status: ready ? 'ready' : 'not-ready', checks },
  })
}
