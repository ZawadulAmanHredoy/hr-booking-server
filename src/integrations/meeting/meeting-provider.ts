import type { MeetingProvider } from '../../config/constants.js'

export interface MeetingAttendee {
  email: string
  displayName?: string
}

export interface CreateMeetingInput {
  bookingId: string
  hostUserId: string
  title: string
  description?: string
  startAt: Date
  endAt: Date
  timeZone: string
  attendees: MeetingAttendee[]
}

export interface UpdateMeetingInput {
  hostUserId: string
  externalMeetingId: string
  externalCalendarId: string
  startAt: Date
  endAt: Date
  timeZone: string
}

export interface CancelMeetingInput {
  hostUserId: string
  externalMeetingId: string
  externalCalendarId: string
}

export interface MeetingDetails {
  externalMeetingId: string
  externalCalendarId: string
  meetingUrl?: string
}

/**
 * Every conferencing integration sits behind this interface, so the booking flow never talks to
 * a vendor SDK directly and a new provider is a registry entry rather than a rewrite.
 */
export interface MeetingProviderAdapter {
  readonly provider: MeetingProvider
  createMeeting(input: CreateMeetingInput): Promise<MeetingDetails>
  updateMeeting(input: UpdateMeetingInput): Promise<MeetingDetails>
  cancelMeeting(input: CancelMeetingInput): Promise<void>
}
