import type { ElementTable } from 'claude-code'

import type { PaneView, StageTone } from '../types'
import {
  EMPTY_LINES,
  ERROR_LINES,
  LOADING_LINE,
  MARK_SYMBOL,
  ONCE_LINE,
  layoutPane,
  unitHeader,
} from './progress'
import type { PaneLine } from './progress'

export const TONE_COLORS: Record<StageTone, string> = {
  always: 'suggestion',
  conditional: 'warning',
  none: 'inactive',
}

export const UNITS_COLOR = 'success'

const NAME_WIDTH = 26

export type PaneSize = { bodyRows: number; bodyColumns: number }

function drawLine({ Text }: ElementTable, line: PaneLine, size: PaneSize) {
  switch (line.kind) {
    case 'notice':
      return <Text bold wrap="truncate-end">{line.text}</Text>
    case 'summary':
      return <Text wrap="truncate-end">{line.text}</Text>
    case 'blank':
      return <Text> </Text>
    case 'phase':
      return <Text bold>{line.text}</Text>
    case 'phase-done':
      return <Text wrap="truncate-end">✓ {line.text}</Text>
    case 'units':
      return (
        <Text wrap="truncate-end">
          {unitHeader(line.units, size.bodyColumns).map(part =>
            part.isMark ? <Text color={UNITS_COLOR}>{part.text}</Text> : part.text)}
        </Text>
      )
    case 'once':
      return <Text color={UNITS_COLOR} wrap="truncate-end">{ONCE_LINE}</Text>
    case 'stage': {
      const label = `${line.stage.number} ${line.stage.name}`
      const row = (
        <Text inverse={line.isCurrent} bold={line.isCurrent} wrap="truncate-end">
          {MARK_SYMBOL[line.stage.mark]} <Text color={TONE_COLORS[line.stage.tone]}>{label}</Text>
        </Text>
      )
      if (line.bracket === null) return row
      return (
        <Text wrap="truncate-end">
          <Text color={UNITS_COLOR}>{line.bracket === 'end' ? '└ ' : '│ '}</Text>
          {row}
          {line.unitCount === '' ? '' : ' '.repeat(Math.max(1, NAME_WIDTH - label.length))}
          {line.unitCount === '' ? '' : <Text color={UNITS_COLOR} dimColor>{line.unitCount}</Text>}
        </Text>
      )
    }
    case 'skipped':
      return <Text wrap="truncate-end">– <Text color={TONE_COLORS.none}>{String(line.count)} skipped</Text></Text>
    case 'rule':
      return <Text dimColor>{'─'.repeat(Math.max(1, size.bodyColumns))}</Text>
    case 'legend':
      return <Text wrap="truncate-end">{line.text}</Text>
    case 'legend-tones':
      return (
        <Text wrap="truncate-end">
          Color: <Text color={TONE_COLORS.always}>■ always</Text> <Text color={TONE_COLORS.conditional}>■ conditional</Text>{' '}
          <Text color={TONE_COLORS.none}>■ skipped</Text>
        </Text>
      )
  }
}

function drawMessage({ Box, Text }: ElementTable, lines: readonly string[], detail = '') {
  return (
    <Box flexDirection="column">
      {lines.map(text => <Text>{text}</Text>)}
      {detail === '' ? [] : [<Text dimColor>{detail}</Text>]}
    </Box>
  )
}

export function drawPane(elements: ElementTable, view: PaneView, size: PaneSize) {
  const { Box } = elements
  switch (view.kind) {
    case 'loading':
      return drawMessage(elements, [LOADING_LINE])
    case 'none':
      return drawMessage(elements, EMPTY_LINES)
    case 'error':
      return drawMessage(elements, ERROR_LINES, view.reason)
    case 'progress':
      return (
        <Box flexDirection="column">
          {layoutPane(view.progress, size.bodyRows, view.isStale).map(line => drawLine(elements, line, size))}
        </Box>
      )
  }
}
