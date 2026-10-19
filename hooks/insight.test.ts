import { describe, expect, test } from 'claude-code/testing'

import type { BurnrateReading, BurnrateSnapshot } from '../types'
import { insightsOf, verdictOf } from './insight'
import { DAY_MS, EMPTY_HISTORY, HOUR_MS, type WindowView } from './pace'

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0)

function view(pct: number, projected: number | null, ratio: number | null): WindowView {
  return {
    kind: 'seven_day',
    key: 'seven_day@0',
    pct,
    resetsAt: NOW + DAY_MS,
    secondsLeft: 86_400,
    elapsedPct: 50,
    basis: 'linear',
    analogSample: 0,
    projected,
    projectionTone: 'normal',
    budget: ratio === null ? null : { value: 10, unit: 'd', ratio, tone: 'dim' },
    today: null,
  }
}

function snapshot(readings: BurnrateReading[]): BurnrateSnapshot {
  return { readings, history: EMPTY_HISTORY, costs: {}, sessions: [], sessionId: '', model: '', now: NOW }
}

function reading(kind: string, percentUsed: number, resetsAt: number): BurnrateReading {
  return { kind, percentUsed, resetsAt: new Date(resetsAt).toISOString() }
}

describe('verdict', () => {
  test('given 100% used, when judging, then the limit is reached', () => {
    expect(verdictOf(view(100, null, null))).toBe('limit')
  })

  test('given a projection a fraction above 100, when judging, then it will hit the limit', () => {
    expect(verdictOf(view(50, 100.4, 1))).toBe('will_hit')
  })

  test('given a budget at exactly 85% of the even pace, when judging, then it is on track, and just under it is ahead', () => {
    expect(verdictOf(view(50, 90, 0.85))).toBe('on_track')
    expect(verdictOf(view(50, 90, 0.849))).toBe('ahead')
  })

  test('given a budget at exactly 115% of the even pace, when judging, then a projection of 85 has room and 86 is on track', () => {
    expect(verdictOf(view(30, 85, 1.15))).toBe('room')
    expect(verdictOf(view(30, 86, 1.15))).toBe('on_track')
    expect(verdictOf(view(30, 85, 1.149))).toBe('on_track')
  })
})

describe('insights', () => {
  test('given a 5h reading listed before the 7d one, when building insights, then the 7d window comes first', () => {
    const insights = insightsOf(snapshot([reading('five_hour', 10, NOW + HOUR_MS), reading('seven_day', 10, NOW + DAY_MS)]))

    expect(insights.map(insight => insight.view.kind)).toEqual(['seven_day', 'five_hour'])
  })

  test('given 70% of a 5h window used with 2 hours left, when timing the hit, then it follows the unrounded pace', () => {
    const [insight] = insightsOf(snapshot([reading('five_hour', 70, NOW + 2 * HOUR_MS)]))
    const secondsToHit = ((insight?.hitAt ?? NOW) - NOW) / 1_000

    expect(Math.round(secondsToHit)).toBe(4629)
  })
})
