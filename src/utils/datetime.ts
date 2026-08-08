import { DateTime } from 'luxon'

export const MINUTES_IN_DAY = 24 * 60

export function isValidTimezone(timezone: string): boolean {
  return DateTime.local().setZone(timezone).isValid
}

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':')
  return Number(hours) * 60 + Number(minutes)
}

export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

/** `YYYY-MM-DD` for an instant as seen in the given IANA zone. */
export function toDateKey(instant: Date, timezone: string): string {
  return DateTime.fromJSDate(instant, { zone: timezone }).toFormat('yyyy-MM-dd')
}

/** JS-style weekday (0 = Sunday) for a `YYYY-MM-DD` key in the given zone. */
export function weekdayOfDateKey(dateKey: string, timezone: string): number {
  return DateTime.fromISO(dateKey, { zone: timezone }).weekday % 7
}

/**
 * Resolve a wall-clock time in an IANA zone to a UTC instant. Luxon applies the zone's
 * real offset for that date, so DST transitions are handled without manual arithmetic.
 */
export function wallTimeToUtc(dateKey: string, minutes: number, timezone: string): Date | null {
  const dt = DateTime.fromISO(`${dateKey}T${minutesToTime(minutes % MINUTES_IN_DAY)}`, {
    zone: timezone,
  }).plus({ days: Math.floor(minutes / MINUTES_IN_DAY) })

  return dt.isValid ? dt.toUTC().toJSDate() : null
}

/** Inclusive list of `YYYY-MM-DD` keys covering the range as seen in the given zone. */
export function dateKeysBetween(from: Date, to: Date, timezone: string): string[] {
  const keys: string[] = []
  let cursor = DateTime.fromJSDate(from, { zone: timezone }).startOf('day')
  const last = DateTime.fromJSDate(to, { zone: timezone }).startOf('day')

  while (cursor <= last) {
    keys.push(cursor.toFormat('yyyy-MM-dd'))
    cursor = cursor.plus({ days: 1 })
  }

  return keys
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000)
}

export function addDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * MINUTES_IN_DAY * 60_000)
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart
}
