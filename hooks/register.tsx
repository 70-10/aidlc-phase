import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PaneView, Progress, UnitProgress } from '../types'
import { drawPane } from './pane'
import {
  approvedUnits,
  buildProgress,
  intentFromLine,
  isUnitMajorConstruction,
  ProgressReadError,
  readStageGraph,
  recordDirFor,
  shownStep,
  spaceFromCursor,
  unitNames,
  unitProgressOf,
} from './progress'
import type { DirectiveMarker } from './progress'

// AI-DLC's own renderer is run instead of reading aidlc-state.md here: which
// intent a session shows (its binding, the active-intent cursor, archived
// records, Unit progress) is the engine's rule and changes with each release.
const COMMAND_SOURCES = [
  '.claude/tools/data/harness.json',
  '.claude/settings.local.json',
  '.claude/settings.json',
]
const LEGACY_HOOK = '.claude/hooks/aidlc-statusline.ts'
const STAGE_GRAPH = '.claude/tools/data/stage-graph.json'

const PANE = 'aidlc-phase'
const PANE_TITLE = 'AI-DLC'

const view = atom({ plugin: 'aidlc-phase', key: 'view' } as const, { kind: 'loading' } as PaneView)
const isAutoOpened = atom({ plugin: 'aidlc-phase', key: 'isAutoOpened' } as const, false)
const isClosedByPerson = atom({ plugin: 'aidlc-phase', key: 'isClosedByPerson' } as const, false)

function isAidlcRenderer(command: string): boolean {
  return command.includes('engine statusline') || command.includes('aidlc-statusline.ts')
}

function parent(dir: string): string | null {
  const cut = dir.replace(/\/+$/, '').lastIndexOf('/')
  return cut <= 0 ? null : dir.slice(0, cut)
}

async function projectDir($: EngineInterface, cwd: string): Promise<string | null> {
  for (let dir: string | null = cwd; dir !== null; dir = parent(dir)) {
    if (await $.fs.exists(`${dir}/aidlc`)) return dir
  }
  return null
}

async function statusLineCommand($: EngineInterface, project: string): Promise<string | null> {
  for (const source of COMMAND_SOURCES) {
    try {
      const command: unknown = JSON.parse(String(await $.fs.read(`${project}/${source}`)))?.statusLine?.command
      if (typeof command === 'string' && isAidlcRenderer(command)) return command
    } catch {
      // A missing or unreadable file only means the next place may have it.
    }
  }
  return (await $.fs.exists(`${project}/${LEGACY_HOOK}`))
    ? `bun "$CLAUDE_PROJECT_DIR/${LEGACY_HOOK}"`
    : null
}

type StatusLine =
  | { kind: 'outside' }
  | { kind: 'ready' }
  | { kind: 'failed'; reason: string }
  | { kind: 'shown'; project: string; text: string }

