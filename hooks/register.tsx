import type { EngineInterface, Register } from 'claude-code'

import type { BurnrateCostLedger, BurnrateHistory, BurnrateReading, BurnrateSnapshot } from '../types'
import { bandTree } from './band'
import { insightsOf } from './insight'
import { EMPTY_HISTORY, localDate, parseHistory, recordReadings } from './pace'
import { paneTree, type Elements } from './pane'
import { mergeCosts, parseLedger, recordCost } from './quota-size'

const PANE = 'burnrate'
const STORE_KEY = 'history'
const LAST_READINGS_KEY = 'lastReadings'
const TICK_MS = 60_000
const COST_RETENTION_MS = 49 * 86_400_000
const EMPTY_SNAPSHOT: BurnrateSnapshot = { readings: [], history: EMPTY_HISTORY, costs: {}, now: 0 }

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

async function recordSessionCost($: EngineInterface, dir: string, usd: number, now: number): Promise<void> {
  const path = `${dir}/${await $.session.id()}.json`
  const ledger = await readLedger($, path)
  const recorded = recordCost(ledger, usd, now)
  if (ledger !== null && JSON.stringify(ledger) === JSON.stringify(recorded)) return

  await $.fs.write(path, JSON.stringify(recorded))
}

async function loadCosts($: EngineInterface, dir: string, now: number): Promise<Record<string, number>> {
  if (!(await $.fs.exists(dir))) return {}

  const entries = await $.fs.list(dir)
  const recent = entries.filter(
    entry => entry.kind === 'file' && entry.name.endsWith('.json') && entry.mtimeMs >= now - COST_RETENTION_MS,
  )
  const ledgers = await Promise.all(recent.map(entry => readLedger($, `${dir}/${entry.name}`)))

  return mergeCosts(
    ledgers.flatMap(ledger => (ledger === null ? [] : [ledger])),
    now,
  )
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

async function refresh(
  $: EngineInterface,
  rateLimits: readonly BurnrateReading[],
  usd: number | undefined,
  isFresh: boolean,
): Promise<void> {
  const now = await $.clock.now()
  const readings = toReadings(rateLimits)
  const history = await recordedHistory($, readings, now, isFresh)

  const dir = await costDir($)
  if (usd !== undefined) await recordSessionCost($, dir, usd, now)

  const costs = await loadCosts($, dir, now)
  const next: BurnrateSnapshot = { readings, history, costs, now }
  await $.state.set(snapshot, next)
}

function ensureTicker($: EngineInterface): void {
  if (ticker !== undefined) return

  ticker = $.clock.every(TICK_MS, () => {
    void $.session.usage().then(usage => refresh($, usage.rateLimits, usage.cost?.usd, false))
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

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'burnrate', description: 'Toggle the burnrate quota pane', immediate: true })
    const usage = await $.session.usage()
    await refresh($, usage.rateLimits, usage.cost?.usd, false)
    ensureTicker($)

    return next(e)
  })

  on('command.run', { command: 'burnrate' }, async $ => {
    ensureTicker($)
    await togglePane($)

    return {}
  })

  on('session.measure', async ($, e, next) => {
    ensureTicker($)
    const isFresh = e.changed.includes('rateLimits')
    if (isFresh || e.changed.includes('cost')) await refresh($, e.rateLimits, e.cost?.usd, isFresh)

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
    const tree = bandTree({ Box, Text }, insightsOf(stateOf(value)), e.props.bodyColumns)

    return tree ?? next(e)
  })
}
