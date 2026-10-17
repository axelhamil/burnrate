import { describe, expect, test } from 'claude-code/testing'

import type { BurnrateHistory } from '../types'
import {
  budgetLeft,
  dailyUsage,
  describeWindow,
  EMPTY_HISTORY,
  outlookFor,
  parseHistory,
  projectAtReset,
  recordReadings,
  todayUsage,
  windowKey,
} from './pace'

const DAY = 86_400
const WEEK = 7 * DAY
const HOUR_MS = 3_600_000
const NOW = Date.UTC(2026, 9, 17, 12, 0, 0)

function weekReading(percentUsed: number, resetsAtMs: number) {
  return { kind: 'seven_day', percentUsed, resetsAt: new Date(resetsAtMs).toISOString() }
}

function closedWeeks(peaks: number[], currentResetsAt: number): BurnrateHistory {
  const entries = peaks.map((peak, index) => {
    const resetsAt = currentResetsAt - (index + 1) * WEEK * 1_000
    return [windowKey('seven_day', resetsAt), { kind: 'seven_day', resetsAt, peak }] as const
  })

  return { ...EMPTY_HISTORY, peaks: Object.fromEntries(entries) }
}

describe('projection at reset', () => {
  test('given past weeks used 30 more points from this point, when projecting at 40%, then it lands at 70', () => {
    const outlook = { typical: 90, remaining: 30, traced: 2 }

    expect(projectAtReset({ pct: 40, secondsLeft: WEEK / 2, windowSeconds: WEEK, outlook })).toBe(70)
  })

  test('given no history and half a week elapsed at 60%, when projecting, then it is linear at 120', () => {
    expect(projectAtReset({ pct: 60, secondsLeft: WEEK / 2, windowSeconds: WEEK, outlook: null })).toBe(120)
  })

  test('given no history and under 10% of the window elapsed, when projecting, then there is no projection', () => {
    expect(projectAtReset({ pct: 3, secondsLeft: 6.9 * DAY, windowSeconds: WEEK, outlook: null })).toBeNull()
  })

  test('given a typical peak of 60 and 14% used with 6.2 days left, when projecting, then it blends to 73', () => {
    expect(projectAtReset({ pct: 14, secondsLeft: 6.2 * DAY, windowSeconds: WEEK, outlook: { typical: 60, remaining: null, traced: 0 } })).toBe(73)
  })

  test('given a typical peak of 80 at the window start, when projecting, then it is the typical peak', () => {
    expect(projectAtReset({ pct: 0, secondsLeft: WEEK, windowSeconds: WEEK, outlook: { typical: 80, remaining: null, traced: 0 } })).toBe(80)
  })

  test('given 90% used with a minute left, when projecting, then it stays at the current use', () => {
    expect(projectAtReset({ pct: 90, secondsLeft: 60, windowSeconds: WEEK, outlook: { typical: 40, remaining: null, traced: 0 } })).toBe(90)
  })

  test('given 70% used at half week and a typical peak of 60, when projecting, then it reaches 120', () => {
    expect(projectAtReset({ pct: 70, secondsLeft: WEEK / 2, windowSeconds: WEEK, outlook: { typical: 60, remaining: null, traced: 0 } })).toBe(120)
  })
})

describe('outlook from history', () => {
  test('given seven closed weeks, when building the outlook, then only the last six count', () => {
    const resetsAt = NOW + 3 * DAY * 1_000
    const history = closedWeeks([60, 60, 60, 60, 60, 60, 0], resetsAt)

    expect(Math.round(outlookFor(history, 'seven_day', resetsAt, 4 * DAY)?.typical ?? 0)).toBe(60)
  })

  test('given two closed weeks with hourly samples around this offset, when building the outlook, then the remaining use is interpolated', () => {
    const resetsAt = NOW + 3 * DAY * 1_000
    const history = closedWeeks([90, 90], resetsAt)
    const hours = Object.values(history.peaks).flatMap(peak => {
      const key = windowKey('seven_day', peak.resetsAt)
      const startHour = (peak.resetsAt - WEEK * 1_000) / HOUR_MS

      return [
        { windowKey: key, hour: startHour + 9, pct: 10 },
        { windowKey: key, hour: startHour + 11, pct: 30 },
      ]
    })
    const traced = { ...history, hours: Object.fromEntries(hours.map(sample => [`${sample.windowKey}#${sample.hour}`, sample])) }

    expect(outlookFor(traced, 'seven_day', resetsAt, 11 * 3_600)?.remaining).toBe(70)
  })

  test('given a peak and an hourly sample 45 days old, when recording, then both are kept for the outlook', () => {
    const old = NOW - 45 * DAY * 1_000
    const key = windowKey('seven_day', old)
    const history: BurnrateHistory = {
      peaks: { [key]: { kind: 'seven_day', resetsAt: old, peak: 70 } },
      dayStarts: {},
      hours: { [`${key}#${old / HOUR_MS}`]: { windowKey: key, hour: old / HOUR_MS, pct: 70 } },
    }

    const recorded = recordReadings(history, [weekReading(10, NOW + DAY * 1_000)], NOW, '2026-10-17')

    expect([Object.keys(recorded.peaks).length, Object.keys(recorded.hours).length]).toEqual([2, 2])
  })
})

