import { describe, expect, test } from 'claude-code/testing'

import { outlookOf, type PastWindow } from './outlook'

const HOUR = 3_600
const WEEK = 7 * 24 * HOUR

function traced(peak: number, elapsedSeconds: number, pct: number): PastWindow {
  return { peak, before: { elapsedSeconds, pct }, after: null }
}

function untraced(peak: number): PastWindow {
  return { peak, before: null, after: null }
}

describe('outlook', () => {
  test('given no closed window, when building the outlook, then there is none', () => {
    expect(outlookOf([], HOUR, WEEK)).toBeNull()
  })

  test('given equally peaking weeks, when building the outlook, then the typical week is their peak', () => {
    expect(outlookOf([untraced(90), untraced(90)], HOUR, WEEK)?.typical).toBe(90)
  })

  test('given recent weeks above older ones, when building the outlook, then the recent ones weigh more', () => {
    const typical = outlookOf([untraced(100), untraced(60)], HOUR, WEEK)?.typical ?? 0

    expect(typical > 80 && typical < 100).toBe(true)
  })

  test('given weeks without hourly samples, when building the outlook, then only the typical peak is known', () => {
    expect(outlookOf([untraced(95), untraced(95)], HOUR, WEEK)?.remaining).toBeNull()
  })

  test('given a single traced week, when building the outlook, then it is not enough to rely on', () => {
    expect(outlookOf([traced(90, HOUR, 20), untraced(95)], HOUR, WEEK)?.remaining).toBeNull()
  })

  test('given two weeks that both used 60 more points from this hour, when building the outlook, then 60 points are still to come', () => {
    const outlook = outlookOf([traced(80, HOUR, 20), traced(70, HOUR, 10)], HOUR, WEEK)

    expect([outlook?.remaining, outlook?.traced]).toEqual([60, 2])
  })

  test('given samples around this point, when building the outlook, then the use here is interpolated between them', () => {
    const around: PastWindow = { peak: 90, before: { elapsedSeconds: 0, pct: 10 }, after: { elapsedSeconds: 2 * HOUR, pct: 30 } }

    expect(outlookOf([around, around], HOUR, WEEK)?.remaining).toBe(70)
  })

  test('given a week sampled only after this point, when building the outlook, then its use here is drawn from zero at the start', () => {
    const lateTraced: PastWindow = { peak: 80, before: null, after: { elapsedSeconds: 2 * HOUR, pct: 40 } }

    expect(outlookOf([lateTraced, lateTraced], HOUR, WEEK)?.remaining).toBe(60)
  })

  test('given a week sampled only before this point, when building the outlook, then its use here is drawn up to the peak at reset', () => {
    const earlyTraced: PastWindow = { peak: 100, before: { elapsedSeconds: 0, pct: 0 }, after: null }

    expect(outlookOf([earlyTraced, earlyTraced], WEEK / 2, WEEK)?.remaining).toBe(50)
  })
})