async function readStatusLine($: EngineInterface): Promise<StatusLine> {
  const project = await projectDir($, await $.session.cwd())
  if (project === null) return { kind: 'outside' }
  const command = await statusLineCommand($, project)
  if (command === null) return { kind: 'outside' }
  // No model or context figures go in, so the right side carries cost at most;
  // the person's own status line already shows those.
  const { exitCode, stdout } = await $.process.run(['sh', '-c', command], {
    cwd: project,
    env: { CLAUDE_PROJECT_DIR: project },
    stdin: JSON.stringify({ session_id: await $.session.id(), workspace: { project_dir: project } }),
    timeoutMs: 10_000,
  })
  if (exitCode !== 0) return { kind: 'failed', reason: `${command} exited ${exitCode}` }
  const left = (stdout.split('\n')[0] ?? '').replace(/\x1b\[[0-9;]*m/g, '').split(' | ')[0]?.trim() ?? ''
  return left === '' || left.startsWith('[AIDLC] ready') ? { kind: 'ready' } : { kind: 'shown', project, text: left }
}

async function phaseLine($: EngineInterface): Promise<string | undefined> {
  const line = await readStatusLine($)
  return line.kind === 'shown' ? line.text : undefined
}

let latest = 0

async function refresh($: EngineInterface): Promise<void> {
  const mine = ++latest
  let text: string | undefined
  try {
    text = await phaseLine($)
  } catch {
    text = undefined
  }
  // Runs are not awaited by turn.complete, so an older one can finish last.
  if (mine === latest) $.ui.status(text)
}

async function readOptional($: EngineInterface, path: string): Promise<string | null> {
  return (await $.fs.exists(path)) ? String(await $.fs.read(path)) : null
}

async function readMarker($: EngineInterface, record: string, stateFile: string): Promise<DirectiveMarker | null> {
  const path = `${record}/.aidlc-engine/active-directive.json`
  if (!(await $.fs.exists(path))) return null
  const [marker, state] = await Promise.all([$.fs.stat(path), $.fs.stat(stateFile)])
  return { text: String(await $.fs.read(path)), isFresh: marker.mtimeMs >= state.mtimeMs }
}

async function readUnits($: EngineInterface, record: string, active: string): Promise<UnitProgress | null> {
  try {
    const dag = await readOptional($, `${record}/inception/units-generation/unit-of-work-dependency.md`)
    if (dag === null) return null
    const units = unitNames(dag)
    if (units.length === 0) return null
    const audit = `${record}/audit`
    const files = (await $.fs.list(audit)).filter(entry => entry.name.endsWith('.md'))
    const audits = await Promise.all(files.map(async entry => String(await $.fs.read(`${audit}/${entry.name}`))))
    return unitProgressOf(units, approvedUnits(audits, units), active)
  } catch (error) {
    // Unit progress is extra: the stages still show without it, as on AI-DLC's own line.
    $.ui.log(`aidlc-phase: Unit progress not read: ${messageOf(error)}`, { to: 'debug' })
    return null
  }
}

async function loadProgress($: EngineInterface, project: string, text: string): Promise<Progress> {
  const intent = intentFromLine(text)
  if (intent === null) throw new ProgressReadError(`the status line names no intent: ${text}`)
  const space = intent.space ?? spaceFromCursor(await readOptional($, `${project}/aidlc/active-space`))
  const intents = `${project}/aidlc/spaces/${space}/intents`
  const record = `${intents}/${recordDirFor(String(await $.fs.read(`${intents}/intents.json`)), intent.slug)}`
  const stateFile = `${record}/aidlc-state.md`
  const state = String(await $.fs.read(stateFile))
  const graph = readStageGraph(String(await $.fs.read(`${project}/${STAGE_GRAPH}`)))
  const shown = shownStep(state, await readMarker($, record, stateFile))
  const units = isUnitMajorConstruction(state) ? await readUnits($, record, shown.unit) : null
  return buildProgress(intent.slug, state, graph, shown, units)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

let latestText: string | undefined

async function showStatusWithoutPane($: EngineInterface): Promise<void> {
  const [isClosed, panes] = await Promise.all([read($, isClosedByPerson), $.ui.panes()])
  const isPlaced = panes.some(pane => pane.id === PANE && pane.isPlaced)
  $.ui.status(isPlaced || isClosed ? undefined : latestText)
}

async function refreshPane($: EngineInterface): Promise<void> {
  const mine = ++latest
  let found: PaneView
  let text: string | undefined
  try {
    const line = await readStatusLine($)
    text = line.kind === 'shown' ? line.text : undefined
    found = line.kind === 'shown'
      ? { kind: 'progress', progress: await loadProgress($, line.project, line.text), isStale: false }
      : line.kind === 'failed'
        ? { kind: 'error', reason: line.reason }
        : { kind: 'none' }
  } catch (error) {
    found = { kind: 'error', reason: messageOf(error) }
  }
  // Runs are not awaited by turn.complete, so an older one can finish last.
  if (mine !== latest) return
  if (found.kind === 'error') $.ui.log(`aidlc-phase: progress not read: ${found.reason}`, { to: 'debug' })
  latestText = text
  try {
    await update($, view, previous =>
      found.kind === 'error' && previous.kind === 'progress' ? { ...previous, isStale: true } : found,
    )
    await showStatusWithoutPane($)
  } catch (error) {
    $.ui.log(`aidlc-phase: pane not updated: ${messageOf(error)}`, { to: 'debug' })
  }
}

async function startPane($: EngineInterface): Promise<void> {
  await $.command.register({ name: 'aidlc-phase', description: 'Show AI-DLC progress in a pane beside the chat' })
  const isInProject = (await projectDir($, await $.session.cwd())) !== null
  if (isInProject && !(await read($, isClosedByPerson))) {
    await update($, isAutoOpened, () => true)
    // Awaiting would hold the session's start on the pane being drawn.
    void $.ui.open({ id: PANE, title: PANE_TITLE }).catch(error => {
      $.ui.log(`aidlc-phase: pane not opened: ${messageOf(error)}`, { to: 'debug' })
    })
  }
  await refreshPane($)
}

export const register: Register = (on, options) => {
  const isPane = options.display !== 'statusline'

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if (isPane) await startPane($)
    else await refresh($)
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    // Awaiting would hold the end of every turn on starting the renderer.
    void (isPane ? refreshPane($) : refresh($))
    return done
  })

  on('command.run', { command: 'aidlc-phase' }, async $ => {
    await update($, isClosedByPerson, () => false)
    await update($, isAutoOpened, () => false)
    await $.ui.open({ id: PANE, title: PANE_TITLE })
    void refreshPane($)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    // Whether the layout docks a pane is known only once one is drawn, so an
    // unasked pane on the main screen is opened first and closed here.
    if (e.viewport?.isFullscreen === false && (await read($, isAutoOpened))) {
      void $.ui.close({ id: PANE }).catch(error => {
        $.ui.log(`aidlc-phase: pane not closed: ${messageOf(error)}`, { to: 'debug' })
      })
      $.ui.status(latestText)
      const { Box } = elements
      return <Box />
    }
    $.ui.status(undefined)
    const size = { bodyRows: e.props.scroll.bodyRows, bodyColumns: e.props.bodyColumns }
    return drawPane(elements, await read($, view), size)
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    if (e.origin.kind === 'person') {
      await update($, isClosedByPerson, () => true)
      $.ui.status(undefined)
    }
    return closed
  })
}
