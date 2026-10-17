export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ${hours % 24}h`
  if (hours > 0) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`

  return `${minutes}m`
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function formatClock(ms: number, withWeekday: boolean): string {
  const date = new Date(ms)
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  if (!withWeekday) return time

  return `${WEEKDAYS[date.getDay()] ?? ''} ${time}`
}

export function formatDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return date

  const weekday = WEEKDAYS[new Date(year, month - 1, day).getDay()] ?? ''

  return `${weekday} ${String(day).padStart(2, '0')}`
}

export function formatPct(value: number): string {
  if (value >= 10) return `${Math.round(value)}%`

  return `${Math.round(value * 10) / 10}%`
}

export function formatUsd(usd: number): string {
  if (usd < 10) return `$${usd.toFixed(2)}`

  return `$${Math.round(usd)}`
}
