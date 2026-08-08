import { describe, expect, it } from 'vitest'
import { generateSlots, type SlotConfig } from '../src/services/slot.service.js'

const baseConfig: SlotConfig = {
  timezone: 'UTC',
  slotDurationMinutes: 30,
  bufferMinutes: 0,
  minNoticeMinutes: 0,
  maxAdvanceDays: 365,
  weeklyHours: [],
  blockedDates: [],
}

const everyDay = (start: string, end: string) =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, intervals: [{ start, end }] }))

function iso(slots: { startAt: Date }[]): string[] {
  return slots.map((slot) => slot.startAt.toISOString())
}

describe('generateSlots — working hours', () => {
  it('splits an interval into slots of the configured duration', () => {
    const slots = generateSlots(
      {
        ...baseConfig,
        weeklyHours: [{ weekday: 1, intervals: [{ start: '09:00', end: '11:00' }] }],
      },
      {
        rangeStart: new Date('2026-01-05T00:00:00Z'),
        rangeEnd: new Date('2026-01-06T00:00:00Z'),
        now: new Date('2026-01-01T00:00:00Z'),
        busy: [],
      },
    )

    expect(iso(slots)).toEqual([
      '2026-01-05T09:00:00.000Z',
      '2026-01-05T09:30:00.000Z',
      '2026-01-05T10:00:00.000Z',
      '2026-01-05T10:30:00.000Z',
    ])
  })

  it('skips weekdays without working hours', () => {
    const slots = generateSlots(
      {
        ...baseConfig,
        weeklyHours: [{ weekday: 1, intervals: [{ start: '09:00', end: '10:00' }] }],
      },
      {
        rangeStart: new Date('2026-01-06T00:00:00Z'),
        rangeEnd: new Date('2026-01-11T00:00:00Z'),
        now: new Date('2026-01-01T00:00:00Z'),
        busy: [],
      },
    )

    expect(slots).toHaveLength(0)
  })

  it('never lets a slot run past the end of its interval', () => {
    const slots = generateSlots(
      {
        ...baseConfig,
        slotDurationMinutes: 45,
        weeklyHours: [{ weekday: 1, intervals: [{ start: '09:00', end: '10:00' }] }],
      },
      {
        rangeStart: new Date('2026-01-05T00:00:00Z'),
        rangeEnd: new Date('2026-01-06T00:00:00Z'),
        now: new Date('2026-01-01T00:00:00Z'),
        busy: [],
      },
    )

    expect(iso(slots)).toEqual(['2026-01-05T09:00:00.000Z'])
  })

  it('adds the buffer between consecutive slots', () => {
    const slots = generateSlots(
      {
        ...baseConfig,
        bufferMinutes: 15,
        weeklyHours: [{ weekday: 1, intervals: [{ start: '09:00', end: '11:00' }] }],
      },
      {
        rangeStart: new Date('2026-01-05T00:00:00Z'),
        rangeEnd: new Date('2026-01-06T00:00:00Z'),
        now: new Date('2026-01-01T00:00:00Z'),
        busy: [],
      },
    )

    expect(iso(slots)).toEqual([
      '2026-01-05T09:00:00.000Z',
      '2026-01-05T09:45:00.000Z',
      '2026-01-05T10:30:00.000Z',
    ])
  })

  it('supports multiple intervals in a day', () => {
    const slots = generateSlots(
      {
        ...baseConfig,
        slotDurationMinutes: 60,
        weeklyHours: [
          {
            weekday: 1,
            intervals: [
              { start: '09:00', end: '10:00' },
              { start: '14:00', end: '15:00' },
            ],
          },
        ],
      },
      {
        rangeStart: new Date('2026-01-05T00:00:00Z'),
        rangeEnd: new Date('2026-01-06T00:00:00Z'),
        now: new Date('2026-01-01T00:00:00Z'),
        busy: [],
      },
    )

    expect(iso(slots)).toEqual(['2026-01-05T09:00:00.000Z', '2026-01-05T14:00:00.000Z'])
  })
})

