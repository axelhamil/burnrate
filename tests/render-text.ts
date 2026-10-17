type Segment = { text: string; style: Style }

type Style = { color?: string; bold?: boolean; dim?: boolean }

type Line = Segment[]

const ANSI_COLORS: Record<string, string> = {
  success: '32',
  warning: '33',
  error: '31',
  claude: '38;5;209',
  subtle: '90',
  text: '',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function propsOf(node: Record<string, unknown>): Record<string, unknown> {
  return isRecord(node.props) ? node.props : {}
}

function childrenOf(node: Record<string, unknown>): unknown[] {
  return Array.isArray(node.children) ? node.children : []
}

function styleOf(props: Record<string, unknown>, parent: Style): Style {
  return {
    color: typeof props.color === 'string' ? props.color : parent.color,
    bold: props.bold === true || parent.bold,
    dim: props.dimColor === true || parent.dim,
  }
}

function inline(node: unknown, style: Style): Segment[] {
  if (typeof node === 'string' || typeof node === 'number') return [{ text: String(node), style }]
  if (Array.isArray(node)) return node.flatMap(child => inline(child, style))
  if (!isRecord(node)) return []

  const nested = styleOf(propsOf(node), style)

  return childrenOf(node).flatMap(child => inline(child, nested))
}

function widthOf(line: Line): number {
  return line.reduce((sum, segment) => sum + [...segment.text].length, 0)
}

function rowLines(children: unknown[], gap: number): Line[] {
  const blocks = children.map(child => block(child)).filter(lines => lines.length > 0)
  const height = Math.max(0, ...blocks.map(lines => lines.length))
  const widths = blocks.map(lines => Math.max(0, ...lines.map(widthOf)))

  return Array.from({ length: height }, (_, row) =>
    blocks.flatMap((lines, index) => {
      const line = lines[row] ?? []
      const pad = (widths[index] ?? 0) - widthOf(line)
      const spacer = index < blocks.length - 1 ? gap : 0

      return [...line, { text: ' '.repeat(pad + spacer), style: {} }]
    }),
  )
}

function block(node: unknown): Line[] {
  if (Array.isArray(node)) return node.flatMap(child => block(child))
  if (!isRecord(node)) return []
  if (node.type === 'Text') return [inline(node, {})]
  if (node.type !== 'Box') return []

  const props = propsOf(node)
  const children = childrenOf(node)
  const lines = props.flexDirection === 'row' ? rowLines(children, Number(props.columnGap ?? 0)) : children.flatMap(child => block(child))
  const after = Array.from({ length: Number(props.marginBottom ?? 0) }, (): Line => [])

  return [...lines, ...after]
}

export function toPlain(tree: unknown): string {
  return block(tree)
    .map(line => line.map(segment => segment.text).join('').trimEnd())
    .join('\n')
}

function ansi(segment: Segment): string {
  const codes = [
    segment.style.bold ? '1' : '',
    segment.style.dim ? '2' : '',
    segment.style.color === undefined ? '' : ANSI_COLORS[segment.style.color] ?? '',
  ].filter(code => code !== '')
  if (codes.length === 0) return segment.text

  return `\u001b[${codes.join(';')}m${segment.text}\u001b[0m`
}

export function toAnsi(tree: unknown): string {
  return block(tree)
    .map(line => line.map(ansi).join('').trimEnd())
    .join('\n')
}

export function widestLine(tree: unknown): number {
  return Math.max(0, ...toPlain(tree).split('\n').map(line => [...line].length))
}
