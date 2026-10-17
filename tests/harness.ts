import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { mock } from 'claude-code/testing'

import type { BurnrateReading } from '../types'
import { windowKey } from '../hooks/pace'

export const DAY_MS = 86_400_000
export const HOUR_MS = 3_600_000
export const WEEK_MS = 7 * DAY_MS
export const COST_DIR = '/home/tester/.claude/burnrate/cost'
export const SESSION = 'session-a'

export function paneTarget(bodyColumns: number) {
  return {
    plugin: 'burnrate',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'burnrate',
    props: {
      title: 'burnrate',
      isFocused: false,
      bodyColumns,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  } as const
}

export function memoryFs(on: On, now: number, initial: Record<string, string> = {}): Map<string, string> {
  const files = new Map(Object.entries(initial))
  const isDir = (path: string) => [...files.keys()].some(file => file.startsWith(`${path}/`))

  mock.env(on, { HOME: '/home/tester' })
  on('session.id', () => ({ value: SESSION }))
  on('fs.exists', ($, e) => ({ value: files.has(e.path) || isDir(e.path) }))
  on('fs.read', ($, e) => ({ value: files.get(e.path) ?? '' }))
  on('fs.write', ($, e) => {
    files.set(e.path, e.text)

    return { value: undefined }
  })
  on('fs.list', ($, e) => {
    const names = [...files.keys()].filter(file => file.startsWith(`${e.path}/`))
    const entries = names.map(file => ({
      name: file.slice(e.path.length + 1),
      kind: 'file' as const,
      size: 1,
      mtimeMs: now,
      isLink: false,
    }))

    return { value: entries }
  })
  on('session.measure', ($, e) => ({ changed: e.changed }))

  return files
}

export function reading(kind: 'seven_day' | 'five_hour', percentUsed: number, resetsAt: number): BurnrateReading {
  return { kind, percentUsed, resetsAt: new Date(resetsAt).toISOString() }
}

export function closedWeekPeaks(peaks: readonly number[], resetsAt: number) {
  const entries = peaks.map((peak, index) => {
    const closedAt = resetsAt - (index + 1) * WEEK_MS
    return [windowKey('seven_day', closedAt), { kind: 'seven_day', resetsAt: closedAt, peak }] as const
  })

  return Object.fromEntries(entries)
}

export async function measure($: Engine, readings: BurnrateReading[], usd?: number): Promise<void> {
  const cost = usd === undefined ? {} : { cost: { usd } }
  const changed = usd === undefined ? (['rateLimits'] as const) : (['rateLimits', 'cost'] as const)

  await $.session.measure({ context: { window: 200_000 }, rateLimits: readings, changed: [...changed], ...cost })
}

export async function drawnTree($: Engine, bodyColumns: number): Promise<unknown> {
  const ui = await $.ui.mount(paneTarget(bodyColumns))
  const tree = await ui.drawn()
  await ui.unmount()

  return tree
}

export async function texts($: Engine, bodyColumns = 48): Promise<string> {
  const ui = await $.ui.mount(paneTarget(bodyColumns))
  const all = await ui.findAll({ type: 'Text' })
  await ui.unmount()

  return all.map(element => element.text).join(' | ')
}
