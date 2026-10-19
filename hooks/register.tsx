import type { EngineInterface, Register } from 'claude-code'

import type { BurnrateCostLedger, BurnrateHistory, BurnrateReading, BurnrateSessionCost, BurnrateSnapshot } from '../types'
import { alertsFor, parseAlertState, reportText } from './alerts'
import { bandTree } from './band'
import { insightsOf, type WindowInsight } from './insight'
import { EMPTY_HISTORY, localDate, parseHistory, recordReadings } from './pace'
import { paneTree, type Elements } from './pane'
import { mergeCosts, parseLedger, recordCost } from './quota-size'

const PANE = 'burnrate'
const STORE_KEY = 'history'
const LAST_READINGS_KEY = 'lastReadings'
const ALERTS_KEY = 'alerts'
const REPORTED_WEEK_KEY = 'reportedWeek'
const UNLABELED = 'other'
const ALERT_TOAST_MS = 8_000
const TICK_MS = 60_000
const COST_RETENTION_MS = 49 * 86_400_000
const EMPTY_SNAPSHOT: BurnrateSnapshot = {
  readings: [],
  history: EMPTY_HISTORY,
  costs: {},
  sessions: [],
  sessionId: '',
  model: '',
  now: 0,
}

type Settings = { isAlertsOn: boolean }

const snapshot = { plugin: 'burnrate', key: 'snapshot' } as const

let ticker: { cancel: () => void } | undefined

function toReadings(rateLimits: readonly BurnrateReading[]): BurnrateReading[] {
  return rateLimits.map(({ kind, percentUsed, resetsAt }) =>
    resetsAt === undefined ? { kind, percentUsed } : { kind, percentUsed, resetsAt },
  )
}

async function costDir($: EngineInterface): Promise<string> {
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = await $.env.get('HOME')
  const base = configDir ?? `${home ?? ''}/.claude`

  return `${base}/burnrate/cost`
}

async function readLedger($: EngineInterface, path: string): Promise<BurnrateCostLedger | null> {
  if (!(await $.fs.exists(path))) return null

  return parseLedger(await $.fs.read(path))
}

async function sessionLabel($: EngineInterface): Promise<string> {
  const root = await $.session.root()

  return root.split('/').filter(Boolean).at(-1) ?? UNLABELED
}

async function recordSessionCost($: EngineInterface, dir: string, sessionId: string, usd: number, now: number): Promise<void> {
  const path = `${dir}/${sessionId}.json`
  const ledger = await readLedger($, path)
  const recorded = { ...recordCost(ledger, usd, now), label: ledger?.label ?? (await sessionLabel($)) }
  if (ledger !== null && JSON.stringify(ledger) === JSON.stringify(recorded)) return

  await $.fs.write(path, JSON.stringify(recorded))
}

async function loadSessions($: EngineInterface, dir: string, now: number): Promise<BurnrateSessionCost[]> {
  if (!(await $.fs.exists(dir))) return []

  const entries = await $.fs.list(dir)
  const recent = entries.filter(
    entry => entry.kind === 'file' && entry.name.endsWith('.json') && entry.mtimeMs >= now - COST_RETENTION_MS,
  )
  const ledgers = await Promise.all(
    recent.map(async entry => {
      const ledger = await readLedger($, `${dir}/${entry.name}`)
      if (ledger === null) return []

      const id = entry.name.slice(0, -'.json'.length)

      return [{ id, label: ledger.label ?? UNLABELED, hours: ledger.hours }]
    }),
  )

  return ledgers.flat()
}

function stateOf(value: BurnrateSnapshot | undefined): BurnrateSnapshot {
  return { ...EMPTY_SNAPSHOT, ...value, history: parseHistory(value?.history) }
}

async function isNewReading($: EngineInterface, readings: readonly BurnrateReading[]): Promise<boolean> {
  const last = await $.store.get(LAST_READINGS_KEY)

  return JSON.stringify(last) !== JSON.stringify(readings)
}

