import type { Progress, StageMark, StageRow, StageTone, UnitMark, UnitRow } from '../types'

export class ProgressReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProgressReadError'
  }
}

export type StageInfo = {
  slug: string
  number: string
  name: string
  phase: string
  execution: 'ALWAYS' | 'CONDITIONAL'
  isPerUnit: boolean
}

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
    const { slug, number, name, phase, execution, for_each } = row
    if (
      typeof slug !== 'string' || typeof number !== 'string' || typeof name !== 'string' ||
      typeof phase !== 'string' || (execution !== 'ALWAYS' && execution !== 'CONDITIONAL')
    ) {
      throw new ProgressReadError(`stage-graph.json has a stage it cannot read: ${String(slug)}`)
    }
    stages.push({ slug, number, name, phase, execution, isPerUnit: for_each === 'unit-of-work' })
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
    return {
      slug: stage.slug, number: stage.number, name: stage.name, phase: stage.phase, mark, tone,
      isPerUnit: stage.isPerUnit, unitsDone: null,
    }
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

// The first yaml block holding `units:`, as AI-DLC reads it: the heading above it is written in the Intent's language.
export function unitNames(dag: string): string[] {
  const blocks = [...dag.matchAll(/^```ya?ml[^\S\n]*\r?\n([\s\S]*?)^```/gm)].map(match => match[1]!)
  const block = blocks.find(text => /^\s*units\s*:/m.test(text)) ?? ''
  return [...block.matchAll(/^\s*-\s+name:\s*([A-Za-z0-9][A-Za-z0-9._-]{0,63})\s*$/gm)].map(match => match[1]!)
}

export type UnitLedger = { completed: ReadonlyMap<string, ReadonlySet<string>>; open: string | null }

const UNIT_EVENTS = new Set(['UNIT_STARTED', 'UNIT_PAUSED', 'UNIT_RESUMED', 'UNIT_COMPLETED', 'UNIT_SKIPPED'])
const UNIT_FINISHED = new Set(['UNIT_COMPLETED', 'UNIT_SKIPPED'])

