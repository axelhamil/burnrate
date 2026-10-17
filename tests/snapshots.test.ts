import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { windowKey } from '../hooks/pace'
import type { BurnrateHistory, BurnrateReading } from '../types'
import { closedWeekPeaks, COST_DIR, drawnTree, HOUR_MS, measure, memoryFs, reading, WEEK_MS } from './harness'
import { toAnsi, toPlain, widestLine } from './render-text'

type Scenario = {
  name: string
  now: number
  history: BurnrateHistory
  costFiles: Record<string, string>
  readings: BurnrateReading[]
}

declare const console: { log: (text: string) => void }

const COLUMNS = [60, 90, 140] as const
const MIN_MS = 60_000
const WEEK_RESET = new Date(2026, 9, 18, 11, 0, 0).getTime()
const WEEK_KEY = windowKey('seven_day', WEEK_RESET)

function dayStarts(starts: ReadonlyArray<readonly [string, number]>): BurnrateHistory['dayStarts'] {
  const entries = starts.map(([date, pct]) => {
    const seenAt = Date.parse(`${date}T08:00:00`)

    return [`${WEEK_KEY}#${date}`, { windowKey: WEEK_KEY, date, pct, seenAt }] as const
  })

  return Object.fromEntries(entries)
}

function hourSample(now: number, hoursAgo: number, pct: number): BurnrateHistory['hours'] {
  const hour = Math.floor(now / HOUR_MS) - hoursAgo

  return { [`${WEEK_KEY}#${hour}`]: { windowKey: WEEK_KEY, hour, pct } }
}

function pastWeekSamples(offsetHours: number, pcts: readonly number[]): BurnrateHistory['hours'] {
  const entries = pcts.map((pct, index) => {
    const resetsAt = WEEK_RESET - (index + 1) * WEEK_MS
    const key = windowKey('seven_day', resetsAt)
    const hour = Math.floor((resetsAt - WEEK_MS) / HOUR_MS) + offsetHours - 1

    return [`${key}#${hour}`, { windowKey: key, hour, pct }] as const
  })

  return Object.fromEntries(entries)
}

function freshWeek(): Scenario {
  const now = new Date(2026, 9, 11, 13, 0, 0).getTime()

  return {
    name: 'fresh-week',
    now,
    history: { peaks: {}, dayStarts: {}, hours: {} },
    costFiles: {},
    readings: [reading('seven_day', 1, WEEK_RESET), reading('five_hour', 6, now + 4 * HOUR_MS)],
  }
}

function midWeekAhead(): Scenario {
  const now = new Date(2026, 9, 13, 15, 0, 0).getTime()
  const nowHour = Math.floor(now / HOUR_MS)
  const otherSession = JSON.stringify({ lastUsd: 20, hours: { [nowHour - 2]: 8, [nowHour - 1]: 7, [nowHour]: 5 } })

  return {
    name: 'mid-week-ahead',
    now,
    history: {
      peaks: closedWeekPeaks([50, 40, 48, 42], WEEK_RESET),
      dayStarts: dayStarts([
        ['2026-10-11', 0],
        ['2026-10-12', 9],
        ['2026-10-13', 30],
      ]),
      hours: { ...hourSample(now, 3, 34), ...pastWeekSamples(52, [15, 10, 14, 12]) },
    },
    costFiles: { [`${COST_DIR}/session-b.json`]: otherSession },
    readings: [reading('seven_day', 44, WEEK_RESET), reading('five_hour', 45, now + 130 * MIN_MS)],
  }
}

function limitHit(): Scenario {
  const now = new Date(2026, 9, 16, 20, 0, 0).getTime()

  return {
    name: 'limit-hit',
    now,
    history: {
      peaks: closedWeekPeaks([60, 60, 60, 60], WEEK_RESET),
      dayStarts: dayStarts([
        ['2026-10-11', 0],
        ['2026-10-12', 12],
        ['2026-10-13', 30],
        ['2026-10-14', 47],
        ['2026-10-15', 63],
        ['2026-10-16', 78],
      ]),
      hours: {},
    },
    costFiles: {},
    readings: [reading('seven_day', 91, WEEK_RESET), reading('five_hour', 100, now + 80 * MIN_MS)],
  }
}

async function render($: Engine, on: On, scenario: Scenario, columns: number): Promise<unknown> {
  mock.store(on, { history: scenario.history })
  mock.clock(on, { now: scenario.now })
  memoryFs(on, scenario.now, scenario.costFiles)

  await measure($, scenario.readings)

  return drawnTree($, columns)
}

for (const scenario of [freshWeek(), midWeekAhead(), limitHit()]) {
  for (const columns of COLUMNS) {
    test(`given the ${scenario.name} state, when drawn at ${columns} columns, then no line overflows`, async ($, on) => {
      const tree = await render($, on, scenario, columns)
      const id = `${scenario.name}-${columns}`

      console.log(`<<<snapshot ${id}.txt\n${toPlain(tree)}\n>>>snapshot`)
      console.log(`<<<snapshot ${id}.ansi\n${toAnsi(tree)}\n>>>snapshot`)

      expect(widestLine(tree) <= columns).toBe(true)
    })
  }
}
