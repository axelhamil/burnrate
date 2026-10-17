import type { BoxProps, Color, ElementConstructor, RenderElement, TextProps } from 'claude-code'

import { formatClock, formatDay, formatDuration, formatPct, formatUsd } from './format'
import type { Verdict, WindowInsight } from './insight'
import { projectionTone, type DayUsage, type Tone, type WindowView } from './pace'

export type Elements = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps> }

export type GaugeCell = { text: string; tone: CellTone }

type CellTone = 'filled' | 'empty' | 'marker'

type Layout = { gaugeWidth: number; barWidth: number; isWide: boolean; isSideBySide: boolean }

const EVEN_DAY_PCT = 100 / 7
const WIDE_COLUMNS = 80
const SIDE_BY_SIDE_COLUMNS = 120
const GAUGE_MAX = 48
const BAR_MAX = 24
const TITLES: Record<WindowView['kind'], string> = { seven_day: '7-day window', five_hour: '5-hour window' }
const UNITS: Record<WindowView['kind'], string> = { seven_day: 'day', five_hour: 'hour' }
const PERIODS_LONG: Record<WindowView['kind'], string> = { seven_day: 'week', five_hour: 'window' }
const PERIODS: Record<WindowView['kind'], string> = { seven_day: 'week', five_hour: '5h' }
const VERDICT_COLORS: Record<Verdict, Color> = {
  room: 'success',
  on_track: 'text',
  ahead: 'warning',
  will_hit: 'error',
  limit: 'error',
}

function layoutFor(columns: number): Layout {
  return {
    gaugeWidth: Math.max(10, Math.min(GAUGE_MAX, columns - 8)),
    barWidth: Math.max(4, Math.min(BAR_MAX, columns - 22)),
    isWide: columns >= WIDE_COLUMNS,
    isSideBySide: columns >= SIDE_BY_SIDE_COLUMNS,
  }
}

function toneProps(tone: Tone): TextProps {
  if (tone === 'alert') return { color: 'error' }
  if (tone === 'warn') return { color: 'warning' }
  if (tone === 'dim') return { dimColor: true }

  return {}
}

export function gaugeCells(width: number, usedPct: number, markerPct: number): GaugeCell[] {
  const filled = Math.round((Math.min(100, Math.max(0, usedPct)) / 100) * width)
  const marker = Math.min(width - 1, Math.round((markerPct / 100) * width))
  const cells = Array.from({ length: width }, (_, index): CellTone => {
    if (index === marker) return 'marker'

    return index < filled ? 'filled' : 'empty'
  })

  return cells.reduce<GaugeCell[]>((runs, tone) => {
    const glyph = tone === 'filled' ? '█' : tone === 'marker' ? '│' : '░'
    const last = runs.at(-1)
    if (last?.tone === tone) return [...runs.slice(0, -1), { text: last.text + glyph, tone }]

    return [...runs, { text: glyph, tone }]
  }, [])
}

function verdictText({ view, verdict, hitAt }: WindowInsight): string {
  if (verdict === 'limit') return 'Limit reached'
  if (verdict === 'will_hit' && hitAt !== null) return `Will hit the limit around ${formatClock(hitAt, view.kind === 'seven_day')}`
  if (verdict === 'will_hit') return 'Will hit the limit before reset'
  if (verdict === 'ahead') return 'Ahead of pace: ease off'
  if (verdict === 'room') return 'Room to spare'

  return 'On track'
}

function gauge({ Box, Text }: Elements, insight: WindowInsight, width: number): RenderElement {
  const color = VERDICT_COLORS[insight.verdict]
  const runs = gaugeCells(width, insight.view.pct, insight.view.elapsedPct)

  return (
    <Box flexDirection="row">
      {runs.map(run => {
        if (run.tone === 'filled') return <Text color={color}>{run.text}</Text>
        if (run.tone === 'marker') return <Text bold>{run.text}</Text>

        return <Text dimColor>{run.text}</Text>
      })}
      <Text> {formatPct(insight.view.pct)}</Text>
    </Box>
  )
}

function usedLine({ Text }: Elements, view: WindowView): RenderElement {
  const clock = formatClock(view.resetsAt, view.kind === 'seven_day')

  return (
    <Text>
      Used {formatPct(view.pct)} <Text dimColor>· resets {clock} (in {formatDuration(view.secondsLeft)})</Text>
    </Text>
  )
}

function basisText(view: WindowView): string {
  if (view.basis === 'linear') return 'linear, no history yet'
  if (view.basis === 'typical') return `typical ${PERIODS_LONG[view.kind]}`

  const plural = view.analogSample === 1 ? '' : 's'

  return `from your last ${view.analogSample} ${PERIODS_LONG[view.kind]}${plural}`
}

function projectionLine({ Text }: Elements, { view, verdict }: WindowInsight, layout: Layout): RenderElement | null {
  if (verdict === 'limit') return null
  if (view.projected === null) return <Text dimColor>Projected at reset: too early to tell</Text>

  return (
    <Text>
      Projected at reset <Text {...toneProps(projectionTone(view.projected))}>{view.projected}%</Text>
      {layout.isWide && <Text dimColor> {basisText(view)}</Text>}
    </Text>
  )
}

