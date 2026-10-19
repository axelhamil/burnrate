import type { RenderElement } from 'claude-code'

import { formatPct, formatUsd } from './format'
import { VERDICT_SEVERITY, VERDICT_WORDS, worstVerdict, type WindowInsight } from './insight'
import { projectionTone, type DayUsage } from './pace'
import { smallBar, toneProps, VERDICT_COLORS, type Elements } from './pane'

const SPARK_BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
const EVEN_DAY_PCT = 100 / 7
const WIDE_COLUMNS = 82
const GAP_COLUMNS = 3
const TODAY_BAR_WIDTH = 5
const ADVICE_SEVERITY = VERDICT_SEVERITY.ahead
const RANKS = { spark: 0, session: 1, today: 2, budget: 3, advice: 4, hours: 5, week: 6 } as const

type Part = { text: string; node: RenderElement; rank: number }

function sparkGlyph(used: number, top: number): string {
  return SPARK_BARS[Math.min(SPARK_BARS.length - 1, Math.floor((used / top) * SPARK_BARS.length))] ?? ''
}

export function sparkGlyphs(days: readonly DayUsage[]): string[] {
  const top = Math.max(EVEN_DAY_PCT, ...days.map(day => day.used))

  return days.map(day => sparkGlyph(day.used, top))
}

function sessionPart({ Text }: Elements, { spend, size }: WindowInsight): Part | null {
  if (spend === null || spend.sessionUsd <= 0) return null

  const value = size === null ? formatUsd(spend.sessionUsd) : formatPct(spend.sessionUsd / size.usdPerPoint)
  const node = (
    <Text>
      <Text dimColor>session </Text>
      {value}
    </Text>
  )

  return { text: `session ${value}`, node, rank: RANKS.session }
}

function projectionPart({ Text }: Elements, { view }: WindowInsight): Part {
  if (view.projected === null) {
    const node = (
      <Text>
        <Text dimColor>7d </Text>
        {formatPct(view.pct)}
      </Text>
    )

    return { text: `7d ${formatPct(view.pct)}`, node, rank: RANKS.week }
  }

  const node = (
    <Text>
      <Text dimColor>7d → </Text>
      <Text {...toneProps(projectionTone(view.projected))}>{view.projected}%</Text>
    </Text>
  )

  return { text: `7d → ${view.projected}%`, node, rank: RANKS.week }
}

function todayPart(elements: Elements, { view }: WindowInsight, columns: number): Part | null {
  if (view.today === null) return null

  const { Text } = elements
  const { used, budget, tone } = view.today
  const isWide = columns >= WIDE_COLUMNS
  const figures = `${Math.round(used)}/${formatPct(budget)}`
  const node = (
    <Text>
      <Text dimColor>today </Text>
      {isWide && smallBar(elements, budget > 0 ? used / budget : 1, TODAY_BAR_WIDTH, tone)}
      {isWide && ' '}
      <Text {...toneProps(tone)}>{Math.round(used)}</Text>
      <Text dimColor>/{formatPct(budget)}</Text>
    </Text>
  )
  const bar = isWide ? `${'█'.repeat(TODAY_BAR_WIDTH)} ` : ''

  return { text: `today ${bar}${figures}`, node, rank: RANKS.today }
}

function weekParts(elements: Elements, insight: WindowInsight, columns: number): Part[] {
  const { view, days } = insight
  const { Text } = elements
  const parts = [projectionPart(elements, insight)]
  if (view.budget !== null) {
    const value = formatPct(view.budget.value)
    const node = (
      <Text>
        <Text {...toneProps(view.budget.tone)}>{value}</Text>
        <Text dimColor>/d</Text>
      </Text>
    )
    parts.push({ text: `${value}/d`, node, rank: RANKS.budget })
  }

  const optional = [todayPart(elements, insight, columns), sessionPart(elements, insight)]
  parts.push(...optional.filter(part => part !== null))
  if (days.length >= 2) {
    const glyphs = sparkGlyphs(days)
    const node = (
      <Text>
        {days.map((day, index) => (
          <Text color={day.used > EVEN_DAY_PCT ? 'warning' : 'success'}>{glyphs[index]}</Text>
        ))}
      </Text>
    )
    parts.push({ text: glyphs.join(''), node, rank: RANKS.spark })
  }

  return parts
}

function lineWidth(parts: readonly Part[]): number {
  return parts.reduce((sum, part) => sum + [...part.text].length + GAP_COLUMNS, -GAP_COLUMNS)
}

function fitting(parts: readonly Part[], columns: number): Part[] {
  if (lineWidth(parts) <= columns) return [...parts]

  const droppable = parts.filter(part => Number.isFinite(part.rank))
  if (droppable.length === 0) return [...parts]

  const lowest = Math.min(...droppable.map(part => part.rank))

  return fitting(
    parts.filter(part => part.rank !== lowest),
    columns,
  )
}

export function bandTree(
  elements: Elements,
  insights: readonly WindowInsight[],
  columns: number,
  model: string,
): RenderElement | null {
  const verdict = worstVerdict(insights)
  if (verdict === null) return null

  const { Box, Text } = elements
  const week = insights.find(insight => insight.view.kind === 'seven_day')
  const hours = insights.find(insight => insight.view.kind === 'five_hour')
  const isAdvised = VERDICT_SEVERITY[verdict] >= ADVICE_SEVERITY && model.toLowerCase().includes('opus')
  const word = `● ${VERDICT_WORDS[verdict]}`
  const head: Part = {
    text: `▌ ${word}`,
    node: (
      <Text color={VERDICT_COLORS[verdict]}>
        ▌ <Text bold>{word}</Text>
      </Text>
    ),
    rank: Number.POSITIVE_INFINITY,
  }
  const parts = [head, ...(week === undefined ? [] : weekParts(elements, week, columns))]
  if (hours !== undefined) {
    const pct = formatPct(hours.view.pct)
    const node = (
      <Text>
        <Text dimColor>5h </Text>
        <Text color={VERDICT_COLORS[hours.verdict]}>{pct}</Text>
      </Text>
    )
    parts.push({ text: `5h ${pct}`, node, rank: RANKS.hours })
  }
  if (isAdvised) parts.push({ text: 'try sonnet', node: <Text color="warning">try sonnet</Text>, rank: RANKS.advice })

  return (
    <Box flexDirection="row" columnGap={GAP_COLUMNS}>
      {fitting(parts, columns).map(part => part.node)}
    </Box>
  )
}
