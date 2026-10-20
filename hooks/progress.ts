import type { Progress, StageMark, StageRow, StageTone, UnitMark, UnitProgress, UnitRow } from '../types'

export class ProgressReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProgressReadError'
  }
}

export type StageInfo = { slug: string; number: string; name: string; phase: string; execution: 'ALWAYS' | 'CONDITIONAL' }

export type IntentRef = { space: string | null; slug: string }

const SLUG = /^[a-z0-9][a-z0-9-]*$/
const UNIT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SPACE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const RECORD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function intentFromLine(left: string): IntentRef | null {
  const body = left.replace(/^\[AIDLC\]\s*/, '')
  const segments = body.split(' · ').map(part => part.trim())
  if (segments.length >= 3 && segments[1]) {
    return SPACE_NAME.test(segments[0] ?? '') ? { space: segments[0]!, slug: segments[1] } : null
  }
  if (segments.length === 2 && segments[0]) return { space: null, slug: segments[0] }
  return null
}

export function spaceFromCursor(text: string | null): string {
  const name = (text ?? '').trim()
  return SPACE_NAME.test(name) ? name : 'default'
}

type IntentEntry = { slug?: unknown; dirName?: unknown; status?: unknown }

export function recordDirFor(intentsJson: string, slug: string): string {
  let rows: unknown
  try {
    rows = JSON.parse(intentsJson)
  } catch {
    throw new ProgressReadError('intents.json is not JSON')
  }
  if (!Array.isArray(rows)) throw new ProgressReadError('intents.json is not a list')
  const named = (rows as IntentEntry[]).filter(
    row => row?.slug === slug && typeof row.dirName === 'string' && RECORD_NAME.test(row.dirName),
  )
  if (named.length === 1) return named[0]!.dirName as string
  const inFlight = named.filter(row => row.status === 'in-flight')
  if (inFlight.length === 1) return inFlight[0]!.dirName as string
  throw new ProgressReadError(
    named.length === 0 ? `no intent named ${slug}` : `${named.length} intents named ${slug}, ${inFlight.length} in flight`,
  )
}

export function readStageGraph(json: string): StageInfo[] {
  let rows: unknown
  try {
    rows = JSON.parse(json)
  } catch {
    throw new ProgressReadError('stage-graph.json is not JSON')
  }
  if (!Array.isArray(rows)) throw new ProgressReadError('stage-graph.json is not a list')
  const stages: StageInfo[] = []
  for (const row of rows as Array<Record<string, unknown>>) {
    // Stages a plugin adds carry `plugin`; only AI-DLC's own are listed.
    if (row === null || typeof row !== 'object' || row.plugin !== undefined) continue
    const { slug, number, name, phase, execution } = row
    if (
      typeof slug !== 'string' || typeof number !== 'string' || typeof name !== 'string' ||
      typeof phase !== 'string' || (execution !== 'ALWAYS' && execution !== 'CONDITIONAL')
    ) {
      throw new ProgressReadError(`stage-graph.json has a stage it cannot read: ${String(slug)}`)
    }
    stages.push({ slug, number, name, phase, execution })
  }
  if (stages.length === 0) throw new ProgressReadError('stage-graph.json lists no stage')
  return stages
}

export function extractField(state: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`^-\\s*\\*\\*${escaped}\\*\\*:[^\\S\\n]*([^\\n]*)`, 'm').exec(state)
  return match ? match[1]!.replace(/\r$/, '').trim() : ''
}

