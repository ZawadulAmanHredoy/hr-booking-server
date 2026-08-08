import mongoose, { Schema } from 'mongoose'
import {
  PROFILE_STATUS,
  SPECIALIZATIONS,
  type Currency,
  type ProfileStatus,
  type Specialization,
} from '../config/constants.js'

export interface Certification {
  name: string
  issuer?: string
  year?: number
}

export interface HRProfileDocument extends mongoose.Document {
  id: string
  userId: mongoose.Types.ObjectId
  headline: string
  bio: string
  specializations: Specialization[]
  yearsOfExperience: number
  hourlyRateCents: number
  currency: Currency
  languages: string[]
  city?: string
  country?: string
  profileImageUrl?: string
  certifications: Certification[]
  status: ProfileStatus
  isAvailable: boolean
  rating: number
  ratingCount: number
  createdAt: Date
  updatedAt: Date
}

const certificationSchema = new Schema<Certification>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    issuer: { type: String, trim: true, maxlength: 100 },
    year: { type: Number, min: 1950, max: 2100 },
  },
  { _id: false },
)

const hrProfileSchema = new Schema<HRProfileDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    headline: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    bio: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    specializations: {
      type: [String],
      enum: Object.values(SPECIALIZATIONS),
      validate: {
        validator: (values: string[]) => values.length > 0,
        message: 'At least one specialization is required',
      },
    },
    yearsOfExperience: {
      type: Number,
      required: true,
      min: 0,
      max: 70,
    },
    hourlyRateCents: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      required: true,
      default: 'USD',
    },
    languages: {
      type: [String],
      default: [],
    },
    city: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    country: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    profileImageUrl: {
      type: String,
      trim: true,
    },
    certifications: {
      type: [certificationSchema],
      default: [],
    },
    status: {
      type: String,
      enum: Object.values(PROFILE_STATUS),
      default: PROFILE_STATUS.DRAFT,
      index: true,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    ratingCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  },
)

hrProfileSchema.index({ specializations: 1 })
hrProfileSchema.index({ status: 1, rating: -1 })
hrProfileSchema.index({ status: 1, hourlyRateCents: 1 })
hrProfileSchema.index({ userId: 1 }, { unique: true })

export const HRProfile = mongoose.model<HRProfileDocument>('HRProfile', hrProfileSchema)
