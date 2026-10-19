import type { EngineInterface, Register } from 'claude-code'

import type { BurnrateCostLedger, BurnrateHistory, BurnrateReading, BurnrateSessionCost, BurnrateSnapshot } from '../types'
import { alertsFor, parseAlertState, withNotified, type Notice } from './alerts'
import { bandTree } from './band'
import { insightsOf, type WindowInsight } from './insight'
import { EMPTY_HISTORY, localDate, parseHistory, recordReadings, RETENTION_MS, withPeaks } from './pace'
import { paneTree, type Elements } from './pane'
import { mergeCosts, parseLedger, recordCost } from './quota-size'
import { reportText } from './report'

const PANE = 'burnrate'
const STORE_KEY = 'history'
const LAST_READINGS_KEY = 'lastReadings'
const ALERTS_KEY = 'alerts'
const REPORTED_WEEK_KEY = 'reportedWeek'
const UNLABELED = 'other'
const ALERT_TOAST_MS = 8_000
const SONNET_COMMAND = '/model sonnet'
const TICK_MS = 60_000
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
let pending: Promise<void> = Promise.resolve()

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
    entry => entry.kind === 'file' && entry.name.endsWith('.json') && entry.mtimeMs >= now - RETENTION_MS,
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

async function readState($: EngineInterface): Promise<BurnrateSnapshot> {
  const { value } = await $.state.get(snapshot)

  return { ...EMPTY_SNAPSHOT, ...value, history: parseHistory(value?.history) }
}

async function isNewReading($: EngineInterface, readings: readonly BurnrateReading[]): Promise<boolean> {
  const last = await $.store.get(LAST_READINGS_KEY)

  return JSON.stringify(last) !== JSON.stringify(readings)
}

async function recordedHistory(
  $: EngineInterface,
  stored: BurnrateHistory,
  readings: readonly BurnrateReading[],
  now: number,
  isFresh: boolean,
): Promise<BurnrateHistory> {
  if (!isFresh && !(await isNewReading($, readings))) return stored

  const history = recordReadings(stored, readings, now, localDate(now))
  if (history !== stored) await $.store.set(STORE_KEY, history)
  await $.store.set(LAST_READINGS_KEY, readings)

  return history
}

async function sentKeys($: EngineInterface, notices: readonly Notice[]): Promise<string[]> {
  const sent = await Promise.all(
    notices.map(notice =>
      $.ui.notify(notice.text, { title: 'burnrate' }).then(
        () => [notice.key],
        () => [],
      ),
    ),
  )

  return sent.flat()
}

async function raiseAlerts($: EngineInterface, insights: readonly WindowInsight[], now: number): Promise<void> {
  const previous = parseAlertState(await $.store.get(ALERTS_KEY))
  const { toasts, notices, state } = alertsFor(insights, previous, now)

  for (const text of toasts) $.ui.toast(text, { timeoutMs: ALERT_TOAST_MS })

  const notified = withNotified(state, await sentKeys($, notices))
  if (JSON.stringify(notified) !== JSON.stringify(previous)) await $.store.set(ALERTS_KEY, notified)
}

async function reportLastWeek($: EngineInterface, insights: readonly WindowInsight[]): Promise<void> {
  const report = insights.find(insight => insight.lastWeek !== null)?.lastWeek
  if (report === undefined || report === null || (await $.store.get(REPORTED_WEEK_KEY)) === report.key) return

  await $.store.set(REPORTED_WEEK_KEY, report.key)
  $.ui.toast(reportText(report), { timeoutMs: ALERT_TOAST_MS })
}

async function refreshNow(
  $: EngineInterface,
  settings: Settings,
  rateLimits: readonly BurnrateReading[],
  usd: number | undefined,
  isFresh: boolean,
): Promise<void> {
  const now = await $.clock.now()
  const stored = parseHistory(await $.store.get(STORE_KEY))
  const readings = withPeaks(toReadings(rateLimits), stored)
  const history = await recordedHistory($, stored, readings, now, isFresh)

  const dir = await costDir($)
  const sessionId = await $.session.id()
  if (usd !== undefined) await recordSessionCost($, dir, sessionId, usd, now)

  const sessions = await loadSessions($, dir, now)
  const costs = mergeCosts(sessions, now)
  const model = await $.session.model()
  const next: BurnrateSnapshot = { readings, history, costs, sessions, sessionId, model, now }
  await $.state.set(snapshot, next)

  if (!settings.isAlertsOn) return

  const insights = insightsOf(next)
  await raiseAlerts($, insights, now)
  await reportLastWeek($, insights)
}

function refresh(
  $: EngineInterface,
  settings: Settings,
  rateLimits: readonly BurnrateReading[],
  usd: number | undefined,
  isFresh: boolean,
): Promise<void> {
  const run = pending.then(() => refreshNow($, settings, rateLimits, usd, isFresh))
  pending = run.catch(() => undefined)

  return run
}

function ensureTicker($: EngineInterface, settings: Settings): void {
  if (ticker !== undefined) return

  ticker = $.clock.every(TICK_MS, () => {
    void $.session
      .usage()
      .then(usage => refresh($, settings, usage.rateLimits, usage.cost?.usd, false))
      .catch((error: unknown) => $.ui.log(`burnrate refresh failed: ${String(error)}`, { to: 'debug' }))
  })
}

async function suggestSonnet($: EngineInterface): Promise<void> {
  const draft = await $.prompt.read()
  if (draft.text.trim() !== '') return $.ui.toast('Clear the prompt to switch to Sonnet')

  await $.prompt.fill({ text: SONNET_COMMAND })
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
    const state = await readState($)

    return paneTree(elements, insightsOf(state), localDate(state.now), e.props.bodyColumns)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!isBandOn || e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const state = await readState($)
    const logged = (action: Promise<void>) => {
      void action.catch((error: unknown) => $.ui.log(`burnrate action failed: ${String(error)}`, { to: 'debug' }))
    }
    const actions = { togglePane: () => logged(togglePane($)), suggestSonnet: () => logged(suggestSonnet($)) }
    const tree = bandTree({ Box, Button, Text }, insightsOf(state), e.props.bodyColumns, state.model, actions)

    return tree ?? next(e)
  })
}