describe('recording readings', () => {
  test('given reset times jittering by a second, when recording, then they share one window peak', () => {
    const resetsAt = Date.UTC(2026, 9, 20, 10, 0, 0)
    const first = recordReadings(EMPTY_HISTORY, [weekReading(20, resetsAt - 1_000)], NOW, '2026-10-17')
    const second = recordReadings(first, [weekReading(25, resetsAt + 1_000)], NOW + 60_000, '2026-10-17')

    expect(Object.values(second.peaks)).toEqual([{ kind: 'seven_day', resetsAt, peak: 25 }])
  })

  test('given a lower reading later in the window, when recording, then the peak is kept', () => {
    const resetsAt = NOW + DAY * 1_000
    const first = recordReadings(EMPTY_HISTORY, [weekReading(40, resetsAt)], NOW, '2026-10-17')
    const second = recordReadings(first, [weekReading(10, resetsAt)], NOW + 60_000, '2026-10-17')

    expect(Object.values(second.peaks).map(peak => peak.peak)).toEqual([40])
  })

  test('given two readings on one day, when recording, then the day start is the first one', () => {
    const resetsAt = NOW + 3 * DAY * 1_000
    const first = recordReadings(EMPTY_HISTORY, [weekReading(30, resetsAt)], NOW, '2026-10-17')
    const second = recordReadings(first, [weekReading(36, resetsAt)], NOW + HOUR_MS, '2026-10-17')

    expect(Object.values(second.dayStarts)).toEqual([
      { windowKey: windowKey('seven_day', resetsAt), date: '2026-10-17', pct: 30, seenAt: NOW },
    ])
  })

  test('given readings in one hour then the next, when recording, then each hour keeps its max', () => {
    const resetsAt = NOW + 3 * DAY * 1_000
    const hourStart = Math.floor(NOW / HOUR_MS) * HOUR_MS
    const readings: Array<[number, number]> = [
      [30, hourStart + 60_000],
      [34, hourStart + 30 * 60_000],
      [32, hourStart + 59 * 60_000],
      [35, hourStart + HOUR_MS + 60_000],
    ]
    const history = readings.reduce(
      (current, [pct, at]) => recordReadings(current, [weekReading(pct, resetsAt)], at, '2026-10-17'),
      EMPTY_HISTORY,
    )
    const samples = Object.values(history.hours).map(sample => [sample.hour - hourStart / HOUR_MS, sample.pct])

    expect(samples).toEqual([
      [0, 34],
      [1, 35],
    ])
  })

  test('given entries older than their retention, when recording, then they are dropped', () => {
    const old = NOW - 60 * DAY * 1_000
    const aged = recordReadings(EMPTY_HISTORY, [weekReading(50, old + DAY * 1_000)], old, '2026-08-18')
    const fresh = recordReadings(aged, [weekReading(5, NOW + DAY * 1_000)], NOW, '2026-10-17')

    expect(Object.keys(fresh.peaks)).toHaveLength(1)
    expect(Object.keys(fresh.dayStarts)).toHaveLength(1)
    expect(Object.keys(fresh.hours)).toHaveLength(1)
  })

  test('given a malformed stored value, when parsing, then bad entries are dropped', () => {
    const parsed = parseHistory({ peaks: { a: { kind: 'seven_day', resetsAt: 1, peak: 'x' } }, dayStarts: 3 })

    expect(parsed).toEqual(EMPTY_HISTORY)
  })
})

describe('window view', () => {
  test('given a reading whose reset time has passed, when describing it, then it is dropped', () => {
    expect(describeWindow(weekReading(100, NOW - 60_000), EMPTY_HISTORY, NOW, '2026-10-17')).toBeNull()
  })
})

describe('budget left', () => {
  test('given 7d at the even pace, when budgeting, then it is dim', () => {
    const budget = budgetLeft('seven_day', 50, 3.5 * DAY)

    expect(Math.round((budget?.value ?? 0) * 100) / 100).toBe(14.29)
    expect(budget?.tone).toBe('dim')
  })

  test('given 5h with 70% of the even pace left, when budgeting, then it warns', () => {
    expect(budgetLeft('five_hour', 72, 2 * 3_600)?.tone).toBe('warn')
  })

  test('given 7d with under half the even pace left, when budgeting, then it alerts', () => {
    expect(budgetLeft('seven_day', 80, 4 * DAY)?.tone).toBe('alert')
  })
})

describe('daily usage', () => {
  test('given three day starts, when listing days, then each day is the gap to the next start', () => {
    const resetsAt = NOW + 3 * DAY * 1_000
    const days: Array<[number, string]> = [
      [10, '2026-10-15'],
      [25, '2026-10-16'],
      [31, '2026-10-17'],
    ]
    const history = days.reduce(
      (current, [pct, date], index) =>
        recordReadings(current, [weekReading(pct, resetsAt)], NOW - (2 - index) * DAY * 1_000, date),
      EMPTY_HISTORY,
    )

    expect(dailyUsage(history, windowKey('seven_day', resetsAt), 40)).toEqual([
      { date: '2026-10-15', used: 15 },
      { date: '2026-10-16', used: 6 },
      { date: '2026-10-17', used: 9 },
    ])
  })
})

describe('today', () => {
  const start = { windowKey: 'w', date: '2026-10-17', pct: 30, seenAt: NOW }
  const resetsAt = NOW + 5 * DAY * 1_000

  test('given 70% at the day start with half a day left, when budgeting today, then it is capped at the 30 points left', () => {
    const today = todayUsage(70, { ...start, pct: 70 }, NOW + 0.5 * DAY * 1_000)

    expect(today?.budget).toBe(30)
  })

  test('given 30% at the day start with 5 days left, when 10 points are used, then the budget is 14 and it is fine', () => {
    const today = todayUsage(40, start, resetsAt)

    expect(today?.used).toBe(10)
    expect(today?.budget).toBe(14)
    expect(today?.tone).toBe('dim')
  })

  test('given today over 85% of its budget, when measuring, then it warns', () => {
    expect(todayUsage(43, start, resetsAt)?.tone).toBe('warn')
  })

  test('given today over its budget, when measuring, then it alerts', () => {
    expect(todayUsage(45, start, resetsAt)?.tone).toBe('alert')
  })
})