function stageProgressSection(state: string): string[] {
  const lines = state.split(/\r?\n/)
  const start = lines.findIndex(line => /^##\s+Stage Progress\s*$/.test(line))
  if (start < 0) throw new ProgressReadError('aidlc-state.md has no Stage Progress')
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => /^##\s/.test(line))
  return end < 0 ? rest : rest.slice(0, end)
}

const EXECUTE_MARKS: Record<string, StageMark> = { ' ': 'todo', '-': 'running', '?': 'awaiting', R: 'revising', x: 'done' }

function markOf(box: string, kind: string): StageMark | null {
  if (box === 'S') return 'skipped'
  if (kind === 'SKIP') return box === ' ' ? 'skipped' : null
  return EXECUTE_MARKS[box] ?? null
}

export function readStageProgress(state: string, graph: readonly StageInfo[]): StageRow[] {
  const known = new Map(graph.map(stage => [stage.slug, stage]))
  const marks = new Map<string, StageMark>()
  for (const line of stageProgressSection(state)) {
    const row = /^- \[(.)\] (\S+) — (\S+)\s*$/.exec(line)
    if (!row) continue
    const [, box, slug, kind] = row as unknown as [string, string, string, string]
    if (!known.has(slug)) continue
    const mark = kind === 'EXECUTE' || kind === 'SKIP' ? markOf(box, kind) : null
    if (mark === null) throw new ProgressReadError(`aidlc-state.md row it cannot read: ${line.trim()}`)
    marks.set(slug, mark)
  }
  return graph.map(stage => {
    const mark = marks.get(stage.slug)
    if (mark === undefined) throw new ProgressReadError(`aidlc-state.md has no row for ${stage.slug}`)
    const tone: StageTone = mark === 'skipped' ? 'none' : stage.execution === 'ALWAYS' ? 'always' : 'conditional'
    return { slug: stage.slug, number: stage.number, name: stage.name, phase: stage.phase, mark, tone }
  })
}

export function countPlanned(stages: readonly StageRow[]): { done: number; planned: number } {
  const planned = stages.filter(stage => stage.mark !== 'skipped')
  return { done: planned.filter(stage => stage.mark === 'done').length, planned: planned.length }
}

export type DirectiveMarker ={ text: string; isFresh: boolean }

// The same step AI-DLC's own status line shows (its shownStep): the Unit Stage
// field, else the active-directive file when nothing has written the state since.
export function shownStep(state: string, marker: DirectiveMarker | null): { stage: string; unit: string } {
  const stage = extractField(state, 'Current Stage')
  const unitStage = extractField(state, 'Unit Stage')
  if (SLUG.test(unitStage)) return { stage: unitStage, unit: '' }
  if (marker === null || !marker.isFresh) return { stage, unit: '' }
  try {
    const parsed = JSON.parse(marker.text) as { stage?: unknown; unit?: unknown; delivery?: unknown }
    if (typeof parsed.stage !== 'string' || !SLUG.test(parsed.stage) || parsed.delivery === 'superseded') {
      return { stage, unit: '' }
    }
    const unit = typeof parsed.unit === 'string' && parsed.unit.length <= 64 && UNIT_NAME.test(parsed.unit) ? parsed.unit : ''
    return { stage: parsed.stage, unit }
  } catch {
    // A marker being rewritten reads as no marker, as AI-DLC's own line does.
    return { stage, unit: '' }
  }
}

export function unitNames(dag: string): string[] {
  const block = /## Machine-Readable Edge Block[\s\S]*?```ya?ml\r?\n([\s\S]*?)```/.exec(dag)?.[1] ?? ''
  return [...block.matchAll(/^\s*-\s+name:\s*([A-Za-z0-9][A-Za-z0-9._-]{0,63})\s*$/gm)].map(match => match[1]!)
}

export function approvedUnits(audits: readonly string[], units: readonly string[]): string[] {
  const rows: Array<{ at: string; isApproved: boolean; unit: string }> = []
  for (const audit of audits) {
    for (const entry of audit.split(/\n## /)) {
      if (!/^\*\*Checkpoint\*\*: construction-unit$/m.test(entry)) continue
      const event = /^\*\*Event\*\*:\s*(\S+)/m.exec(entry)?.[1] ?? ''
      if (event !== 'GATE_APPROVED' && event !== 'GATE_REJECTED') continue
      const unit = /^\*\*Unit\*\*:\s*(.+)$/m.exec(entry)?.[1]?.trim() ?? ''
      const at = /^\*\*Timestamp\*\*:\s*(.+)$/m.exec(entry)?.[1]?.trim() ?? ''
      rows.push({ at, isApproved: event === 'GATE_APPROVED', unit })
    }
  }
  const done = new Set<string>()
  for (const row of rows.sort((a, b) => a.at.localeCompare(b.at))) {
    if (!units.includes(row.unit)) continue
    if (row.isApproved) done.add(row.unit)
    else done.delete(row.unit)
  }
  return units.filter(unit => done.has(unit))
}

export function unitProgressOf(units: readonly string[], approved: readonly string[], active: string): UnitProgress | null {
  if (units.length === 0 || approved.length >= units.length) return null
  const rows = units.map(name => {
    const mark: UnitMark = approved.includes(name) ? 'done' : name === active ? 'running' : 'todo'
    return { name, mark }
  })
  return { current: approved.length + 1, total: units.length, units: rows }
}

export function isUnitMajorConstruction(state: string): boolean {
  return extractField(state, 'Construction Iteration') === 'unit-major' && extractField(state, 'Lifecycle Phase') === 'CONSTRUCTION'
}

export function buildProgress(
  intent: string,
  state: string,
  graph: readonly StageInfo[],
  shown: { stage: string },
  units: UnitProgress | null,
): Progress {
  const stages = readStageProgress(state, graph)
  const slugs = new Set(stages.map(stage => stage.slug))
  const fallback = extractField(state, 'Current Stage')
  const current = slugs.has(shown.stage) ? shown.stage : slugs.has(fallback) ? fallback : null
  const { done, planned } = countPlanned(stages)
  const status = extractField(state, 'Status')
  const isComplete = status === 'Completed' || status === 'Complete' || (planned > 0 && done === planned)
  return { intent, stages, current, isComplete, units: current === null ? null : units }
}

export const MARK_SYMBOL: Record<StageMark, string> = {
  done: '✓', running: '▶', awaiting: '?', revising: '↺', todo: '·', skipped: '–',
}

export const UNIT_SYMBOL: Record<UnitMark, string> = { done: '✓', running: '▶', todo: '·' }

export const STALE_NOTICE = 'Could not read the latest state'
export const EMPTY_LINES = ['No intent in progress', 'Start work with /aidlc to see progress here']
export const ERROR_LINES = ['Could not read progress', 'Run /aidlc --doctor to find the cause']
export const LOADING_LINE = 'Loading…'
export const MARK_LEGEND = ['✓done  ▶running  ?approval  ↺revising', '·todo  –skipped']

export type PaneLine =
  | { kind: 'notice'; text: string }
  | { kind: 'summary'; text: string }
  | { kind: 'blank' }
  | { kind: 'phase'; text: string }
  | { kind: 'phase-done'; text: string }
  | { kind: 'stage'; stage: StageRow; isCurrent: boolean; unitLabel: string }
  | { kind: 'unit'; unit: UnitRow }
  | { kind: 'skipped'; count: number }
  | { kind: 'rule' }
  | { kind: 'legend'; text: string }
  | { kind: 'legend-tones' }

export function summaryLines(progress: Progress): string[] {
  const { done, planned } = countPlanned(progress.stages)
  const current = progress.stages.find(stage => stage.slug === progress.current)
  const now = progress.isComplete
    ? 'Now all done'
    : current === undefined
      ? 'Now —'
      : `Now ${MARK_SYMBOL[current.mark]} ${current.number} ${current.name}${current.mark === 'awaiting' ? ' (approval)' : ''}`
  return [progress.intent, `Done ${done}/${planned} · ${progress.stages.length} stages total`, now]
}

type PhaseBlock = { phase: string; stages: StageRow[]; isDoneFolded: boolean; isSkipFolded: boolean }

function phaseBlocks(stages: readonly StageRow[]): PhaseBlock[] {
  const blocks: PhaseBlock[] = []
  for (const stage of stages) {
    const last = blocks.at(-1)
    if (last?.phase === stage.phase) last.stages.push(stage)
    else blocks.push({ phase: stage.phase, stages: [stage], isDoneFolded: false, isSkipFolded: false })
  }
  return blocks
}

function isPhaseDone(block: PhaseBlock): boolean {
  const planned = block.stages.filter(stage => stage.mark !== 'skipped')
  return planned.length > 0 && planned.every(stage => stage.mark === 'done')
}

function blockLines(block: PhaseBlock, progress: Progress): PaneLine[] {
  const label = block.phase.toUpperCase()
  const skipped = block.stages.filter(stage => stage.mark === 'skipped').length
  if (block.isDoneFolded) {
    const planned = block.stages.length - skipped
    return [{ kind: 'phase-done', text: `${label} ${planned}/${planned} done${skipped > 0 ? ` · ${skipped} skipped` : ''}` }]
  }
  const lines: PaneLine[] = [{ kind: 'phase', text: label }]
  for (const stage of block.stages) {
    if (block.isSkipFolded && stage.mark === 'skipped') continue
    const isCurrent = stage.slug === progress.current
    const units = isCurrent ? progress.units : null
    lines.push({ kind: 'stage', stage, isCurrent, unitLabel: units ? `Unit ${units.current}/${units.total}` : '' })
    for (const unit of units?.units ?? []) lines.push({ kind: 'unit', unit })
  }
  if (block.isSkipFolded && skipped > 0) lines.push({ kind: 'skipped', count: skipped })
  return lines
}

export function layoutPane(progress: Progress, bodyRows: number, isStale: boolean): PaneLine[] {
  const head: PaneLine[] = [
    ...(isStale ? [{ kind: 'notice', text: STALE_NOTICE } as const] : []),
    ...summaryLines(progress).map(text => ({ kind: 'summary', text }) as const),
    { kind: 'blank' },
  ]
  const tail: PaneLine[] = [
    { kind: 'rule' },
    ...MARK_LEGEND.map(text => ({ kind: 'legend', text }) as const),
    { kind: 'legend-tones' },
  ]
  const blocks = phaseBlocks(progress.stages)
  const height = () => head.length + tail.length + blocks.reduce((sum, block) => sum + blockLines(block, progress).length, 0)
  const folds = [
    ...blocks.filter(isPhaseDone).map(block => () => { block.isDoneFolded = true }),
    ...blocks.map(block => () => { block.isSkipFolded = true }),
  ]
  for (const fold of folds) {
    if (height() <= bodyRows) break
    fold()
  }
  return [...head, ...blocks.flatMap(block => blockLines(block, progress)), ...tail]
}
