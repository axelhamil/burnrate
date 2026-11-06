import type { BurnrateSnapshot } from '../types'
import { dailyUsage, describeWindow, localDate, WEEK_MS, WINDOW_SECONDS, type DayUsage, type WindowKind, type WindowView } from './pace'
import { detectQuotaChange, quotaUsdPerPoint, windowRatios, type QuotaChange } from './quota-size'
import { lastWeekReport, type WeekReport } from './report'
import { weekSpend, type WeekSpend } from './sessions'

export type Verdict = 'room' | 'on_track' | 'ahead' | 'will_hit' | 'limit'

type QuotaSize = { usdPerPoint: number; change: QuotaChange | null }

export type WindowInsight = {
  view: WindowView
  verdict: Verdict
  hitAt: number | null
  size: QuotaSize | null
  days: DayUsage[]
  spend: WeekSpend | null
  lastWeek: WeekReport | null
}

export const VERDICT_WORDS: Record<Verdict, string> = {
  room: 'go wild',
  on_track: 'cruising',
  ahead: 'easy tiger',
  will_hit: 'hit the brakes',
  limit: 'tapped out',
}
export const VERDICT_SEVERITY: Record<Verdict, number> = { room: 0, on_track: 1, ahead: 2, will_hit: 3, limit: 4 }

const AHEAD_RATIO = 0.85
const ROOM_RATIO = 1.15
const ROOM_MAX_PROJECTION = 85
const HIT_MARGIN_AT_START = 10
const KIND_ORDER: Record<WindowKind, number> = { seven_day: 0, five_hour: 1 }

export function isVerdict(value: unknown): value is Verdict {
  return typeof value === 'string' && value in VERDICT_SEVERITY
}

export function worstVerdict(insights: readonly WindowInsight[]): Verdict | null {
  return insights.reduce<Verdict | null>(
    (worst, { verdict }) => (worst === null || VERDICT_SEVERITY[verdict] > VERDICT_SEVERITY[worst] ? verdict : worst),
    null,
  )
}

function hitMargin(view: WindowView): number {
  const leftShare = Math.min(1, view.secondsLeft / WINDOW_SECONDS[view.kind])

  return HIT_MARGIN_AT_START * leftShare
}

export function verdictOf(view: WindowView): Verdict {
  if (view.pct >= 100) return 'limit'
  if (view.projected !== null && view.projected > 100 + hitMargin(view)) return 'will_hit'

  const ratio = view.budget?.ratio
  if (ratio === undefined) return 'on_track'
  if (ratio < AHEAD_RATIO) return 'ahead'
  if (ratio >= ROOM_RATIO && (view.projected ?? 0) <= ROOM_MAX_PROJECTION) return 'room'

  return 'on_track'
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
    .map(view => {
      const isWeek = view.kind === 'seven_day'

      return {
        view,
        verdict: verdictOf(view),
        hitAt: view.hitAt,
        size: quotaSize(state, view),
        days: isWeek ? dailyUsage(state.history, view.key, view.pct) : [],
        spend: isWeek ? weekSpend(state.sessions, view.resetsAt - WEEK_MS, state.sessionId) : null,
        lastWeek: isWeek ? lastWeekReport(state.history, view.resetsAt, state.now) : null,
      }
    })
}
