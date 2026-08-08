import { GOOGLE_OAUTH } from '../../config/constants.js'
import { GoogleApiError } from './google-oauth.client.js'

export interface CalendarAttendee {
  email: string
  displayName?: string
}

export interface CalendarEventInput {
  summary: string
  description?: string
  startAt: Date
  endAt: Date
  timeZone: string
  attendees: CalendarAttendee[]
  /** Stable per booking so a retried insert reuses the same conference. */
  conferenceRequestId: string
}

export interface CalendarEvent {
  id: string
  hangoutLink?: string
  htmlLink?: string
  status?: string
}

export async function createEvent(
  accessToken: string,
  calendarId: string,
  input: CalendarEventInput,
): Promise<CalendarEvent> {
  const url = buildUrl(calendarId, '', { conferenceDataVersion: '1', sendUpdates: 'all' })

  return request(url, accessToken, 'POST', {
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.startAt.toISOString(), timeZone: input.timeZone },
    end: { dateTime: input.endAt.toISOString(), timeZone: input.timeZone },
    attendees: input.attendees,
    conferenceData: {
      createRequest: {
        requestId: input.conferenceRequestId,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
  })
}

export async function patchEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  patch: { startAt: Date; endAt: Date; timeZone: string },
): Promise<CalendarEvent> {
  const url = buildUrl(calendarId, `/${encodeURIComponent(eventId)}`, { sendUpdates: 'all' })

  return request(url, accessToken, 'PATCH', {
    start: { dateTime: patch.startAt.toISOString(), timeZone: patch.timeZone },
    end: { dateTime: patch.endAt.toISOString(), timeZone: patch.timeZone },
  })
}

/** Treats "already gone" as success so cancellation is idempotent. */
export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const url = buildUrl(calendarId, `/${encodeURIComponent(eventId)}`, { sendUpdates: 'all' })

  const res = await fetch(url, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new GoogleApiError(await describeFailure(res), res.status)
  }
}

function buildUrl(calendarId: string, suffix: string, query: Record<string, string>): string {
  const url = new URL(
    `${GOOGLE_OAUTH.CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events${suffix}`,
  )
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

async function request(
  url: string,
  accessToken: string,
  method: 'POST' | 'PATCH',
  body: unknown,
): Promise<CalendarEvent> {
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    throw new GoogleApiError(await describeFailure(res), res.status)
  }

  const event = (await res.json()) as CalendarEvent
  if (!event.id) {
    throw new GoogleApiError('Google Calendar returned an event without an id.', 502)
  }
  return event
}

async function describeFailure(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string }
  } | null

  return body?.error?.message ?? `Google Calendar request failed with status ${res.status}.`
}
