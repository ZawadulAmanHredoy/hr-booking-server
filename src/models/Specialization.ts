import mongoose, { Schema } from 'mongoose'
import { SPECIALIZATION_LIMITS } from '../config/constants.js'

export interface SpecializationDocument extends mongoose.Document {
  id: string
  slug: string
  name: string
  description?: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

const specializationSchema = new Schema<SpecializationDocument>(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      maxlength: 60,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: SPECIALIZATION_LIMITS.NAME_MAX,
    },
    description: {
      type: String,
      trim: true,
      maxlength: SPECIALIZATION_LIMITS.DESCRIPTION_MAX,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
)

export const Specialization = mongoose.model<SpecializationDocument>(
  'Specialization',
  specializationSchema,
)
