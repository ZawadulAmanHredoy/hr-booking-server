import 'express'
import type { AuthUser } from '../middlewares/auth.js'

declare module 'express-serve-static-core' {
  interface Request {
    id: string
    user?: AuthUser
  }
}
