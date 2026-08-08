import { MEETING_PROVIDERS } from '../../config/constants.js'
import { getGoogleAccess } from '../../services/oauth.service.js'
import { createEvent, deleteEvent, patchEvent } from '../google/google-calendar.client.js'
import type {
  CancelMeetingInput,
  CreateMeetingInput,
  MeetingDetails,
  MeetingProviderAdapter,
  UpdateMeetingInput,
} from './meeting-provider.js'

export const googleMeetProvider: MeetingProviderAdapter = {
  provider: MEETING_PROVIDERS.GOOGLE_MEET,

  async createMeeting(input: CreateMeetingInput): Promise<MeetingDetails> {
    const { accessToken, calendarId } = await getGoogleAccess(input.hostUserId)

    const event = await createEvent(accessToken, calendarId, {
      summary: input.title,
      description: input.description,
      startAt: input.startAt,
      endAt: input.endAt,
      timeZone: input.timeZone,
      attendees: input.attendees,
      // Keyed on the booking so a retry reuses the conference instead of creating a second one.
      conferenceRequestId: `booking-${input.bookingId}`,
    })

    return {
      externalMeetingId: event.id,
      externalCalendarId: calendarId,
      meetingUrl: event.hangoutLink,
    }
  },

  async updateMeeting(input: UpdateMeetingInput): Promise<MeetingDetails> {
    const { accessToken } = await getGoogleAccess(input.hostUserId)

    const event = await patchEvent(accessToken, input.externalCalendarId, input.externalMeetingId, {
      startAt: input.startAt,
      endAt: input.endAt,
      timeZone: input.timeZone,
    })

    return {
      externalMeetingId: event.id,
      externalCalendarId: input.externalCalendarId,
      meetingUrl: event.hangoutLink,
    }
  },

  async cancelMeeting(input: CancelMeetingInput): Promise<void> {
    const { accessToken } = await getGoogleAccess(input.hostUserId)
    await deleteEvent(accessToken, input.externalCalendarId, input.externalMeetingId)
  },
}
