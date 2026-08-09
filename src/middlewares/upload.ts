import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import multer from 'multer'
import { UPLOAD_LIMITS } from '../config/constants.js'
import { BadRequestError } from '../utils/http-errors.js'

export const uploadsDir = path.join(process.cwd(), 'uploads')
fs.mkdirSync(uploadsDir, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir)
  },
  filename: (_req, file, cb) => {
    cb(null, `${randomUUID()}${path.extname(file.originalname)}`)
  },
})

export const avatarUpload = multer({
  storage,
  limits: { fileSize: UPLOAD_LIMITS.MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!(UPLOAD_LIMITS.ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      cb(new BadRequestError('Only JPEG, PNG, or WebP images are allowed.'))
      return
    }
    cb(null, true)
  },
})
