import type { Response } from 'express'

export interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export function sendSuccess<T>(res: Response, data: T, statusCode = 200): Response {
  return res.status(statusCode).json({ success: true, data })
}

export function sendPaginated<T>(res: Response, data: T, pagination: Pagination): Response {
  return res.status(200).json({ success: true, data, pagination })
}
