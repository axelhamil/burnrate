import { describe, expect, test } from 'claude-code/testing'

import { DAY_MS, EMPTY_HISTORY, WEEK_MS, windowKey } from './pace'
import { lastWeekReport } from './report'

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0)
const RESETS_AT = NOW + 3 * DAY_MS

function historyClosedAt(closedAt: number, starts: Array<[string, number]>) {
  const key = windowKey('seven_day', closedAt)
  const dayStarts = starts.map(([date, pct], index) => [`${key}#${date}`, { windowKey: key, date, pct, seenAt: closedAt - (7 - index) * DAY_MS }])

  return { ...EMPTY_HISTORY, peaks: { [key]: { kind: 'seven_day', resetsAt: closedAt, peak: 60 } }, dayStarts: Object.fromEntries(dayStarts) }
}

describe('last week report', () => {
  test('given a week closed exactly 7 days ago, when reporting, then there is nothing to recap', () => {
    const closedAt = NOW - WEEK_MS

    expect(lastWeekReport(historyClosedAt(closedAt, []), RESETS_AT, NOW)).toBeNull()
  })

  test('given two days tied for the busiest, when reporting, then the first one is named', () => {
    const closedAt = RESETS_AT - WEEK_MS
    const history = historyClosedAt(closedAt, [
      ['2026-10-10', 0],
      ['2026-10-11', 30],
    ])

    expect(lastWeekReport(history, RESETS_AT, NOW)?.busiest).toEqual({ date: '2026-10-10', used: 30 })
  })
})