function budgetLine({ Text }: Elements, { view, verdict }: WindowInsight, layout: Layout): RenderElement | null {
  if (verdict === 'limit' || view.budget === null) return null

  const value = `${formatPct(view.budget.value)}/${UNITS[view.kind]}`

  return (
    <Text>
      Budget <Text {...toneProps(view.budget.tone)}>{value}</Text>
      {layout.isWide && <Text dimColor> to land at 100%</Text>}
    </Text>
  )
}

function smallBar({ Text }: Elements, ratio: number, width: number, tone: Tone): RenderElement {
  const filled = Math.min(width, Math.round(Math.max(0, ratio) * width))

  return (
    <Text>
      <Text {...toneProps(tone === 'dim' ? 'normal' : tone)}>{'█'.repeat(filled)}</Text>
      <Text dimColor>{'░'.repeat(width - filled)}</Text>
    </Text>
  )
}

function todayLine(elements: Elements, view: WindowView, layout: Layout): RenderElement | null {
  if (view.today === null) return null

  const { Box, Text } = elements
  const { used, budget, tone } = view.today
  const ratio = budget > 0 ? used / budget : 1

  return (
    <Box flexDirection="row" columnGap={1}>
      <Text>
        Today <Text {...toneProps(tone)}>{formatPct(used)}</Text> of {formatPct(budget)}
      </Text>
      {layout.isWide && smallBar(elements, ratio, 10, tone)}
    </Box>
  )
}

function dayRow(elements: Elements, day: DayUsage, scale: number, layout: Layout, isToday: boolean): RenderElement {
  const { Box, Text } = elements
  const tone: Tone = day.used > EVEN_DAY_PCT ? 'warn' : 'normal'

  return (
    <Box key={day.date} flexDirection="row" columnGap={1}>
      <Text bold={isToday} dimColor={!isToday}>
        {formatDay(day.date)}
      </Text>
      {smallBar(elements, day.used / scale, layout.barWidth, tone)}
      <Text bold={isToday} dimColor={!isToday}>
        {formatPct(day.used)}
        {isToday ? ' today' : ''}
      </Text>
    </Box>
  )
}

function daysBlock(elements: Elements, days: DayUsage[], today: string, layout: Layout): RenderElement | null {
  if (days.length === 0) return null

  const scale = Math.max(EVEN_DAY_PCT, ...days.map(day => day.used))
  const { Box } = elements

  return <Box flexDirection="column">{days.map(day => dayRow(elements, day, scale, layout, day.date === today))}</Box>
}

function quotaLines({ Text }: Elements, { view, size }: WindowInsight): RenderElement[] {
  if (size === null) return [<Text dimColor>Quota size: learning (needs 5 points)</Text>]

  const quota = (
    <Text>
      Quota ≈ {formatUsd(size.usdPerPoint * 100)} / {PERIODS[view.kind]}{' '}
      <Text dimColor>(1% ≈ {formatUsd(size.usdPerPoint)})</Text>
    </Text>
  )
  if (size.change === null) return [quota]

  const change = (
    <Text color={size.change.direction === 'down' ? 'error' : 'success'}>
      Quota {size.change.direction} ~{size.change.percent}% vs usual
    </Text>
  )

  return [quota, change]
}

function section(elements: Elements, insight: WindowInsight, today: string, layout: Layout): RenderElement {
  const { Box, Text } = elements
  const { view } = insight

  return (
    <Box key={view.kind} flexDirection="column" marginBottom={1}>
      <Text>
        <Text bold>{TITLES[view.kind]}</Text>
        <Text dimColor> · </Text>
        <Text bold color={VERDICT_COLORS[insight.verdict]}>
          {verdictText(insight)}
        </Text>
      </Text>
      {gauge(elements, insight, layout.gaugeWidth)}
      {usedLine(elements, view)}
      {projectionLine(elements, insight, layout)}
      {budgetLine(elements, insight, layout)}
      {todayLine(elements, view, layout)}
      {daysBlock(elements, insight.days, today, layout)}
      {quotaLines(elements, insight)}
    </Box>
  )
}

function footer({ Text }: Elements, layout: Layout): RenderElement {
  if (!layout.isWide) return <Text dimColor>│ even pace now · $ API-equivalent, this machine</Text>

  return <Text dimColor>│ marks where an even pace would be now. $ are API-equivalent and count this machine only.</Text>
}

export function paneTree(elements: Elements, insights: readonly WindowInsight[], today: string, columns: number): RenderElement {
  const { Box, Text } = elements
  if (insights.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold>No quota data yet</Text>
        <Text dimColor>Needs a subscription and one API response.</Text>
      </Box>
    )
  }

  const layout = layoutFor(columns)

  return (
    <Box flexDirection="column">
      <Box flexDirection={layout.isSideBySide ? 'row' : 'column'} columnGap={4}>
        {insights.map(insight => section(elements, insight, today, layout))}
      </Box>
      {footer(elements, layout)}
    </Box>
  )
}
