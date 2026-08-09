import { Router } from 'express'
import { uploadAvatarHandler } from '../../controllers/upload.controller.js'
import { uploadRateLimiter } from '../../middlewares/auth.js'
import { avatarUpload } from '../../middlewares/upload.js'

export const uploadRouter: Router = Router()

uploadRouter.use(uploadRateLimiter())

uploadRouter.post('/avatar', avatarUpload.single('image'), uploadAvatarHandler)
