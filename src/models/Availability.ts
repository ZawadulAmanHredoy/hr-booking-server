import mongoose, { Schema } from 'mongoose'
import { AVAILABILITY_DEFAULTS, SLOT_DURATIONS } from '../config/constants.js'

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export interface WorkingInterval {
  start: string
  end: string
}

export interface WorkingDay {
  weekday: number
  intervals: WorkingInterval[]
}

export interface BlockedDate {
  date: string
  startTime?: string
  endTime?: string
  reason?: string
}

export interface AvailabilityDocument extends mongoose.Document {
  id: string
  hrUserId: mongoose.Types.ObjectId
  timezone: string
  slotDurationMinutes: number
  bufferMinutes: number
  minNoticeMinutes: number
  maxAdvanceDays: number
  weeklyHours: WorkingDay[]
  blockedDates: BlockedDate[]
  createdAt: Date
  updatedAt: Date
}

const workingIntervalSchema = new Schema<WorkingInterval>(
  {
    start: { type: String, required: true, match: TIME_PATTERN },
    end: { type: String, required: true, match: TIME_PATTERN },
  },
  { _id: false },
)

const workingDaySchema = new Schema<WorkingDay>(
  {
    weekday: { type: Number, required: true, min: 0, max: 6 },
    intervals: { type: [workingIntervalSchema], default: [] },
  },
  { _id: false },
)

const blockedDateSchema = new Schema<BlockedDate>(
  {
    date: { type: String, required: true, match: DATE_PATTERN },
    startTime: { type: String, match: TIME_PATTERN },
    endTime: { type: String, match: TIME_PATTERN },
    reason: { type: String, trim: true, maxlength: 120 },
  },
  { _id: false },
)

const availabilitySchema = new Schema<AvailabilityDocument>(
  {
    hrUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    timezone: {
      type: String,
      required: true,
      default: AVAILABILITY_DEFAULTS.TIMEZONE,
    },
    slotDurationMinutes: {
      type: Number,
      required: true,
      enum: SLOT_DURATIONS,
      default: AVAILABILITY_DEFAULTS.SLOT_DURATION_MINUTES,
    },
    bufferMinutes: {
      type: Number,
      required: true,
      min: 0,
      max: 60,
      default: AVAILABILITY_DEFAULTS.BUFFER_MINUTES,
    },
    minNoticeMinutes: {
      type: Number,
      required: true,
      min: 0,
      default: AVAILABILITY_DEFAULTS.MIN_NOTICE_MINUTES,
    },
    maxAdvanceDays: {
      type: Number,
      required: true,
      min: 1,
      max: 180,
      default: AVAILABILITY_DEFAULTS.MAX_ADVANCE_DAYS,
    },
    weeklyHours: {
      type: [workingDaySchema],
      default: [],
    },
    blockedDates: {
      type: [blockedDateSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  },
)

export const Availability = mongoose.model<AvailabilityDocument>('Availability', availabilitySchema)
