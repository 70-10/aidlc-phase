import type { ElementTable } from 'claude-code'

import type { PaneView, StageTone } from '../types'
import {
  EMPTY_LINES,
  ERROR_LINES,
  LOADING_LINE,
  MARK_SYMBOL,
  UNIT_SYMBOL,
  layoutPane,
} from './progress'
import type { PaneLine } from './progress'

export const TONE_COLORS: Record<StageTone, string> = {
  always: 'suggestion',
  conditional: 'warning',
  none: 'inactive',
}

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
    case 'stage':
      return (
        <Text inverse={line.isCurrent} bold={line.isCurrent} wrap="truncate-end">
          {MARK_SYMBOL[line.stage.mark]} <Text color={TONE_COLORS[line.stage.tone]}>{line.stage.number} {line.stage.name}</Text>
          {line.unitLabel === '' ? '' : `  ${line.unitLabel}`}
        </Text>
      )
    case 'unit':
      return <Text wrap="truncate-end">{`    ${UNIT_SYMBOL[line.unit.mark]} ${line.unit.name}`}</Text>
    case 'skipped':
      return <Text wrap="truncate-end">– <Text color={TONE_COLORS.none}>飛ばす {String(line.count)} 件</Text></Text>
    case 'rule':
      return <Text dimColor>{'─'.repeat(Math.max(1, size.bodyColumns))}</Text>
    case 'legend':
      return <Text wrap="truncate-end">{line.text}</Text>
    case 'legend-tones':
      return (
        <Text wrap="truncate-end">
          色: <Text color={TONE_COLORS.always}>■ 必ず実施</Text> <Text color={TONE_COLORS.conditional}>■ 条件付き</Text>{' '}
          <Text color={TONE_COLORS.none}>■ 実施しない</Text>
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
