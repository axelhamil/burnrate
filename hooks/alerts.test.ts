import { describe, expect, test } from 'claude-code/testing'

import { alertsFor, parseAlertState } from './alerts'
import type { Verdict, WindowInsight } from './insight'
import { HOUR_MS } from './pace'

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0)
const RESETS_AT = NOW + 2 * HOUR_MS
const KEY = `five_hour@${RESETS_AT}`
const MINUTE_MS = 60_000

function insight(verdict: Verdict, hitAt: number | null = null): WindowInsight {
  return {
    view: {
      kind: 'five_hour',
      key: KEY,
      pct: 80,
      resetsAt: RESETS_AT,
      secondsLeft: 7_200,
      elapsedPct: 60,
      basis: 'linear',
      analogSample: 0,
      projected: 120,
      projectionTone: 'alert',
      budget: null,
      today: null,
    },
    verdict,
    hitAt,
    size: null,
    days: [],
    spend: null,
    lastWeek: null,
  }
}

describe('alerts', () => {
  test('given a window stored at will_hit, when it eases to ahead, then the worse verdict is kept and nothing is toasted', () => {
    const alerts = alertsFor([insight('ahead')], { [KEY]: { verdict: 'will_hit', notified: false } }, NOW)

    expect(alerts.toasts).toEqual([])
    expect(alerts.state[KEY]?.verdict).toBe('will_hit')
  })

  test('given a window already notified, when it reaches its limit, then it is not notified again and stays notified', () => {
    const alerts = alertsFor([insight('limit')], { [KEY]: { verdict: 'will_hit', notified: true } }, NOW)

    expect(alerts.notices).toEqual([])
    expect(alerts.state[KEY]?.notified).toBe(true)
  })

  test('given a stored window whose reset has passed, when alerting, then it is pruned', () => {
    const expired = `five_hour@${NOW}`

    expect(Object.keys(alertsFor([], { [expired]: { verdict: 'ahead', notified: true } }, NOW).state)).toEqual([])
  })

  test('given a hit exactly 30 minutes away, when alerting, then a notice warns, and at 31 minutes it does not', () => {
    expect(alertsFor([insight('will_hit', NOW + 30 * MINUTE_MS)], {}, NOW).notices).toHaveLength(1)
    expect(alertsFor([insight('will_hit', NOW + 31 * MINUTE_MS)], {}, NOW).notices).toEqual([])
  })

  test('given a window at its limit, when alerting, then the notice says the limit is reached', () => {
    const [notice] = alertsFor([insight('limit')], {}, NOW).notices

    expect(notice?.text).toStartWith('5h limit reached, resets ')
  })

  test('given stored entries with an unknown verdict or a text flag, when parsing, then they are dropped', () => {
    const parsed = parseAlertState({
      a: { verdict: 'meh', notified: false },
      b: { verdict: 'ahead', notified: 'yes' },
      c: { verdict: 'ahead' },
      d: { verdict: 'ahead', notified: true },
    })

    expect(parsed).toEqual({ d: { verdict: 'ahead', notified: true } })
  })
})