describe('generateSlots — timezones', () => {
  it('resolves working hours against the consultant timezone', () => {
    const slots = generateSlots(
      {
        ...baseConfig,
        timezone: 'Asia/Dhaka',
        weeklyHours: [{ weekday: 1, intervals: [{ start: '09:00', end: '10:00' }] }],
      },
      {
        rangeStart: new Date('2026-01-05T00:00:00Z'),
        rangeEnd: new Date('2026-01-06T00:00:00Z'),
        now: new Date('2026-01-01T00:00:00Z'),
        busy: [],
      },
    )

    expect(iso(slots)).toEqual(['2026-01-05T03:00:00.000Z', '2026-01-05T03:30:00.000Z'])
  })

  it('follows the DST offset change instead of a fixed offset', () => {
    const slots = generateSlots(
      {
        ...baseConfig,
        timezone: 'America/New_York',
        slotDurationMinutes: 60,
        weeklyHours: everyDay('09:00', '10:00'),
      },
      {
        rangeStart: new Date('2026-10-31T00:00:00Z'),
        rangeEnd: new Date('2026-11-03T00:00:00Z'),
        now: new Date('2026-10-01T00:00:00Z'),
        busy: [],
      },
    )

    // 09:00 local is 13:00Z under EDT and 14:00Z after the 1 Nov 2026 switch to EST.
    expect(iso(slots)).toEqual([
      '2026-10-31T13:00:00.000Z',
      '2026-11-01T14:00:00.000Z',
      '2026-11-02T14:00:00.000Z',
    ])
  })

  it('does not emit duplicate instants across a spring-forward gap', () => {
    const slots = generateSlots(
      {
        ...baseConfig,
        timezone: 'America/New_York',
        weeklyHours: everyDay('01:00', '04:00'),
      },
      {
        rangeStart: new Date('2026-03-08T00:00:00Z'),
        rangeEnd: new Date('2026-03-08T12:00:00Z'),
        now: new Date('2026-03-01T00:00:00Z'),
        busy: [],
      },
    )

    expect(iso(slots)).toEqual([
      '2026-03-08T06:00:00.000Z',
      '2026-03-08T06:30:00.000Z',
      '2026-03-08T07:00:00.000Z',
      '2026-03-08T07:30:00.000Z',
    ])
  })
})

describe('generateSlots — exclusions', () => {
  const config: SlotConfig = {
    ...baseConfig,
    weeklyHours: [{ weekday: 1, intervals: [{ start: '09:00', end: '11:00' }] }],
  }
  const range = {
    rangeStart: new Date('2026-01-05T00:00:00Z'),
    rangeEnd: new Date('2026-01-06T00:00:00Z'),
    now: new Date('2026-01-01T00:00:00Z'),
    busy: [],
  }

  it('drops every slot on a full-day block', () => {
    const slots = generateSlots(
      { ...config, blockedDates: [{ date: '2026-01-05', reason: 'Public holiday' }] },
      range,
    )

    expect(slots).toHaveLength(0)
  })

  it('drops only the overlapping slots of a partial block', () => {
    const slots = generateSlots(
      { ...config, blockedDates: [{ date: '2026-01-05', startTime: '09:15', endTime: '10:00' }] },
      range,
    )

    expect(iso(slots)).toEqual(['2026-01-05T10:00:00.000Z', '2026-01-05T10:30:00.000Z'])
  })

  it('drops slots that overlap an existing booking', () => {
    const slots = generateSlots(config, {
      ...range,
      busy: [
        {
          startAt: new Date('2026-01-05T09:30:00Z'),
          endAt: new Date('2026-01-05T10:00:00Z'),
        },
      ],
    })

    expect(iso(slots)).toEqual([
      '2026-01-05T09:00:00.000Z',
      '2026-01-05T10:00:00.000Z',
      '2026-01-05T10:30:00.000Z',
    ])
  })

  it('honours the minimum notice period', () => {
    const slots = generateSlots(
      { ...config, minNoticeMinutes: 24 * 60 },
      { ...range, now: new Date('2026-01-05T00:00:00Z') },
    )

    expect(slots).toHaveLength(0)
  })

  it('honours the booking horizon', () => {
    const slots = generateSlots(
      { ...config, maxAdvanceDays: 2 },
      { ...range, now: new Date('2026-01-01T00:00:00Z') },
    )

    expect(slots).toHaveLength(0)
  })
})
