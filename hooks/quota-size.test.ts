import { describe, expect, test } from 'claude-code/testing'

import type { WindowRatio } from './quota-size'
import { detectQuotaChange, mergeCosts, recordCost, windowRatio, windowRatios } from './quota-size'

const KEY = 'seven_day@1800000000000'

function samples(points: Array<[number, number]>) {
  return points.map(([hour, pct]) => ({ windowKey: KEY, hour, pct }))
}

function ratio(resetsAt: number, usdPerPoint: number | null): WindowRatio {
  return { windowKey: `seven_day@${resetsAt}`, resetsAt, usd: 0, points: 0, usdPerPoint }
}

describe('dollars per point', () => {
  test('given $12 spent over 6 points gained, when measuring the window, then 1% costs $2', () => {
    const result = windowRatio(KEY, samples([[10, 4], [11, 7], [13, 10]]), { 11: 5, 12: 3, 13: 4 })

    expect(result?.points).toBe(6)
    expect(result?.usdPerPoint).toBe(2)
  })

  test('given only 4 points gained, when measuring the window, then there is no ratio yet', () => {
    const result = windowRatio(KEY, samples([[10, 4], [11, 8]]), { 11: 20 })

    expect(result?.usd).toBe(20)
    expect(result?.usdPerPoint).toBeNull()
  })

  test('given an hour where the percentage dropped, when measuring the window, then its spend is left out', () => {
    const result = windowRatio(KEY, samples([[10, 10], [11, 4], [12, 14]]), { 11: 50, 12: 30 })

    expect(result?.points).toBe(10)
    expect(result?.usdPerPoint).toBe(3)
  })

  test('given samples of two kinds and two windows, when listing ratios, then each 7d window is measured apart in reset order', () => {
    const hours = {
      a: { windowKey: 'seven_day@2000', hour: 1, pct: 0 },
      b: { windowKey: 'seven_day@2000', hour: 2, pct: 5 },
      c: { windowKey: 'seven_day@1000', hour: 0, pct: 0 },
      d: { windowKey: 'five_hour@1000', hour: 0, pct: 0 },
    }

    expect(windowRatios(hours, { 2: 10 }, 'seven_day', 0).map(one => [one.resetsAt, one.usdPerPoint])).toEqual([
      [1000, null],
      [2000, 2],
    ])
  })

  test('given a window that started before the cost retention, when listing ratios, then it is left out so missing costs cannot read as a cheap window', () => {
    const now = Date.UTC(2026, 9, 17, 12)
    const hourOf = (ms: number) => Math.floor(ms / 3_600_000)
    const windowSamples = (resetsAt: number) => {
      const key = `seven_day@${resetsAt}`
      const end = hourOf(resetsAt)

      return [
        { windowKey: key, hour: end - 10, pct: 0 },
        { windowKey: key, hour: end - 9, pct: 10 },
      ]
    }
    const old = now - 43 * 86_400_000
    const recent = now - 86_400_000
    const hours = Object.fromEntries([...windowSamples(old), ...windowSamples(recent)].map(one => [`${one.windowKey}#${one.hour}`, one]))

    expect(windowRatios(hours, {}, 'seven_day', now).map(one => one.resetsAt)).toEqual([recent])
  })
})

describe('quota change', () => {
  const usual = [ratio(1, 2), ratio(2, 2.1), ratio(3, 1.9)]

  test('given the current and previous windows costing 30% more per point, when comparing, then the quota is up', () => {
    const ratios = [...usual, ratio(4, 2.6), ratio(5, 2.6)]

    expect(detectQuotaChange(ratios, 'seven_day@5')).toEqual({ direction: 'up', percent: 30 })
  })

  test('given the current and previous windows costing 40% less per point, when comparing, then the quota is down', () => {
    const ratios = [...usual, ratio(4, 1.2), ratio(5, 1.2)]

    expect(detectQuotaChange(ratios, 'seven_day@5')).toEqual({ direction: 'down', percent: 40 })
  })

  test('given a deviation under 20%, when comparing, then nothing is reported', () => {
    const ratios = [...usual, ratio(4, 2.3), ratio(5, 2.3)]

    expect(detectQuotaChange(ratios, 'seven_day@5')).toBeNull()
  })

  test('given only the current window deviating, when comparing, then nothing is reported', () => {
    const ratios = [...usual, ratio(4, 2), ratio(5, 3)]

    expect(detectQuotaChange(ratios, 'seven_day@5')).toBeNull()
  })

  test('given a single closed window with a ratio, when comparing, then nothing is reported', () => {
    const ratios = [ratio(1, null), ratio(4, 3), ratio(5, 3)]

    expect(detectQuotaChange(ratios, 'seven_day@5')).toBeNull()
  })
})

describe('cost ledger', () => {
  const now = Date.UTC(2026, 9, 17, 12, 0, 0)
  const hour = String(Math.floor(now / 3_600_000))

  test('given the session cost went down, when recording, then nothing negative is added and the new total is the baseline', () => {
    const ledger = recordCost({ lastUsd: 8, hours: { [hour]: 8 } }, 2, now)

    expect(ledger).toEqual({ lastUsd: 2, hours: { [hour]: 8 } })
  })

  test('given two sessions and a bucket older than 49 days, when merging, then recent hours add up and the old one is dropped', () => {
    const old = String(Math.floor(now / 3_600_000) - 50 * 24)
    const merged = mergeCosts([{ lastUsd: 0, hours: { [hour]: 1, [old]: 9 } }, { lastUsd: 0, hours: { [hour]: 2 } }], now)

    expect(merged).toEqual({ [hour]: 3 })
  })
})
