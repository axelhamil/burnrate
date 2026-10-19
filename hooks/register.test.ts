import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { closedWeekPeaks, COST_DIR, DAY_MS, HOUR_MS, measure, memoryFs, reading, SESSION, texts } from '../tests/harness'
import { windowKey } from './pace'

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0)
const NOW_HOUR = Math.floor(NOW / HOUR_MS)

test('given no quota reading, when the pane draws, then it says there is no data yet', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })

  expect(await texts($)).toContain('No quota data yet')
})

test('given four closed weeks peaking at 60, when a 7d reading of 14% with 6.2 days left arrives, then the pane projects 73%', async ($, on) => {
  const resetsAt = NOW + 6.2 * DAY_MS
  mock.store(on, { history: { peaks: closedWeekPeaks([60, 60, 60, 60], resetsAt), dayStarts: {}, hours: {} } })
  mock.clock(on, { now: NOW })
  memoryFs(on, NOW)

  await measure($, [reading('seven_day', 14, resetsAt)])
  const drawn = await texts($)

  expect(drawn).toContain('Projected at reset 73%')
  expect(drawn).toContain('Budget 14%/day')
  expect(drawn).toContain('Today 0% of 14%')
})

test('given a session whose cost grows from $1 to $3, when measured twice, then its own file holds $3 in this hour', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  const files = memoryFs(on, NOW)

  for (const usd of [1, 3]) await measure($, [], usd)

  expect(JSON.parse(files.get(`${COST_DIR}/${SESSION}.json`) ?? '{}')).toEqual({ lastUsd: 3, hours: { [NOW_HOUR]: 3 } })
})

test('given another session spent $20 while 7d rose 10 points, when the pane draws, then 1% is about $2 and the week about $200', async ($, on) => {
  const resetsAt = NOW + 3 * DAY_MS
  const key = windowKey('seven_day', resetsAt)
  const start = { windowKey: key, hour: NOW_HOUR - 2, pct: 4 }
  mock.store(on, { history: { peaks: {}, dayStarts: {}, hours: { [`${key}#${NOW_HOUR - 2}`]: start } } })
  mock.clock(on, { now: NOW })
  const other = JSON.stringify({ lastUsd: 20, hours: { [NOW_HOUR - 1]: 15, [NOW_HOUR]: 5 } })
  memoryFs(on, NOW, { [`${COST_DIR}/session-b.json`]: other })

  await measure($, [reading('seven_day', 14, resetsAt)])
  const drawn = await texts($)

  expect(drawn).toContain('1% ≈ $2.00')
  expect(drawn).toContain('Quota ≈ $200 / week')
})

async function statusesAfterReading($: Engine, on: On): Promise<string[]> {
  mock.store(on)
  mock.clock(on, { now: NOW })
  memoryFs(on, NOW)
  const statuses: string[] = []
  on('ui.status', ($, e) => {
    statuses.push(e.text ?? '')

    return { value: undefined }
  })

  await measure($, [reading('seven_day', 14, NOW + 3 * DAY_MS)])

  return statuses
}

test('given the default options, when a reading arrives, then the status line shows the 7d projection', async ($, on) => {
  const statuses = await statusesAfterReading($, on)

  expect(statuses.at(-1) ?? '').toContain('7d end')
})

test('given the status line option is off, when a reading arrives, then no status is set', { options: { statusLine: false } }, async ($, on) => {
  expect(await statusesAfterReading($, on)).toEqual([])
})

test('given an unchanged reading polled by the minute ticker past midnight, when the pane draws, then no day start was stamped from it', async ($, on) => {
  const resetsAt = NOW + 3 * DAY_MS
  const stale = reading('seven_day', 30, resetsAt)
  mock.store(on)
  const clock = mock.clock(on, { now: NOW })
  memoryFs(on, NOW)
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: [stale] } }))

  await measure($, [stale])
  await clock.advance(14 * HOUR_MS)

  expect(await texts($)).not.toContain('Today')
})

test('given a calm week but a 5h window about to run out, when a reading arrives, then the status line opens with the worse verdict', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  memoryFs(on, NOW)
  const statuses: string[] = []
  on('ui.status', ($, e) => {
    statuses.push(e.text ?? '')

    return { value: undefined }
  })

  await measure($, [reading('seven_day', 5, NOW + 3 * DAY_MS), reading('five_hour', 90, NOW + 2 * HOUR_MS)])

  expect(statuses.at(-1) ?? '').toStartWith('hit the brakes · ')
})
