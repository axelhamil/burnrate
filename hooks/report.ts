import type { BurnrateHistory } from '../types'
import { closedPeaks, dailyUsage, windowKey, type DayUsage } from './pace'

export type WeekReport = { key: string; peak: number; busiest: DayUsage | null }

const WEEK_MS = 7 * 86_400_000

export function lastWeekReport(history: BurnrateHistory, resetsAt: number, now: number): WeekReport | null {
  const last = closedPeaks(history, 'seven_day', resetsAt)[0]
  if (last === undefined || now - last.resetsAt >= WEEK_MS) return null

  const key = windowKey('seven_day', last.resetsAt)
  const busiest = dailyUsage(history, key, last.peak).reduce<DayUsage | null>(
    (top, day) => (top === null || day.used > top.used ? day : top),
    null,
  )

  return { key, peak: last.peak, busiest }
}
