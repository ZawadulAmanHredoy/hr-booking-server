import mongoose, { Schema } from 'mongoose'
import { OAUTH_PROVIDERS, type OAuthProvider } from '../config/constants.js'

export interface OAuthAccountDocument extends mongoose.Document {
  id: string
  userId: mongoose.Types.ObjectId
  provider: OAuthProvider
  providerAccountId: string
  accountEmail?: string
  /** AES-256-GCM ciphertext — never logged, never sent to the client. */
  refreshToken: string
  accessToken?: string
  accessTokenExpiresAt?: Date
  scopes: string[]
  calendarId: string
  lastError?: string
  createdAt: Date
  updatedAt: Date
}

const oauthAccountSchema = new Schema<OAuthAccountDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    provider: {
      type: String,
      enum: Object.values(OAUTH_PROVIDERS),
      required: true,
    },
    providerAccountId: {
      type: String,
      required: true,
    },
    accountEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },
    refreshToken: {
      type: String,
      required: true,
      select: false,
    },
    accessToken: {
      type: String,
      select: false,
    },
    accessTokenExpiresAt: {
      type: Date,
    },
    scopes: {
      type: [String],
      default: [],
    },
    calendarId: {
      type: String,
      default: 'primary',
    },
    lastError: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
)

// One connection per provider per user; reconnecting overwrites the existing document.
oauthAccountSchema.index({ userId: 1, provider: 1 }, { unique: true })

export const OAuthAccount = mongoose.model<OAuthAccountDocument>('OAuthAccount', oauthAccountSchema)
