export class AppError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly details?: unknown

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = new.target.name
    this.statusCode = statusCode
    this.code = code
    this.details = details
    Error.captureStackTrace(this, this.constructor)
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request.', details?: unknown) {
    super(400, 'BAD_REQUEST', message, details)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication is required.', details?: unknown) {
    super(401, 'UNAUTHORIZED', message, details)
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action.', details?: unknown) {
    super(403, 'FORBIDDEN', message, details)
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found.') {
    super(404, 'NOT_FOUND', message)
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict.', details?: unknown) {
    super(409, 'CONFLICT', message, details)
  }
}

export class SlotUnavailableError extends AppError {
  constructor(message = 'This appointment slot is no longer available.') {
    super(409, 'SLOT_ALREADY_BOOKED', message)
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid request.', details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details)
  }
}
