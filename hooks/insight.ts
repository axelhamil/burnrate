import type { BurnrateSnapshot } from '../types'
import { formatPct } from './format'
import { dailyUsage, describeWindow, localDate, type DayUsage, type WindowKind, type WindowView } from './pace'
import { detectQuotaChange, quotaUsdPerPoint, windowRatios, type QuotaChange } from './quota-size'

export type Verdict = 'room' | 'on_track' | 'ahead' | 'will_hit' | 'limit'

export type QuotaSize = { usdPerPoint: number; change: QuotaChange | null }

export type WindowInsight = {
  view: WindowView
  verdict: Verdict
  hitAt: number | null
  size: QuotaSize | null
  days: DayUsage[]
}

const AHEAD_RATIO = 0.85
const ROOM_RATIO = 1.15
const ROOM_MAX_PROJECTION = 85
const KIND_ORDER: Record<WindowKind, number> = { seven_day: 0, five_hour: 1 }

export function verdictOf(view: WindowView): Verdict {
  if (view.pct >= 100) return 'limit'
  if (view.projected !== null && view.projected > 100) return 'will_hit'

  const ratio = view.budget?.ratio
  if (ratio === undefined) return 'on_track'
  if (ratio < AHEAD_RATIO) return 'ahead'
  if (ratio >= ROOM_RATIO && (view.projected ?? 0) <= ROOM_MAX_PROJECTION) return 'room'

  return 'on_track'
}

export function hitTime(view: WindowView, now: number): number | null {
  if (view.projected === null || view.projected <= 100 || view.secondsLeft <= 0) return null

  const pctPerSecond = (view.projected - view.pct) / view.secondsLeft
  if (pctPerSecond <= 0) return null

  return now + ((100 - view.pct) / pctPerSecond) * 1_000
}

function quotaSize(state: BurnrateSnapshot, view: WindowView): QuotaSize | null {
  const ratios = windowRatios(state.history.hours, state.costs, view.kind, state.now)
  const usdPerPoint = quotaUsdPerPoint(ratios, view.key)
  if (usdPerPoint === null) return null

  const change = view.kind === 'seven_day' ? detectQuotaChange(ratios, view.key) : null

  return { usdPerPoint, change }
}

export function insightsOf(state: BurnrateSnapshot): WindowInsight[] {
  const today = localDate(state.now)
  const views = state.readings.flatMap(reading => {
    const view = describeWindow(reading, state.history, state.now, today)

    return view === null ? [] : [view]
  })

  return views
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
    .map(view => ({
      view,
      verdict: verdictOf(view),
      hitAt: hitTime(view, state.now),
      size: quotaSize(state, view),
      days: view.kind === 'seven_day' ? dailyUsage(state.history, view.key, view.pct) : [],
    }))
}

const VERDICT_WORDS: Record<Verdict, string> = {
  room: 'go wild',
  on_track: 'cruising',
  ahead: 'easy tiger',
  will_hit: 'hit the brakes',
  limit: 'tapped out',
}
const VERDICT_SEVERITY: Record<Verdict, number> = { room: 0, on_track: 1, ahead: 2, will_hit: 3, limit: 4 }
const SPARK_BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
const EVEN_DAY_PCT = 100 / 7

export function sparkline(days: readonly DayUsage[]): string {
  const top = Math.max(EVEN_DAY_PCT, ...days.map(day => day.used))

  return days
    .map(day => SPARK_BARS[Math.min(SPARK_BARS.length - 1, Math.floor((day.used / top) * SPARK_BARS.length))] ?? '')
    .join('')
}

function weekStatus({ view, days }: WindowInsight): string {
  const parts = [view.projected === null ? `7d ${formatPct(view.pct)}` : `7d end ${view.projected}%`]
  if (view.budget !== null) parts.push(`${formatPct(view.budget.value)}/d`)
  if (view.today !== null) parts.push(`today ${Math.round(view.today.used)}/${formatPct(view.today.budget)}`)
  if (days.length >= 2) parts.push(sparkline(days))

  return parts.join(' · ')
}

function worstVerdict(insights: readonly WindowInsight[]): Verdict | null {
  return insights.reduce<Verdict | null>(
    (worst, { verdict }) => (worst === null || VERDICT_SEVERITY[verdict] > VERDICT_SEVERITY[worst] ? verdict : worst),
    null,
  )
}

export function statusText(insights: readonly WindowInsight[]): string | undefined {
  const week = insights.find(insight => insight.view.kind === 'seven_day')
  const hours = insights.find(insight => insight.view.kind === 'five_hour')
  const verdict = worstVerdict(insights)
  const parts = [
    verdict === null ? null : VERDICT_WORDS[verdict],
    week === undefined ? null : weekStatus(week),
    hours === undefined ? null : `5h ${formatPct(hours.view.pct)}`,
  ]
  const text = parts.filter(part => part !== null).join(' · ')

  return text === '' ? undefined : text
}
