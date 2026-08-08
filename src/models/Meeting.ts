import mongoose, { Schema } from 'mongoose'
import {
  MEETING_PROVIDERS,
  MEETING_STATUS,
  type MeetingProvider,
  type MeetingStatus,
} from '../config/constants.js'

export interface MeetingDocument extends mongoose.Document {
  id: string
  bookingId: mongoose.Types.ObjectId
  provider: MeetingProvider
  status: MeetingStatus
  externalMeetingId?: string
  externalCalendarId?: string
  meetingUrl?: string
  startTime: Date
  endTime: Date
  lastError?: string
  attempts: number
  createdAt: Date
  updatedAt: Date
}

const meetingSchema = new Schema<MeetingDocument>(
  {
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      unique: true,
    },
    provider: {
      type: String,
      enum: Object.values(MEETING_PROVIDERS),
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(MEETING_STATUS),
      default: MEETING_STATUS.PENDING,
      required: true,
    },
    externalMeetingId: {
      type: String,
    },
    externalCalendarId: {
      type: String,
    },
    meetingUrl: {
      type: String,
    },
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
      required: true,
    },
    lastError: {
      type: String,
      maxlength: 500,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  },
)

meetingSchema.index({ status: 1, startTime: 1 })

export const Meeting = mongoose.model<MeetingDocument>('Meeting', meetingSchema)
