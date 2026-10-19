import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { bandTarget, bandText, closedWeekPeaks, COST_DIR, drawnBand, measure, memoryFs, reading, SESSION, texts } from '../tests/harness'
import { toPlain } from '../tests/render-text'
import { DAY_MS, HOUR_MS, windowKey } from './pace'

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
  const { files } = memoryFs(on, NOW)

  for (const usd of [1, 3]) await measure($, [], usd)

  expect(JSON.parse(files.get(`${COST_DIR}/${SESSION}.json`) ?? '{}')).toEqual({ lastUsd: 3, hours: { [NOW_HOUR]: 3 }, label: 'burnrate' })
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

test('given this session spent $4 before the quota size is known, when the band draws, then it shows the session in dollars', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  memoryFs(on, NOW)

  await measure($, [reading('seven_day', 14, NOW + 3 * DAY_MS)], 4)

  expect(await bandText($)).toContain('session $4.00')
})

test('given sessions in two projects this week, when the pane draws, then projects are ranked by spend', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  const other = JSON.stringify({ lastUsd: 20, hours: { [NOW_HOUR - 1]: 20 }, label: 'api' })
  memoryFs(on, NOW, { [`${COST_DIR}/session-b.json`]: other })

  await measure($, [reading('seven_day', 14, NOW + 3 * DAY_MS)], 4)
  const drawn = await texts($, 60)

  expect(drawn).toContain('This session $4.00')
  expect(drawn.indexOf('api | $20')).toBeLessThan(drawn.indexOf('burnrate | $4.00'))
})

test('given a 5h window that was on track, when a reading puts it on course to hit the limit, then one toast says so', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  const { toasts } = memoryFs(on, NOW)

  await measure($, [reading('five_hour', 30, NOW + 2 * HOUR_MS)])
  for (const pct of [70, 71]) await measure($, [reading('five_hour', pct, NOW + 2 * HOUR_MS)])

  expect(toasts).toEqual(['burnrate · 5h hit the brakes'])
})

test('given a 5h window hitting the limit within 30 minutes, when measured twice, then one notification warns', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  const { notices } = memoryFs(on, NOW)

  for (const pct of [90, 91]) await measure($, [reading('five_hour', pct, NOW + 2 * HOUR_MS)])

  expect(notices).toHaveLength(1)
  expect(notices[0]).toStartWith('5h limit around ')
})

test('given the alerts option is off, when a window is about to hit the limit, then nothing pops up', { options: { alerts: false } }, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  const { toasts, notices } = memoryFs(on, NOW)

  await measure($, [reading('five_hour', 90, NOW + 2 * HOUR_MS)])

  expect([...toasts, ...notices]).toEqual([])
})

test('given a session with no reading yet in between, when the 5h window stays on course to hit the limit, then it is not toasted again', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  const { toasts } = memoryFs(on, NOW)

  await measure($, [reading('five_hour', 70, NOW + 2 * HOUR_MS)])
  await measure($, [])
  await measure($, [reading('five_hour', 71, NOW + 2 * HOUR_MS)])

  expect(toasts).toEqual(['burnrate · 5h hit the brakes'])
})

test('given a session already filed under a project, when its folder changes, then its cost stays under that project', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  const ledger = JSON.stringify({ lastUsd: 1, hours: { [NOW_HOUR]: 1 }, label: 'api' })
  const { files } = memoryFs(on, NOW, { [`${COST_DIR}/${SESSION}.json`]: ledger }, { root: '/home/tester/elsewhere' })

  await measure($, [], 3)

  expect(JSON.parse(files.get(`${COST_DIR}/${SESSION}.json`) ?? '{}')).toEqual({ lastUsd: 3, hours: { [NOW_HOUR]: 3 }, label: 'api' })
})

test('given a 7d window with room to spare, when its pace becomes merely on track, then no toast pops up', async ($, on) => {
  mock.store(on, { alerts: { [windowKey('seven_day', NOW + 3 * DAY_MS)]: { verdict: 'room', notified: false } } })
  mock.clock(on, { now: NOW })
  const { toasts } = memoryFs(on, NOW)

  await measure($, [reading('seven_day', 50, NOW + 3 * DAY_MS)])

  expect(toasts).toEqual([])
})