// Not AI-DLC's run floors: the latest record of a Unit at a stage wins, which is enough until a jump back.
export function readUnitLedger(audits: readonly string[], units: readonly string[]): UnitLedger {
  const rows: Array<{ at: string; event: string; stage: string; unit: string }> = []
  for (const audit of audits) {
    for (const entry of audit.split(/\n## /)) {
      const event = /^\*\*Event\*\*:\s*(\S+)/m.exec(entry)?.[1] ?? ''
      if (!UNIT_EVENTS.has(event)) continue
      const stage = /^\*\*Stage\*\*:\s*(\S+)/m.exec(entry)?.[1] ?? ''
      const unit = /^\*\*Unit\*\*:\s*(.+)$/m.exec(entry)?.[1]?.trim() ?? ''
      const at = /^\*\*Timestamp\*\*:\s*(.+)$/m.exec(entry)?.[1]?.trim() ?? ''
      if (units.includes(unit)) rows.push({ at, event, stage, unit })
    }
  }
  const latest = new Map<string, (typeof rows)[number]>()
  for (const row of rows.sort((a, b) => a.at.localeCompare(b.at))) latest.set(`${row.stage}\n${row.unit}`, row)
  const completed = new Map<string, Set<string>>()
  let open: (typeof rows)[number] | null = null
  for (const row of latest.values()) {
    if (UNIT_FINISHED.has(row.event)) {
      completed.set(row.stage, (completed.get(row.stage) ?? new Set()).add(row.unit))
    } else if (row.event !== 'UNIT_PAUSED' && (open === null || row.at >= open.at)) {
      open = row
    }
  }
  return { completed, open: open?.unit ?? null }
}

export type UnitFacts = { names: readonly string[]; ledger: UnitLedger }

export function buildProgress(
  intent: string,
  state: string,
  graph: readonly StageInfo[],
  shown: { stage: string; unit: string },
  facts: UnitFacts,
): Progress {
  const rows = readStageProgress(state, graph)
  const slugs = new Set(rows.map(stage => stage.slug))
  const fallback = extractField(state, 'Current Stage')
  const current = slugs.has(shown.stage) ? shown.stage : slugs.has(fallback) ? fallback : null
  const status = extractField(state, 'Status')
  const isAllDone = (stages: readonly StageRow[]) => {
    const { done, planned } = countPlanned(stages)
    return status === 'Completed' || status === 'Complete' || (planned > 0 && done === planned)
  }
  const { names, ledger } = facts
  if (names.length < 2) return { intent, stages: rows, current, isComplete: isAllDone(rows), units: null }

  const at = rows.findIndex(stage => stage.slug === current)
  const lastPerUnit = rows.findLastIndex(stage => stage.isPerUnit)
  const isPast = isAllDone(rows) || at > lastPerUnit
  const finished = (slug: string) => names.filter(name => ledger.completed.get(slug)?.has(name)).length
  const stages = rows.map(stage => {
    if (!stage.isPerUnit || stage.mark === 'skipped') return stage
    const counted = finished(stage.slug)
    // AI-DLC's mark wins over a count of 0: a stage done before Units were recorded has no Unit record.
    const unitsDone = isPast || (stage.mark === 'done' && counted === 0) ? names.length : counted
    const isPartly = stage.slug !== current && unitsDone > 0 && unitsDone < names.length
    return { ...stage, unitsDone, mark: isPartly ? 'partly' : stage.mark } satisfies StageRow
  })
  const planned = stages.filter(stage => stage.isPerUnit && stage.mark !== 'skipped')
  const active = shown.unit !== '' && names.includes(shown.unit) ? shown.unit : ledger.open
  const units = names.map(name => {
    const hasFinished = (stage: StageRow) => isPast || stage.unitsDone === names.length || ledger.completed.get(stage.slug)?.has(name) === true
    const mark: UnitMark = planned.every(hasFinished)
      ? 'done'
      : name === active ? 'running' : planned.some(hasFinished) ? 'partly' : 'todo'
    return { name, mark }
  })
  return { intent, stages, current, isComplete: isAllDone(stages), units }
}

export const MARK_SYMBOL: Record<StageMark, string> = {
  done: '✓', running: '▶', awaiting: '?', revising: '↺', partly: '◐', todo: '·', skipped: '–',
}

export const UNIT_SYMBOL: Record<UnitMark, string> = { done: '✓', running: '▶', partly: '◐', todo: '·' }

export const STALE_NOTICE = 'Could not read the latest state'
export const EMPTY_LINES = ['No intent in progress', 'Start work with /aidlc to see progress here']
export const ERROR_LINES = ['Could not read progress', 'Run /aidlc --doctor to find the cause']
export const LOADING_LINE = 'Loading…'
export const MARK_LEGEND = ['✓done  ▶running  ?approval  ↺revising', '·todo  –skipped']
export const UNITS_LEGEND = `${MARK_LEGEND[1]}  ◐partly  n/N Units done`
export const ONCE_LINE = '  then once for all Units'

export type HeaderPart = { text: string; isMark: boolean }

export function unitHeader(units: readonly UnitRow[], columns: number): HeaderPart[] {
  const full: HeaderPart[] = [{ text: '┌ For each Unit ', isMark: true }]
  units.forEach((unit, index) => {
    full.push({ text: UNIT_SYMBOL[unit.mark], isMark: true }, { text: unit.name + (index < units.length - 1 ? '  ' : ''), isMark: false })
  })
  const width = (parts: readonly HeaderPart[]) => parts.reduce((sum, part) => sum + [...part.text].length, 0)
  if (width(full) <= columns) return full
  const count = (mark: UnitMark) => units.filter(unit => unit.mark === mark).length
  const running = units.find(unit => unit.mark === 'running')?.name ?? ''
  const tail: HeaderPart[] = [
    { text: `┌ For each of ${units.length} Units  `, isMark: true },
    { text: UNIT_SYMBOL.done, isMark: true }, { text: `${count('done')} `, isMark: false },
    ...(running === '' ? [] : [{ text: UNIT_SYMBOL.running, isMark: true }, { text: `${running} `, isMark: false }]),
    ...(count('partly') === 0 ? [] : [{ text: UNIT_SYMBOL.partly, isMark: true }, { text: `${count('partly')} `, isMark: false }]),
    { text: UNIT_SYMBOL.todo, isMark: true }, { text: `${count('todo')}`, isMark: false },
  ]
  const over = width(tail) - columns
  if (over <= 0 || running === '') return tail
  const named = tail.findIndex(part => part.text === `${running} `)
  const kept = Math.max(1, running.length - over - 1)
  return [...tail.slice(0, named), { text: `${running.slice(0, kept)}…`, isMark: false }]
}

export type PaneLine =
  | { kind: 'notice'; text: string }
  | { kind: 'summary'; text: string }
  | { kind: 'blank' }
  | { kind: 'phase'; text: string }
  | { kind: 'phase-done'; text: string }
  | { kind: 'units'; units: UnitRow[] }
  | { kind: 'stage'; stage: StageRow; isCurrent: boolean; bracket: 'mid' | 'end' | null; unitCount: string }
  | { kind: 'once' }
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
  const units = progress.units
  const running = current?.isPerUnit ? units?.find(unit => unit.mark === 'running')?.name : undefined
  const unitsDone = units ? ` · Units ${units.filter(unit => unit.mark === 'done').length}/${units.length}` : ''
  return [
    progress.intent,
    `Done ${done}/${planned} stages of ${progress.stages.length}${unitsDone}`,
    `${now}${progress.isComplete || running === undefined ? '' : ` · ${running}`}`,
  ]
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
  const shown = block.stages.filter(stage => !(block.isSkipFolded && stage.mark === 'skipped'))
  const units = progress.units
  const perUnit = units === null ? [] : shown.filter(stage => stage.isPerUnit)
  for (const [index, stage] of shown.entries()) {
    const isBracketed = perUnit.includes(stage)
    if (stage === perUnit[0]) lines.push({ kind: 'units', units: units! })
    if (!isBracketed && perUnit.includes(shown[index - 1]!)) lines.push({ kind: 'once' })
    const bracket = !isBracketed ? null : stage === perUnit.at(-1) ? 'end' : 'mid'
    const unitCount = isBracketed && stage.unitsDone !== null ? `${stage.unitsDone}/${units!.length}` : ''
    lines.push({ kind: 'stage', stage, isCurrent: stage.slug === progress.current, bracket, unitCount })
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
    { kind: 'legend', text: MARK_LEGEND[0]! },
    { kind: 'legend', text: progress.units === null ? MARK_LEGEND[1]! : UNITS_LEGEND },
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
