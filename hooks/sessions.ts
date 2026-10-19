import type { BurnrateSessionCost } from '../types'
import { HOUR_MS } from './pace'

type ProjectSpend = { label: string; usd: number }

export type WeekSpend = { sessionUsd: number; projects: ProjectSpend[] }

const TOP_PROJECTS = 5

function usdSince(hours: Readonly<Record<string, number>>, sinceHour: number): number {
  return Object.entries(hours).reduce((sum, [hour, usd]) => (Number(hour) >= sinceHour ? sum + usd : sum), 0)
}

export function weekSpend(sessions: readonly BurnrateSessionCost[], since: number, currentId: string): WeekSpend {
  const sinceHour = Math.floor(since / HOUR_MS)
  const byLabel = new Map<string, number>()
  for (const session of sessions) {
    byLabel.set(session.label, (byLabel.get(session.label) ?? 0) + usdSince(session.hours, sinceHour))
  }

  const current = sessions.find(session => session.id === currentId)
  const projects = [...byLabel]
    .map(([label, usd]) => ({ label, usd }))
    .filter(project => project.usd > 0)
    .sort((a, b) => b.usd - a.usd)
    .slice(0, TOP_PROJECTS)

  return { sessionUsd: usdSince(current?.hours ?? {}, sinceHour), projects }
}
