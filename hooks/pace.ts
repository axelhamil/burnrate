import type { BurnrateDayStart, BurnrateHistory, BurnrateHourSample, BurnratePeak, BurnrateReading } from '../types'
import { outlookOf, type Outlook, type PastWindow, type TracePoint } from './outlook'

export type WindowKind = 'five_hour' | 'seven_day'

export type Tone = 'normal' | 'dim' | 'warn' | 'alert'

export type Budget = { value: number; unit: 'd' | 'h'; ratio: number; tone: Tone }

export type Today = { used: number; budget: number; tone: Tone }

export type DayUsage = { date: string; used: number }

export type ProjectionBasis = 'analog' | 'typical' | 'linear'

export type WindowView = {
  kind: WindowKind
  key: string
  pct: number
  resetsAt: number
  secondsLeft: number
  elapsedPct: number
  basis: ProjectionBasis
  analogSample: number
  projected: number | null
  projectionTone: Tone
  budget: Budget | null
  today: Today | null
}

const MINUTE_MS = 60_000
const HOUR_SECONDS = 3_600
const DAY_SECONDS = 86_400
const KEY_ROUNDING_MS = 10 * MINUTE_MS
const DAY_START_RETENTION_MS = 30 * DAY_SECONDS * 1_000
const ANALOG_RETENTION_MS = 49 * DAY_SECONDS * 1_000
const HOUR_MS = HOUR_SECONDS * 1_000
const ANALOG_WINDOWS = 6
const MIN_LINEAR_ELAPSED = 0.1

export const WINDOW_SECONDS: Record<WindowKind, number> = {
  five_hour: 5 * HOUR_SECONDS,
  seven_day: 7 * DAY_SECONDS,
}

export const EMPTY_HISTORY: BurnrateHistory = { peaks: {}, dayStarts: {}, hours: {} }

export function isWindowKind(kind: string): kind is WindowKind {
  return kind === 'five_hour' || kind === 'seven_day'
}

export function roundResetsAt(resetsAtMs: number): number {
  return Math.round(resetsAtMs / KEY_ROUNDING_MS) * KEY_ROUNDING_MS
}

export function windowKey(kind: WindowKind, resetsAtMs: number): string {
  return `${kind}@${roundResetsAt(resetsAtMs)}`
}

export function localDate(ms: number): string {
  const date = new Date(ms)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${date.getFullYear()}-${month}-${day}`
}

function resetsAtMs(reading: BurnrateReading): number | null {
  if (reading.resetsAt === undefined) return null

  const parsed = Date.parse(reading.resetsAt)

  return Number.isFinite(parsed) ? parsed : null
}

function withPeak(history: BurnrateHistory, kind: WindowKind, resetsAt: number, pct: number): BurnrateHistory {
  const key = windowKey(kind, resetsAt)
  const previous = history.peaks[key]
  if (previous !== undefined && previous.peak >= pct) return history

  const peak: BurnratePeak = { kind, resetsAt: roundResetsAt(resetsAt), peak: pct }

  return { ...history, peaks: { ...history.peaks, [key]: peak } }
}

function withDayStart(history: BurnrateHistory, key: string, pct: number, now: number, today: string): BurnrateHistory {
  const dayKey = `${key}#${today}`
  if (history.dayStarts[dayKey] !== undefined) return history

  const start: BurnrateDayStart = { windowKey: key, date: today, pct, seenAt: now }

  return { ...history, dayStarts: { ...history.dayStarts, [dayKey]: start } }
}

function withHourSample(history: BurnrateHistory, key: string, pct: number, now: number): BurnrateHistory {
  const hour = Math.floor(now / HOUR_MS)
  const hourKey = `${key}#${hour}`
  const previous = history.hours[hourKey]
  if (previous !== undefined && previous.pct >= pct) return history

  const sample: BurnrateHourSample = { windowKey: key, hour, pct }

  return { ...history, hours: { ...history.hours, [hourKey]: sample } }
}

function kept<T>(entries: Record<string, T>, isKept: (entry: T) => boolean): Record<string, T> {
  const all = Object.entries(entries)
  const filtered = all.filter(([, entry]) => isKept(entry))
  if (filtered.length === all.length) return entries

  return Object.fromEntries(filtered)
}

