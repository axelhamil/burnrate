export type TracePoint = { elapsedSeconds: number; pct: number }

export type PastWindow = { peak: number; before: TracePoint | null; after: TracePoint | null }

export type Outlook = { typical: number; remaining: number | null; traced: number }

type AgedValue = { value: number; age: number }

const MIN_TRACED_WINDOWS = 2
const RECENCY_HALF_LIFE_WINDOWS = 2

function weightedMean(values: readonly AgedValue[], halfLife = RECENCY_HALF_LIFE_WINDOWS): number | null {
  if (values.length === 0) return null

  const weights = values.map(({ age }) => 0.5 ** (age / halfLife))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const weighted = values.reduce((sum, { value }, index) => sum + value * (weights[index] ?? 0), 0)

  return weighted / total
}

function pctAtElapsed(past: PastWindow, elapsedSeconds: number, windowSeconds: number): number | null {
  if (past.before === null && past.after === null) return null

  const from = past.before ?? { elapsedSeconds: 0, pct: 0 }
  const to = past.after ?? { elapsedSeconds: windowSeconds, pct: past.peak }
  const span = to.elapsedSeconds - from.elapsedSeconds
  if (span <= 0) return from.pct

  return from.pct + ((to.pct - from.pct) * (elapsedSeconds - from.elapsedSeconds)) / span
}

export function outlookOf(pastWindows: readonly PastWindow[], elapsedSeconds: number, windowSeconds: number): Outlook | null {
  const typical = weightedMean(pastWindows.map((past, age) => ({ value: past.peak, age })))
  if (typical === null) return null

  const remaining = pastWindows.flatMap((past, age) => {
    const pctThen = pctAtElapsed(past, elapsedSeconds, windowSeconds)

    return pctThen === null ? [] : [{ value: Math.max(0, past.peak - pctThen), age }]
  })
  const isTraced = remaining.length >= MIN_TRACED_WINDOWS

  return { typical, remaining: isTraced ? weightedMean(remaining) : null, traced: isTraced ? remaining.length : 0 }
}

export type HourSlot = { hourOfDay: number; ageDays: number; used: number }

const HOURS_PER_DAY = 24
const RECENCY_HALF_LIFE_DAYS = 3

export function hourlyProfile(slots: readonly HourSlot[]): number[] {
  return Array.from({ length: HOURS_PER_DAY }, (_, hourOfDay) => {
    const atHour = slots.filter(slot => slot.hourOfDay === hourOfDay).map(({ used, ageDays }) => ({ value: used, age: ageDays }))

    return weightedMean(atHour, RECENCY_HALF_LIFE_DAYS) ?? 0
  })
}
