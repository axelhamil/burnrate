import type { BurnrateHistory } from '../types'
import { formatDay, formatPct } from './format'
import { closedPeaks, dailyUsage, WEEK_MS, windowKey, type DayUsage } from './pace'

export type WeekReport = { key: string; peak: number; busiest: DayUsage | null }

export function lastWeekReport(history: BurnrateHistory, resetsAt: number, now: number): WeekReport | null {
  const last = closedPeaks(history, 'seven_day', resetsAt, now)[0]
  if (last === undefined || now - last.resetsAt >= WEEK_MS) return null

  const key = windowKey('seven_day', last.resetsAt)
  const busiest = dailyUsage(history, key, last.peak).reduce<DayUsage | null>(
    (top, day) => (top === null || day.used > top.used ? day : top),
    null,
  )

  return { key, peak: last.peak, busiest }
}

export function reportText({ peak, busiest }: WeekReport): string {
  const busiestText = busiest === null ? '' : `, busiest ${formatDay(busiest.date)} at ${formatPct(busiest.used)}`

  return `burnrate · last week peaked ${formatPct(peak)}${busiestText}`
}