function pruned(history: BurnrateHistory, now: number): BurnrateHistory {
  const oldestPeak = now - ANALOG_RETENTION_MS
  const oldestHour = Math.floor((now - ANALOG_RETENTION_MS) / HOUR_MS)
  const peaks = kept(history.peaks, peak => peak.resetsAt >= oldestPeak)
  const dayStarts = kept(history.dayStarts, start => start.seenAt >= now - DAY_START_RETENTION_MS)
  const hours = kept(history.hours, sample => sample.hour >= oldestHour)
  if (peaks === history.peaks && dayStarts === history.dayStarts && hours === history.hours) return history

  return { peaks, dayStarts, hours }
}

export function recordReadings(
  history: BurnrateHistory,
  readings: readonly BurnrateReading[],
  now: number,
  today: string,
): BurnrateHistory {
  const recorded = readings.reduce((current, reading) => {
    const resetsAt = resetsAtMs(reading)
    if (resetsAt === null || !isWindowKind(reading.kind)) return current

    const peaked = withPeak(current, reading.kind, resetsAt, reading.percentUsed)
    const key = windowKey(reading.kind, resetsAt)
    const sampled = withHourSample(peaked, key, reading.percentUsed, now)
    if (reading.kind !== 'seven_day') return sampled

    return withDayStart(sampled, key, reading.percentUsed, now, today)
  }, history)

  return pruned(recorded, now)
}

export function closedPeaks(history: BurnrateHistory, kind: WindowKind, resetsAt: number): BurnratePeak[] {
  const current = roundResetsAt(resetsAt)

  return Object.values(history.peaks)
    .filter(peak => peak.kind === kind && peak.resetsAt < current)
    .sort((a, b) => b.resetsAt - a.resetsAt)
    .slice(0, ANALOG_WINDOWS)
}

function tracePoints(history: BurnrateHistory, peak: BurnratePeak, kind: WindowKind): TracePoint[] {
  const key = windowKey(kind, peak.resetsAt)
  const windowSeconds = WINDOW_SECONDS[kind]
  const startMs = peak.resetsAt - windowSeconds * 1_000

  return Object.values(history.hours)
    .filter(sample => sample.windowKey === key)
    .map(sample => {
      const elapsedSeconds = ((sample.hour + 1) * HOUR_MS - startMs) / 1_000

      return { elapsedSeconds: Math.min(windowSeconds, Math.max(0, elapsedSeconds)), pct: sample.pct }
    })
    .sort((a, b) => a.elapsedSeconds - b.elapsedSeconds)
}

function pastWindowOf(history: BurnrateHistory, peak: BurnratePeak, kind: WindowKind, elapsedSeconds: number): PastWindow {
  const points = tracePoints(history, peak, kind)
  const before = points.filter(point => point.elapsedSeconds <= elapsedSeconds).at(-1) ?? null
  const after = points.find(point => point.elapsedSeconds > elapsedSeconds) ?? null

  return { peak: peak.peak, before, after }
}

export function outlookFor(history: BurnrateHistory, kind: WindowKind, resetsAt: number, elapsedSeconds: number): Outlook | null {
  const pastWindows = closedPeaks(history, kind, resetsAt).map(peak => pastWindowOf(history, peak, kind, elapsedSeconds))

  return outlookOf(pastWindows, elapsedSeconds, WINDOW_SECONDS[kind])
}

export type ProjectionInput = {
  pct: number
  secondsLeft: number
  windowSeconds: number
  outlook: Outlook | null
}

export function projectAtReset({ pct, secondsLeft, windowSeconds, outlook }: ProjectionInput): number | null {
  const elapsed = Math.min(1, Math.max(0, 1 - secondsLeft / windowSeconds))

  if (outlook === null) {
    if (elapsed < MIN_LINEAR_ELAPSED) return null

    return Math.round(pct / elapsed)
  }

  if (outlook.remaining !== null) return Math.round(pct + outlook.remaining)

  const remaining = 1 - elapsed
  const blended = pct + remaining * outlook.typical

  return Math.round(pct + remaining * blended)
}

function basisOf(outlook: Outlook | null): ProjectionBasis {
  if (outlook === null) return 'linear'

  return outlook.remaining === null ? 'typical' : 'analog'
}

export function projectionTone(projected: number | null): Tone {
  if (projected === null) return 'dim'
  if (projected > 100) return 'alert'
  if (projected > 85) return 'warn'

  return 'normal'
}

export function paceTone(ratio: number): Tone {
  if (ratio < 0.5) return 'alert'
  if (ratio < 0.85) return 'warn'

  return 'dim'
}

