import { Router } from 'express'
import {
  forgotPasswordHandler,
  loginHandler,
  logoutHandler,
  meHandler,
  refreshHandler,
  registerHandler,
  registerHrHandler,
  resetPasswordHandler,
  verifyEmailHandler,
} from '../../controllers/auth.controller.js'
import { authenticate, authRateLimiter, loadUser } from '../../middlewares/auth.js'
import { validateBody } from '../../middlewares/validate.js'
import {
  forgotPasswordSchema,
  loginSchema,
  registerHrSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '../../validators/auth.validator.js'

export const authRouter: Router = Router()

authRouter.use(authRateLimiter())

authRouter.post('/register', validateBody(registerSchema), registerHandler)
authRouter.post('/register-hr', validateBody(registerHrSchema), registerHrHandler)
authRouter.post('/login', validateBody(loginSchema), loginHandler)
authRouter.post('/refresh', refreshHandler)
authRouter.post('/logout', logoutHandler)
authRouter.post('/verify-email', validateBody(verifyEmailSchema), verifyEmailHandler)
authRouter.post('/forgot-password', validateBody(forgotPasswordSchema), forgotPasswordHandler)
authRouter.post('/reset-password', validateBody(resetPasswordSchema), resetPasswordHandler)
authRouter.get('/me', authenticate, loadUser, meHandler)
