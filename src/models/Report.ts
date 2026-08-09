import mongoose, { Schema } from 'mongoose'
import {
  ADMIN_LIMITS,
  REPORT_REASONS,
  REPORT_STATUS,
  type ReportReason,
  type ReportStatus,
} from '../config/constants.js'

export interface ReportDocument extends mongoose.Document {
  id: string
  reporterId: mongoose.Types.ObjectId
  hrProfileId: mongoose.Types.ObjectId
  hrUserId: mongoose.Types.ObjectId
  reason: ReportReason
  details?: string
  status: ReportStatus
  resolvedBy?: mongoose.Types.ObjectId
  resolvedAt?: Date
  resolutionNotes?: string
  createdAt: Date
  updatedAt: Date
}

const reportSchema = new Schema<ReportDocument>(
  {
    reporterId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    hrProfileId: {
      type: Schema.Types.ObjectId,
      ref: 'HRProfile',
      required: true,
      index: true,
    },
    hrUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reason: {
      type: String,
      enum: Object.values(REPORT_REASONS),
      required: true,
    },
    details: {
      type: String,
      trim: true,
      maxlength: ADMIN_LIMITS.REPORT_DETAILS_MAX,
    },
    status: {
      type: String,
      enum: Object.values(REPORT_STATUS),
      default: REPORT_STATUS.PENDING,
      index: true,
    },
    resolvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    resolvedAt: {
      type: Date,
    },
    resolutionNotes: {
      type: String,
      trim: true,
      maxlength: ADMIN_LIMITS.RESOLUTION_NOTES_MAX,
    },
  },
  {
    timestamps: true,
  },
)

reportSchema.index({ status: 1, createdAt: -1 })
reportSchema.index({ hrProfileId: 1, status: 1 })

export const Report = mongoose.model<ReportDocument>('Report', reportSchema)