async function recordedHistory(
  $: EngineInterface,
  readings: readonly BurnrateReading[],
  now: number,
  isFresh: boolean,
): Promise<BurnrateHistory> {
  const stored = parseHistory(await $.store.get(STORE_KEY))
  if (!isFresh && !(await isNewReading($, readings))) return stored

  const history = recordReadings(stored, readings, now, localDate(now))
  if (history !== stored) await $.store.set(STORE_KEY, history)
  await $.store.set(LAST_READINGS_KEY, readings)

  return history
}

async function raiseAlerts($: EngineInterface, insights: readonly WindowInsight[], now: number): Promise<void> {
  const previous = parseAlertState(await $.store.get(ALERTS_KEY))
  const { toasts, notices, state } = alertsFor(insights, previous, now)
  if (JSON.stringify(state) !== JSON.stringify(previous)) await $.store.set(ALERTS_KEY, state)

  for (const text of toasts) $.ui.toast(text, { timeoutMs: ALERT_TOAST_MS })
  for (const text of notices) await $.ui.notify(text, { title: 'burnrate' }).catch(() => undefined)

  const report = insights.find(insight => insight.lastWeek !== null)?.lastWeek
  if (report === undefined || report === null || (await $.store.get(REPORTED_WEEK_KEY)) === report.key) return

  await $.store.set(REPORTED_WEEK_KEY, report.key)
  $.ui.toast(reportText(report), { timeoutMs: ALERT_TOAST_MS })
}

async function refresh(
  $: EngineInterface,
  settings: Settings,
  rateLimits: readonly BurnrateReading[],
  usd: number | undefined,
  isFresh: boolean,
): Promise<void> {
  const now = await $.clock.now()
  const readings = toReadings(rateLimits)
  const history = await recordedHistory($, readings, now, isFresh)

  const dir = await costDir($)
  const sessionId = await $.session.id()
  if (usd !== undefined) await recordSessionCost($, dir, sessionId, usd, now)

  const sessions = await loadSessions($, dir, now)
  const costs = mergeCosts(sessions, now)
  const model = await $.session.model()
  const next: BurnrateSnapshot = { readings, history, costs, sessions, sessionId, model, now }
  await $.state.set(snapshot, next)

  if (settings.isAlertsOn) await raiseAlerts($, insightsOf(next), now)
}

function ensureTicker($: EngineInterface, settings: Settings): void {
  if (ticker !== undefined) return

  ticker = $.clock.every(TICK_MS, () => {
    void $.session.usage().then(usage => refresh($, settings, usage.rateLimits, usage.cost?.usd, false))
  })
}

async function togglePane($: EngineInterface): Promise<void> {
  const panes = await $.ui.panes()
  const isOpen = panes.some(pane => pane.id === PANE)
  if (isOpen) return $.ui.close({ id: PANE })

  await $.ui.open({ id: PANE, title: 'burnrate' })
}

export const register: Register = (on, options) => {
  const isBandOn = options.statusLine !== false
  const settings: Settings = { isAlertsOn: options.alerts !== false }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'burnrate', description: 'Toggle the burnrate quota pane', immediate: true })
    const usage = await $.session.usage()
    await refresh($, settings, usage.rateLimits, usage.cost?.usd, false)
    ensureTicker($, settings)

    return next(e)
  })

  on('command.run', { command: 'burnrate' }, async $ => {
    ensureTicker($, settings)
    await togglePane($)

    return {}
  })

  on('session.measure', async ($, e, next) => {
    ensureTicker($, settings)
    const isFresh = e.changed.includes('rateLimits')
    if (isFresh || e.changed.includes('cost')) await refresh($, settings, e.rateLimits, e.cost?.usd, isFresh)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const elements: Elements = { Box, Text }
    const { value } = await $.state.get(snapshot)
    const state = stateOf(value)

    return paneTree(elements, insightsOf(state), localDate(state.now), e.props.bodyColumns)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!isBandOn || e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const { value } = await $.state.get(snapshot)
    const state = stateOf(value)
    const tree = bandTree({ Box, Text }, insightsOf(state), e.props.bodyColumns, state.model)

    return tree ?? next(e)
  })
}
