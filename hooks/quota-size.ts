import type { BurnrateCostLedger, BurnrateHourSample } from '../types'
import { isWindowKind, WINDOW_SECONDS } from './pace'

export type HourlyCosts = Readonly<Record<string, number>>

export type WindowRatio = {
  windowKey: string
  resetsAt: number
  usd: number
  points: number
  usdPerPoint: number | null
}

export type QuotaChange = { direction: 'up' | 'down'; percent: number }

const HOUR_MS = 3_600_000
const RETENTION_HOURS = 49 * 24
const MIN_POINTS = 5
const CHANGE_THRESHOLD = 0.2
const MIN_CLOSED_WINDOWS = 2

function costBetween(costs: HourlyCosts, fromHourExclusive: number, toHourInclusive: number): number {
  let total = 0
  for (let hour = fromHourExclusive + 1; hour <= toHourInclusive; hour += 1) total += costs[String(hour)] ?? 0

  return total
}

function resetsAtOf(windowKey: string): number | null {
  const resetsAt = Number(windowKey.split('@')[1])

  return Number.isFinite(resetsAt) ? resetsAt : null
}

export function windowRatio(windowKey: string, samples: readonly BurnrateHourSample[], costs: HourlyCosts): WindowRatio | null {
  const resetsAt = resetsAtOf(windowKey)
  if (resetsAt === null) return null

  const ordered = [...samples].sort((a, b) => a.hour - b.hour)
  const moves = ordered.flatMap((sample, index) => {
    const previous = ordered[index - 1]
    if (previous === undefined) return []

    const gained = sample.pct - previous.pct
    if (gained <= 0) return []

    return [{ gained, usd: costBetween(costs, previous.hour, sample.hour) }]
  })
  const points = moves.reduce((sum, move) => sum + move.gained, 0)
  const usd = moves.reduce((sum, move) => sum + move.usd, 0)
  const usdPerPoint = points >= MIN_POINTS ? usd / points : null

  return { windowKey, resetsAt, usd, points, usdPerPoint }
}

function startsInCostRetention(ratio: WindowRatio, kind: string, now: number): boolean {
  if (!isWindowKind(kind)) return false

  const startHour = Math.floor((ratio.resetsAt - WINDOW_SECONDS[kind] * 1_000) / HOUR_MS)

  return startHour >= retainedSince(now)
}

export function windowRatios(
  hours: Readonly<Record<string, BurnrateHourSample>>,
  costs: HourlyCosts,
  kind: string,
  now: number,
): WindowRatio[] {
  const byWindow = new Map<string, BurnrateHourSample[]>()
  for (const sample of Object.values(hours)) {
    if (!sample.windowKey.startsWith(`${kind}@`)) continue

    byWindow.set(sample.windowKey, [...(byWindow.get(sample.windowKey) ?? []), sample])
  }

  return [...byWindow.entries()]
    .flatMap(([key, samples]) => {
      const ratio = windowRatio(key, samples, costs)

      return ratio === null || !startsInCostRetention(ratio, kind, now) ? [] : [ratio]
    })
    .sort((a, b) => a.resetsAt - b.resetsAt)
}

function median(values: readonly number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const upper = sorted[middle]
  if (upper === undefined) return null
  if (sorted.length % 2 === 1) return upper

  const lower = sorted[middle - 1] ?? upper

  return (lower + upper) / 2
}

export function detectQuotaChange(ratios: readonly WindowRatio[], currentKey: string): QuotaChange | null {
  const current = ratios.find(ratio => ratio.windowKey === currentKey)
  if (current?.usdPerPoint == null) return null

  const closed = ratios
    .filter(ratio => ratio.resetsAt < current.resetsAt)
    .flatMap(ratio => (ratio.usdPerPoint === null ? [] : [ratio.usdPerPoint]))
    .reverse()
  if (closed.length < MIN_CLOSED_WINDOWS) return null

  const [previous, ...older] = closed
  const baseline = median(older)
  if (previous === undefined || baseline === null || baseline <= 0) return null

  const currentDeviation = current.usdPerPoint / baseline - 1
  const previousDeviation = previous / baseline - 1
  const percent = Math.round(Math.abs(currentDeviation) * 100)

  if (currentDeviation > CHANGE_THRESHOLD && previousDeviation > CHANGE_THRESHOLD) return { direction: 'up', percent }
  if (currentDeviation < -CHANGE_THRESHOLD && previousDeviation < -CHANGE_THRESHOLD) return { direction: 'down', percent }

  return null
}

function retainedSince(now: number): number {
  return Math.floor(now / HOUR_MS) - RETENTION_HOURS
}

function recentHours(hours: HourlyCosts, now: number): Record<string, number> {
  const oldest = retainedSince(now)

  return Object.fromEntries(Object.entries(hours).filter(([hour]) => Number(hour) >= oldest))
}

export function recordCost(ledger: BurnrateCostLedger | null, usd: number, now: number): BurnrateCostLedger {
  const delta = Math.max(0, usd - (ledger?.lastUsd ?? 0))
  const hour = String(Math.floor(now / HOUR_MS))
  const hours = recentHours(ledger?.hours ?? {}, now)
  if (delta > 0) hours[hour] = (hours[hour] ?? 0) + delta

  return { lastUsd: usd, hours }
}

export function parseLedger(text: string): BurnrateCostLedger | null {
  const parsed: unknown = (() => {
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  })()
  if (typeof parsed !== 'object' || parsed === null || !('lastUsd' in parsed) || !('hours' in parsed)) return null

  const { lastUsd, hours } = parsed
  if (typeof lastUsd !== 'number' || typeof hours !== 'object' || hours === null) return null

  const valid = Object.entries(hours).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
  const label = 'label' in parsed && typeof parsed.label === 'string' ? { label: parsed.label } : {}

  return { lastUsd, hours: Object.fromEntries(valid), ...label }
}

export function mergeCosts(ledgers: readonly Pick<BurnrateCostLedger, 'hours'>[], now: number): Record<string, number> {
  const merged: Record<string, number> = {}
  for (const ledger of ledgers) {
    for (const [hour, usd] of Object.entries(recentHours(ledger.hours, now))) merged[hour] = (merged[hour] ?? 0) + usd
  }

  return merged
}

export function quotaUsdPerPoint(ratios: readonly WindowRatio[], currentKey: string): number | null {
  const current = ratios.find(ratio => ratio.windowKey === currentKey)
  if (current === undefined) return null
  if (current.usdPerPoint !== null) return current.usdPerPoint

  const latestClosed = ratios.filter(ratio => ratio.resetsAt < current.resetsAt && ratio.usdPerPoint !== null).at(-1)

  return latestClosed?.usdPerPoint ?? null
}
