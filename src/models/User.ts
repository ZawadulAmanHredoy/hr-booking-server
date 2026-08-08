import mongoose, { Schema } from 'mongoose'
import { USER_ROLES, USER_STATUS, type UserRole, type UserStatus } from '../config/constants.js'

export interface UserDocument extends mongoose.Document {
  id: string
  email: string
  password: string
  firstName: string
  lastName: string
  role: UserRole
  status: UserStatus
  isEmailVerified: boolean
  emailVerifiedAt?: Date
  phone?: string
  profileImageUrl?: string
  failedLoginAttempts: number
  lockedUntil?: Date
  createdAt: Date
  updatedAt: Date
}

const userSchema = new Schema<UserDocument>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    firstName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      default: USER_ROLES.USER,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(USER_STATUS),
      default: USER_STATUS.ACTIVE,
      index: true,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerifiedAt: {
      type: Date,
    },
    phone: {
      type: String,
      trim: true,
    },
    profileImageUrl: {
      type: String,
      trim: true,
    },
    failedLoginAttempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    lockedUntil: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
)

export const User = mongoose.model<UserDocument>('User', userSchema)