export function budgetLeft(kind: WindowKind, pct: number, secondsLeft: number): Budget | null {
  if (secondsLeft <= 0) return null

  const unitSeconds = kind === 'seven_day' ? DAY_SECONDS : HOUR_SECONDS
  const evenSplit = (100 * unitSeconds) / WINDOW_SECONDS[kind]
  const value = Math.max(0, 100 - pct) / (secondsLeft / unitSeconds)
  const unit = kind === 'seven_day' ? 'd' : 'h'
  const ratio = value / evenSplit

  return { value, unit, ratio, tone: paceTone(ratio) }
}

export function todayUsage(pct: number, start: BurnrateDayStart, resetsAt: number): Today | null {
  const daysLeft = (resetsAt - start.seenAt) / (DAY_SECONDS * 1_000)
  if (daysLeft <= 0) return null

  const used = Math.max(0, pct - start.pct)
  const headroom = Math.max(0, 100 - start.pct)
  const budget = Math.min(headroom, headroom / daysLeft)

  return { used, budget, tone: todayTone(used, budget) }
}

function todayTone(used: number, budget: number): Tone {
  if (used > budget) return 'alert'
  if (used > 0.85 * budget) return 'warn'

  return 'dim'
}

function startsOf(history: BurnrateHistory, key: string): BurnrateDayStart[] {
  return Object.values(history.dayStarts)
    .filter(start => start.windowKey === key)
    .sort((a, b) => a.seenAt - b.seenAt)
}

export function dailyUsage(history: BurnrateHistory, key: string, pct: number): DayUsage[] {
  const starts = startsOf(history, key)

  return starts.map((start, index) => {
    const end = starts[index + 1]?.pct ?? pct

    return { date: start.date, used: Math.max(0, end - start.pct) }
  })
}

export function describeWindow(
  reading: BurnrateReading,
  history: BurnrateHistory,
  now: number,
  today: string,
): WindowView | null {
  const resetsAt = resetsAtMs(reading)
  if (resetsAt === null || !isWindowKind(reading.kind)) return null

  if (resetsAt <= now) return null

  const kind = reading.kind
  const pct = reading.percentUsed
  const key = windowKey(kind, resetsAt)
  const secondsLeft = Math.max(0, (resetsAt - now) / 1_000)
  const windowSeconds = WINDOW_SECONDS[kind]
  const outlook = outlookFor(history, kind, resetsAt, Math.max(0, windowSeconds - secondsLeft))
  const projected = projectAtReset({ pct, secondsLeft, windowSeconds, outlook })
  const start = history.dayStarts[`${key}#${today}`]
  const todayView = kind === 'seven_day' && start !== undefined ? todayUsage(pct, start, resetsAt) : null

  return {
    kind,
    key,
    pct,
    resetsAt,
    secondsLeft,
    elapsedPct: Math.min(100, Math.max(0, 100 * (1 - secondsLeft / WINDOW_SECONDS[kind]))),
    basis: basisOf(outlook),
    analogSample: outlook?.traced ?? 0,
    projected,
    projectionTone: projectionTone(projected),
    budget: budgetLeft(kind, pct, secondsLeft),
    today: todayView,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asPeak(value: unknown): BurnratePeak | null {
  if (!isRecord(value)) return null

  const { kind, resetsAt, peak } = value
  if (typeof kind !== 'string' || typeof resetsAt !== 'number' || typeof peak !== 'number') return null

  return { kind, resetsAt, peak }
}

function asDayStart(value: unknown): BurnrateDayStart | null {
  if (!isRecord(value)) return null

  const { windowKey: key, date, pct, seenAt } = value
  if (typeof key !== 'string' || typeof date !== 'string' || typeof pct !== 'number' || typeof seenAt !== 'number') return null

  return { windowKey: key, date, pct, seenAt }
}

function asHourSample(value: unknown): BurnrateHourSample | null {
  if (!isRecord(value)) return null

  const { windowKey: key, hour, pct } = value
  if (typeof key !== 'string' || typeof hour !== 'number' || typeof pct !== 'number') return null

  return { windowKey: key, hour, pct }
}

function validEntries<T>(value: unknown, parse: (entry: unknown) => T | null): Record<string, T> {
  if (!isRecord(value)) return {}

  const entries = Object.entries(value).flatMap(([key, entry]) => {
    const parsed = parse(entry)

    return parsed === null ? [] : [[key, parsed] as const]
  })

  return Object.fromEntries(entries)
}

export function parseHistory(value: unknown): BurnrateHistory {
  if (!isRecord(value)) return EMPTY_HISTORY

  return {
    peaks: validEntries(value.peaks, asPeak),
    dayStarts: validEntries(value.dayStarts, asDayStart),
    hours: validEntries(value.hours, asHourSample),
  }
}
