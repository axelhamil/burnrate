import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { mock } from 'claude-code/testing'

import type { BurnrateReading } from '../types'
import { WEEK_MS, windowKey } from '../hooks/pace'

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

export type FakeMachine = { files: Map<string, string>; toasts: string[]; notices: string[] }

export type SessionInfo = { model?: string; root?: string; mtimes?: Record<string, number>; failedNotices?: number }

export function memoryFs(on: On, now: number, initial: Record<string, string> = {}, session: SessionInfo = {}): FakeMachine {
  const files = new Map(Object.entries(initial))
  const toasts: string[] = []
  const notices: string[] = []
  const isDir = (path: string) => [...files.keys()].some(file => file.startsWith(`${path}/`))

  mock.env(on, { HOME: '/home/tester' })
  on('session.id', () => ({ value: SESSION }))
  on('session.model', () => ({ value: session.model ?? 'claude-sonnet-5-5' }))
  on('session.root', () => ({ value: session.root ?? '/home/tester/DEV/burnrate' }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.notify', ($, e) => {
    notices.push(e.text)
    if (notices.length <= (session.failedNotices ?? 0)) return { deny: 'notification failed' }

    return { value: { isSent: false, reason: 'no-surface' } }
  })
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
      mtimeMs: session.mtimes?.[file] ?? now,
      isLink: false,
    }))

    return { value: entries }
  })
  on('session.measure', ($, e) => ({ changed: e.changed }))

  return { files, toasts, notices }
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

export function bandTarget(bodyColumns: number, hasSurvey = false) {
  return {
    plugin: 'burnrate',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  } as const
}

export async function bandText($: Engine, bodyColumns = 120): Promise<string> {
  const ui = await $.ui.mount(bandTarget(bodyColumns))
  const all = await ui.findAll({ type: 'Text' })
  await ui.unmount()

  return all.map(element => element.text).join(' | ')
}

export async function drawnBand($: Engine, bodyColumns: number): Promise<unknown> {
  const ui = await $.ui.mount(bandTarget(bodyColumns))
  const tree = await ui.drawn()
  await ui.unmount()

  return tree
}
