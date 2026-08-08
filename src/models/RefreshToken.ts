import mongoose, { Schema } from 'mongoose'

export interface RefreshTokenDocument extends mongoose.Document {
  userId: mongoose.Types.ObjectId
  tokenHash: string
  expiresAt: Date
  revokedAt?: Date
  replacedByTokenHash?: string
  userAgent?: string
  ip?: string
  createdAt: Date
  updatedAt: Date
}

const refreshTokenSchema = new Schema<RefreshTokenDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    revokedAt: {
      type: Date,
    },
    replacedByTokenHash: {
      type: String,
    },
    userAgent: {
      type: String,
      maxlength: 500,
    },
    ip: {
      type: String,
      maxlength: 100,
    },
  },
  {
    timestamps: true,
  },
)

refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const RefreshToken = mongoose.model<RefreshTokenDocument>('RefreshToken', refreshTokenSchema)