test('given Opus on a window about to hit the limit, when the band draws, then it advises Sonnet', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  memoryFs(on, NOW, {}, { model: 'claude-opus-5-5' })

  await measure($, [reading('five_hour', 90, NOW + 2 * HOUR_MS)])

  expect(await bandText($)).toContain('try sonnet')
})

test('given Opus on a calm week, when the band draws, then it gives no model advice', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  memoryFs(on, NOW, {}, { model: 'claude-opus-5-5' })

  await measure($, [reading('seven_day', 5, NOW + 3 * DAY_MS)])

  expect(await bandText($)).not.toContain('try sonnet')
})

test('given a week closed 4 days ago at 62%, when measured twice, then the pane recaps it and one toast reports it', async ($, on) => {
  const resetsAt = NOW + 3 * DAY_MS
  const closedAt = resetsAt - 7 * DAY_MS
  const key = windowKey('seven_day', closedAt)
  const start = (date: string, pct: number, seenAt: number) => [`${key}#${date}`, { windowKey: key, date, pct, seenAt }] as const
  const dayStarts = Object.fromEntries([start('2026-10-10', 0, closedAt - 3 * DAY_MS), start('2026-10-11', 40, closedAt - 2 * DAY_MS)])
  mock.store(on, { history: { peaks: closedWeekPeaks([62], resetsAt), dayStarts, hours: {} } })
  mock.clock(on, { now: NOW })
  const { toasts } = memoryFs(on, NOW)

  for (const pct of [14, 15]) await measure($, [reading('seven_day', pct, resetsAt)])

  expect(await texts($, 60)).toContain('Last week peaked 62% · busiest Sat 10 at 40%')
  expect(toasts).toEqual(['burnrate · last week peaked 62%, busiest Sat 10 at 40%'])
})

async function bandAfterReading($: Engine, on: On): Promise<string> {
  mock.store(on)
  mock.clock(on, { now: NOW })
  memoryFs(on, NOW)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine band</Text>
  })

  await measure($, [reading('seven_day', 14, NOW + 3 * DAY_MS)])

  return bandText($)
}

test('given the default options, when a reading arrives, then the band above the prompt shows the 7d projection', async ($, on) => {
  expect(await bandAfterReading($, on)).toContain('7d → ')
})

test('given the status line option is off, when a reading arrives, then the band stays empty', { options: { statusLine: false } }, async ($, on) => {
  expect(await bandAfterReading($, on)).not.toContain('7d')
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

test('given a calm week but a 5h window about to run out, when a reading arrives, then the band opens with the worse verdict', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  memoryFs(on, NOW)

  await measure($, [reading('seven_day', 5, NOW + 3 * DAY_MS), reading('five_hour', 90, NOW + 2 * HOUR_MS)])

  expect(await bandText($)).toStartWith('▌ ● hit the brakes')
})

test('given the band on screen, when the 7d projection is clicked, then the burnrate pane opens', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  memoryFs(on, NOW)
  const opened: string[] = []
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', ($, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true as const } }
  })

  await measure($, [reading('seven_day', 14, NOW + 3 * DAY_MS)])
  const ui = await $.ui.mount(bandTarget(120))
  await ui.press({ key: 'week' })
  await ui.unmount()

  expect(opened).toEqual(['burnrate'])
})

test('given Opus advised to try Sonnet with an empty prompt, when the advice is clicked, then the prompt holds the model switch', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  memoryFs(on, NOW, {}, { model: 'claude-opus-5-5' })
  const filled: string[] = []
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', ($, e) => {
    filled.push(e.text)

    return { isFilled: true }
  })

  await measure($, [reading('five_hour', 90, NOW + 2 * HOUR_MS)])
  const ui = await $.ui.mount(bandTarget(120))
  await ui.press({ key: 'advice' })
  await ui.unmount()

  expect(filled).toEqual(['/model sonnet'])
})

