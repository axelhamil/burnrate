export type BurnrateReading = {
  kind: string
  percentUsed: number
  resetsAt?: string
}

export type BurnratePeak = {
  kind: string
  resetsAt: number
  peak: number
}

export type BurnrateDayStart = {
  windowKey: string
  date: string
  pct: number
  seenAt: number
}

export type BurnrateHourSample = {
  windowKey: string
  hour: number
  pct: number
}

export type BurnrateHistory = {
  peaks: Record<string, BurnratePeak>
  dayStarts: Record<string, BurnrateDayStart>
  hours: Record<string, BurnrateHourSample>
}

export type BurnrateCostLedger = {
  lastUsd: number
  hours: Record<string, number>
}

export type BurnrateSnapshot = {
  readings: BurnrateReading[]
  history: BurnrateHistory
  costs: Record<string, number>
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    burnrate: { snapshot: BurnrateSnapshot }
  }
}
