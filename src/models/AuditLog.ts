import mongoose, { Schema } from 'mongoose'
import type { AuditAction, AuditResourceType } from '../config/constants.js'

export interface AuditLogDocument extends mongoose.Document {
  id: string
  actorId: mongoose.Types.ObjectId
  actorRole: string
  action: AuditAction
  resourceType?: AuditResourceType
  resourceId?: string
  metadata?: Record<string, unknown>
  createdAt: Date
}

const auditLogSchema = new Schema<AuditLogDocument>(
  {
    actorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    actorRole: {
      type: String,
      required: true,
    },
    action: {
      type: String,
      required: true,
      index: true,
    },
    resourceType: {
      type: String,
    },
    resourceId: {
      type: String,
    },
    metadata: {
      type: Schema.Types.Mixed,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
)

auditLogSchema.index({ createdAt: -1 })
auditLogSchema.index({ action: 1, createdAt: -1 })

export const AuditLog = mongoose.model<AuditLogDocument>('AuditLog', auditLogSchema)
