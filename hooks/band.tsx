import type { RenderElement } from 'claude-code'

import { formatPct } from './format'
import type { Verdict, WindowInsight } from './insight'
import { projectionTone, type DayUsage } from './pace'
import { smallBar, toneProps, VERDICT_COLORS, type Elements } from './pane'

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
const WIDE_COLUMNS = 82
const MEDIUM_COLUMNS = 64
const TODAY_BAR_WIDTH = 5

function sparkGlyph(used: number, top: number): string {
  return SPARK_BARS[Math.min(SPARK_BARS.length - 1, Math.floor((used / top) * SPARK_BARS.length))] ?? ''
}

export function sparkGlyphs(days: readonly DayUsage[]): string[] {
  const top = Math.max(EVEN_DAY_PCT, ...days.map(day => day.used))

  return days.map(day => sparkGlyph(day.used, top))
}

function worstVerdict(insights: readonly WindowInsight[]): Verdict | null {
  return insights.reduce<Verdict | null>(
    (worst, { verdict }) => (worst === null || VERDICT_SEVERITY[verdict] > VERDICT_SEVERITY[worst] ? verdict : worst),
    null,
  )
}

function weekParts(elements: Elements, { view, days }: WindowInsight, columns: number): RenderElement[] {
  const isWide = columns >= WIDE_COLUMNS
  const { Text } = elements
  const parts = [
    view.projected === null ? (
      <Text>
        <Text dimColor>7d </Text>
        {formatPct(view.pct)}
      </Text>
    ) : (
      <Text>
        <Text dimColor>7d → </Text>
        <Text {...toneProps(projectionTone(view.projected))}>{view.projected}%</Text>
      </Text>
    ),
  ]
  if (view.budget !== null) {
    parts.push(
      <Text>
        <Text {...toneProps(view.budget.tone)}>{formatPct(view.budget.value)}</Text>
        <Text dimColor>/d</Text>
      </Text>,
    )
  }
  if (view.today !== null && columns >= MEDIUM_COLUMNS) {
    const { used, budget, tone } = view.today
    parts.push(
      <Text>
        <Text dimColor>today </Text>
        {isWide && smallBar(elements, budget > 0 ? used / budget : 1, TODAY_BAR_WIDTH, tone)}
        {isWide && ' '}
        <Text {...toneProps(tone)}>{Math.round(used)}</Text>
        <Text dimColor>/{formatPct(budget)}</Text>
      </Text>,
    )
  }
  if (isWide && days.length >= 2) {
    const glyphs = sparkGlyphs(days)
    parts.push(
      <Text>
        {days.map((day, index) => (
          <Text color={day.used > EVEN_DAY_PCT ? 'warning' : 'success'}>{glyphs[index]}</Text>
        ))}
      </Text>,
    )
  }

  return parts
}

export function bandTree(elements: Elements, insights: readonly WindowInsight[], columns: number): RenderElement | null {
  const verdict = worstVerdict(insights)
  if (verdict === null) return null

  const { Box, Text } = elements
  const week = insights.find(insight => insight.view.kind === 'seven_day')
  const hours = insights.find(insight => insight.view.kind === 'five_hour')

  return (
    <Box flexDirection="row" columnGap={3}>
      <Text bold color={VERDICT_COLORS[verdict]}>
        ● {VERDICT_WORDS[verdict]}
      </Text>
      {week !== undefined && weekParts(elements, week, columns)}
      {hours !== undefined && (
        <Text>
          <Text dimColor>5h </Text>
          <Text color={VERDICT_COLORS[hours.verdict]}>{formatPct(hours.view.pct)}</Text>
        </Text>
      )}
    </Box>
  )
}
