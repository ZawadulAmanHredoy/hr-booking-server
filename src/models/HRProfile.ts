import mongoose, { Schema } from 'mongoose'
import {
  ADMIN_LIMITS,
  PROFILE_STATUS,
  type Currency,
  type ProfileStatus,
} from '../config/constants.js'

export interface Certification {
  name: string
  issuer?: string
  year?: number
}

export interface WorkHistoryEntry {
  company: string
  role: string
  startYear: number
  endYear?: number
  description?: string
}

export interface HRProfileDocument extends mongoose.Document {
  id: string
  userId: mongoose.Types.ObjectId
  headline: string
  bio: string
  specializations: string[]
  yearsOfExperience: number
  companyName?: string
  hourlyRateCents: number
  currency: Currency
  languages: string[]
  city?: string
  country?: string
  profileImageUrl?: string
  certifications: Certification[]
  workHistory: WorkHistoryEntry[]
  status: ProfileStatus
  rejectionReason?: string
  reviewedBy?: mongoose.Types.ObjectId
  reviewedAt?: Date
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

const workHistorySchema = new Schema<WorkHistoryEntry>(
  {
    company: { type: String, required: true, trim: true, maxlength: 150 },
    role: { type: String, required: true, trim: true, maxlength: 150 },
    startYear: { type: Number, required: true, min: 1950, max: 2100 },
    endYear: { type: Number, min: 1950, max: 2100 },
    description: { type: String, trim: true, maxlength: 300 },
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
    // Specialization slugs are validated against the `Specialization` collection at the service
    // layer (dynamic, admin-managed), not via a static Mongoose enum.
    specializations: {
      type: [String],
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
    companyName: {
      type: String,
      trim: true,
      maxlength: 150,
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
    workHistory: {
      type: [workHistorySchema],
      default: [],
    },
    status: {
      type: String,
      enum: Object.values(PROFILE_STATUS),
      default: PROFILE_STATUS.DRAFT,
      index: true,
    },
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: ADMIN_LIMITS.REJECTION_REASON_MAX,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    reviewedAt: {
      type: Date,
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

export const HRProfile = mongoose.model<HRProfileDocument>('HRProfile', hrProfileSchema)
