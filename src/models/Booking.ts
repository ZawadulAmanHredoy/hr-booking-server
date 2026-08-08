import mongoose, { Schema } from 'mongoose'
import {
  BOOKING_STATUS,
  CANCELLED_BY,
  MEETING_PROVIDERS,
  type BookingStatus,
  type CancelledBy,
  type Currency,
  type MeetingProvider,
} from '../config/constants.js'

export interface BookingDocument extends mongoose.Document {
  id: string
  userId: mongoose.Types.ObjectId
  hrUserId: mongoose.Types.ObjectId
  hrProfileId: mongoose.Types.ObjectId
  startAt: Date
  endAt: Date
  durationMinutes: number
  hrTimezone: string
  userTimezone: string
  status: BookingStatus
  priceCents: number
  currency: Currency
  meetingProvider: MeetingProvider
  notes?: string
  slotKey?: string
  cancelledAt?: Date
  cancelledBy?: CancelledBy
  cancellationReason?: string
  previousStartAt?: Date
  rescheduleCount: number
  createdAt: Date
  updatedAt: Date
}

/**
 * Identity of an occupied slot. Present only while a booking is active, which lets the
 * sparse unique index reject a second booking for the same consultant and start time.
 */
export function buildSlotKey(hrUserId: mongoose.Types.ObjectId | string, startAt: Date): string {
  return `${String(hrUserId)}:${startAt.toISOString()}`
}

const bookingSchema = new Schema<BookingDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    hrUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    hrProfileId: {
      type: Schema.Types.ObjectId,
      ref: 'HRProfile',
      required: true,
    },
    startAt: {
      type: Date,
      required: true,
    },
    endAt: {
      type: Date,
      required: true,
    },
    durationMinutes: {
      type: Number,
      required: true,
      min: 1,
    },
    hrTimezone: {
      type: String,
      required: true,
    },
    userTimezone: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(BOOKING_STATUS),
      default: BOOKING_STATUS.CONFIRMED,
      required: true,
    },
    priceCents: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      required: true,
    },
    meetingProvider: {
      type: String,
      enum: Object.values(MEETING_PROVIDERS),
      default: MEETING_PROVIDERS.GOOGLE_MEET,
      required: true,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    slotKey: {
      type: String,
    },
    cancelledAt: {
      type: Date,
    },
    cancelledBy: {
      type: String,
      enum: Object.values(CANCELLED_BY),
    },
    cancellationReason: {
      type: String,
      trim: true,
      maxlength: 300,
    },
    previousStartAt: {
      type: Date,
    },
    rescheduleCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  },
)

bookingSchema.index({ slotKey: 1 }, { unique: true, sparse: true })
bookingSchema.index({ userId: 1, startAt: -1 })
bookingSchema.index({ hrUserId: 1, startAt: 1 })
bookingSchema.index({ hrUserId: 1, status: 1, startAt: 1 })
bookingSchema.index({ status: 1, startAt: 1 })

export const Booking = mongoose.model<BookingDocument>('Booking', bookingSchema)
