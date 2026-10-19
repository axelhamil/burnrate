import type { ButtonProps, ElementConstructor, RenderElement } from 'claude-code'

import { formatPct, formatUsd } from './format'
import { VERDICT_SEVERITY, VERDICT_WORDS, worstVerdict, type Verdict, type WindowInsight } from './insight'
import { EVEN_DAY_PCT, projectionTone, type DayUsage } from './pace'
import { dayScale, smallBar, toneProps, VERDICT_COLORS, type Elements } from './pane'

const SPARK_BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
const WIDE_COLUMNS = 82
const GAP_COLUMNS = 3
const TODAY_BAR_WIDTH = 5
const ADVICE_SEVERITY = VERDICT_SEVERITY.ahead
const RANKS = { spark: 0, session: 1, today: 2, budget: 3, advice: 4, hours: 5, week: 6 } as const

type Part = { key: string; text: string; node: RenderElement; rank: number }

type BandElements = Elements & { Button: ElementConstructor<ButtonProps> }

type BandActions = { togglePane: () => void; suggestSonnet: () => void }

function sparkGlyph(used: number, top: number): string {
  return SPARK_BARS[Math.min(SPARK_BARS.length - 1, Math.floor((used / top) * SPARK_BARS.length))] ?? ''
}

export function sparkGlyphs(days: readonly DayUsage[]): string[] {
  const top = dayScale(days)

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

  return { key: 'session', text: `session ${value}`, node, rank: RANKS.session }
}

function projectionPart({ Text }: Elements, { view }: WindowInsight): Part {
  if (view.projected === null) {
    const node = (
      <Text>
        <Text dimColor>7d </Text>
        {formatPct(view.pct)}
      </Text>
    )

    return { key: 'week', text: `7d ${formatPct(view.pct)}`, node, rank: RANKS.week }
  }

  const projected = Math.round(view.projected)
  const node = (
    <Text>
      <Text dimColor>7d → </Text>
      <Text {...toneProps(projectionTone(view.projected))}>{projected}%</Text>
    </Text>
  )

  return { key: 'week', text: `7d → ${projected}%`, node, rank: RANKS.week }
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

  return { key: 'today', text: `today ${bar}${figures}`, node, rank: RANKS.today }
}

function budgetPart({ Text }: Elements, { view }: WindowInsight): Part | null {
  if (view.budget === null) return null

  const value = formatPct(view.budget.value)
  const node = (
    <Text>
      <Text {...toneProps(view.budget.tone)}>{value}</Text>
      <Text dimColor>/d</Text>
    </Text>
  )

  return { key: 'budget', text: `${value}/d`, node, rank: RANKS.budget }
}

function sparkPart({ Text }: Elements, { days }: WindowInsight): Part | null {
  if (days.length < 2) return null

  const glyphs = sparkGlyphs(days)
  const node = (
    <Text>
      {days.map((day, index) => (
        <Text color={day.used > EVEN_DAY_PCT ? 'warning' : 'success'}>{glyphs[index]}</Text>
      ))}
    </Text>
  )

  return { key: 'spark', text: glyphs.join(''), node, rank: RANKS.spark }
}

function weekParts(elements: Elements, insight: WindowInsight, columns: number): Part[] {
  const optional = [
    budgetPart(elements, insight),
    todayPart(elements, insight, columns),
    sessionPart(elements, insight),
    sparkPart(elements, insight),
  ]

  return [projectionPart(elements, insight), ...optional.filter(part => part !== null)]
}

function headPart({ Text }: Elements, verdict: Verdict): Part {
  const word = `● ${VERDICT_WORDS[verdict]}`
  const node = (
    <Text color={VERDICT_COLORS[verdict]}>
      ▌ <Text bold>{word}</Text>
    </Text>
  )

  return { key: 'verdict', text: `▌ ${word}`, node, rank: Number.POSITIVE_INFINITY }
}

function hoursPart({ Text }: Elements, { view, verdict }: WindowInsight): Part {
  const pct = formatPct(view.pct)
  const node = (
    <Text>
      <Text dimColor>5h </Text>
      <Text color={VERDICT_COLORS[verdict]}>{pct}</Text>
    </Text>
  )

  return { key: 'hours', text: `5h ${pct}`, node, rank: RANKS.hours }
}

function advicePart({ Text }: Elements, verdict: Verdict, model: string): Part | null {
  const isAdvised = VERDICT_SEVERITY[verdict] >= ADVICE_SEVERITY && model.toLowerCase().includes('opus')
  if (!isAdvised) return null

  return { key: 'advice', text: 'try sonnet', node: <Text color="warning">try sonnet</Text>, rank: RANKS.advice }
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
  elements: BandElements,
  insights: readonly WindowInsight[],
  columns: number,
  model: string,
  actions: BandActions,
): RenderElement | null {
  const verdict = worstVerdict(insights)
  if (verdict === null) return null

  const { Box, Button } = elements
  const week = insights.find(insight => insight.view.kind === 'seven_day')
  const hours = insights.find(insight => insight.view.kind === 'five_hour')
  const optional = [hours === undefined ? null : hoursPart(elements, hours), advicePart(elements, verdict, model)]
  const parts = [
    headPart(elements, verdict),
    ...(week === undefined ? [] : weekParts(elements, week, columns)),
    ...optional.filter(part => part !== null),
  ]

  return (
    <Box flexDirection="row" columnGap={GAP_COLUMNS}>
      {fitting(parts, columns).map(part => (
        <Button plain key={part.key} onPress={part.key === 'advice' ? actions.suggestSonnet : actions.togglePane}>
          {part.node}
        </Button>
      ))}
    </Box>
  )
}