test('given another session pushed the 7d window to 50%, when this idle session reads a stale 30%, then the pane shows 50%', async ($, on) => {
  const resetsAt = NOW + 3 * DAY_MS
  const key = windowKey('seven_day', resetsAt)
  mock.store(on, { history: { peaks: { [key]: { kind: 'seven_day', resetsAt, peak: 50 } }, dayStarts: {}, hours: {} } })
  mock.clock(on, { now: NOW })
  memoryFs(on, NOW)

  await measure($, [reading('seven_day', 30, resetsAt)])

  expect(await texts($)).toContain('Used 50%')
})

test('given two readings arriving at once, when a 5h window turns to hitting the limit, then it is toasted once', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  const { toasts } = memoryFs(on, NOW)

  await Promise.all([70, 71].map(pct => measure($, [reading('five_hour', pct, NOW + 2 * HOUR_MS)])))

  expect(toasts).toEqual(['burnrate · 5h hit the brakes'])
})

test('given a notification that failed, when the window is measured again, then it is notified again', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  const { notices } = memoryFs(on, NOW, {}, { failedNotices: 1 })

  for (const pct of [90, 91]) await measure($, [reading('five_hour', pct, NOW + 2 * HOUR_MS)])

  expect(notices).toHaveLength(2)
})

test('given the usage read fails on a minute tick, when the ticker runs, then the error goes to the debug log', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: NOW })
  memoryFs(on, NOW)
  const logs: string[] = []
  on('session.usage', () => ({ deny: 'usage unavailable' }))
  on('ui.log', ($, e) => {
    logs.push(e.text)

    return { value: undefined }
  })

  await measure($, [])
  await clock.advance(60_000)

  expect(logs.some(line => line.includes('usage unavailable'))).toBe(true)
})

test('given a survey above the prompt, when the band would draw, then it gives way', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  memoryFs(on, NOW)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine band</Text>
  })

  await measure($, [reading('seven_day', 14, NOW + 3 * DAY_MS)])
  const ui = await $.ui.mount(bandTarget(120, true))
  const all = await ui.findAll({ type: 'Text' })
  await ui.unmount()

  expect(all.map(element => element.text).join(' ')).not.toContain('7d')
})

test('given a measure where only the cost changed, when it arrives, then the session cost is recorded', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  const { files } = memoryFs(on, NOW)

  await $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: ['cost'], cost: { usd: 2 } })

  expect(files.has(`${COST_DIR}/${SESSION}.json`)).toBe(true)
})

test('given a session ledger untouched for 50 days, when the pane draws, then its project is not listed', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  const old = `${COST_DIR}/session-b.json`
  const ledger = JSON.stringify({ lastUsd: 20, hours: { [NOW_HOUR]: 20 }, label: 'api' })
  memoryFs(on, NOW, { [old]: ledger }, { mtimes: { [old]: NOW - 50 * DAY_MS } })

  await measure($, [reading('seven_day', 14, NOW + 3 * DAY_MS)], 4)

  expect(await texts($, 60)).not.toContain('api')
})

test('given a week with exactly two days of readings, when the band draws, then it shows one bar per day', async ($, on) => {
  const resetsAt = NOW + 3 * DAY_MS
  const key = windowKey('seven_day', resetsAt)
  const start = (date: string, pct: number, seenAt: number) => [`${key}#${date}`, { windowKey: key, date, pct, seenAt }] as const
  const dayStarts = Object.fromEntries([start('2026-10-16', 0, NOW - DAY_MS), start('2026-10-17', 10, NOW - HOUR_MS)])
  mock.store(on, { history: { peaks: {}, dayStarts, hours: {} } })
  mock.clock(on, { now: NOW })
  memoryFs(on, NOW)

  await measure($, [reading('seven_day', 15, resetsAt)])

  expect(toPlain(await drawnBand($, 120))).toContain('▆▃')
})
