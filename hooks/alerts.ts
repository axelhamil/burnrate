import type { BurnrateAlertState } from '../types'
import { formatClock } from './format'
import { isVerdict, VERDICT_SEVERITY, VERDICT_WORDS, type Verdict, type WindowInsight } from './insight'
import { resetsAtOfKey } from './pace'

export type Notice = { key: string; text: string }

type Alerts = { toasts: string[]; notices: Notice[]; state: BurnrateAlertState }

const IMMINENT_MS = 30 * 60_000
const BASELINE: Verdict = 'on_track'
const LABELS: Record<WindowInsight['view']['kind'], string> = { seven_day: '7d', five_hour: '5h' }

function noticeFor({ view, verdict, hitAt }: WindowInsight, now: number): string | null {
  const isWeek = view.kind === 'seven_day'
  if (verdict === 'limit') return `${LABELS[view.kind]} limit reached, resets ${formatClock(view.resetsAt, isWeek)}`
  if (hitAt === null || hitAt - now > IMMINENT_MS) return null

  return `${LABELS[view.kind]} limit around ${formatClock(hitAt, isWeek)}, ease off now`
}

export function parseAlertState(value: unknown): BurnrateAlertState {
  if (typeof value !== 'object' || value === null) return {}

  const entries = Object.entries(value).flatMap(([key, entry]: [string, unknown]) => {
    if (typeof entry !== 'object' || entry === null || !('verdict' in entry) || !('notified' in entry)) return []
    if (!isVerdict(entry.verdict) || typeof entry.notified !== 'boolean') return []

    return [[key, { verdict: entry.verdict, notified: entry.notified }] as const]
  })

  return Object.fromEntries(entries)
}

function isLive(key: string, now: number): boolean {
  const resetsAt = resetsAtOfKey(key)

  return resetsAt !== null && resetsAt > now
}

export function alertsFor(insights: readonly WindowInsight[], previous: BurnrateAlertState, now: number): Alerts {
  const toasts: string[] = []
  const notices: Notice[] = []
  const state: BurnrateAlertState = Object.fromEntries(Object.entries(previous).filter(([key]) => isLive(key, now)))

  for (const insight of insights) {
    const { view, verdict } = insight
    const before = previous[view.key]
    const beforeVerdict = isVerdict(before?.verdict) ? before.verdict : BASELINE
    const severity = VERDICT_SEVERITY[verdict]
    if (severity > VERDICT_SEVERITY[BASELINE] && severity > VERDICT_SEVERITY[beforeVerdict]) {
      toasts.push(`burnrate · ${LABELS[view.kind]} ${VERDICT_WORDS[verdict]}`)
    }

    const isNotified = before?.notified === true
    const notice = isNotified ? null : noticeFor(insight, now)
    if (notice !== null) notices.push({ key: view.key, text: notice })

    const worst = VERDICT_SEVERITY[verdict] > VERDICT_SEVERITY[beforeVerdict] ? verdict : beforeVerdict
    state[view.key] = { verdict: worst, notified: isNotified }
  }

  return { toasts, notices, state }
}

export function withNotified(state: BurnrateAlertState, keys: readonly string[]): BurnrateAlertState {
  const notified = keys.flatMap(key => {
    const entry = state[key]

    return entry === undefined ? [] : [[key, { ...entry, notified: true }] as const]
  })

  return { ...state, ...Object.fromEntries(notified) }
}
