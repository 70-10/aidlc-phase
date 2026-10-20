import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { INTENTS_JSON, REQUIREMENTS_RUNNING, ROUGH_MOCKUPS_RUNNING, STAGE_GRAPH, auditEntry, stateText, unitDag } from './fixtures'
import { EMPTY_LINES, ERROR_LINES, LOADING_LINE, MARK_LEGEND, MARK_SYMBOL, STALE_NOTICE, UNIT_SYMBOL } from './progress'

const PROJECT = '/work/app'
const PANE = 'aidlc-phase'
const SHIPPED = 'bun "$CLAUDE_PROJECT_DIR/.claude/tools/aidlc.ts" engine statusline'
const INTENTS = `${PROJECT}/aidlc/spaces/default/intents`
const RECORD = `${INTENTS}/261020-stage-pane-ui`
const STATE = `${RECORD}/aidlc-state.md`
const LINE = '[AIDLC] stage-pane-ui · IDEATION [▓▓▓▓░░░░░░] 4/9 > Rough Mockups'
const SHOWN = `${LINE} -- Designer`

type Result = { exitCode: number; stdout: string; stderr: string; isStdoutTruncated: boolean; isStderrTruncated: boolean }

function output(stdout: string): Result {
  return { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
}

function baseFiles(state = stateText()): Record<string, string> {
  return {
    [`${PROJECT}/.claude/tools/data/harness.json`]: JSON.stringify({ statusLine: { type: 'command', command: SHIPPED } }),
    [`${PROJECT}/.claude/tools/data/stage-graph.json`]: STAGE_GRAPH,
    [`${INTENTS}/intents.json`]: INTENTS_JSON,
    [STATE]: state,
  }
}

function stage(
  on: On,
  {
    files = baseFiles(),
    dirs = [`${PROJECT}/aidlc`],
    stdout = `${LINE} -- Designer | $0.10\n`,
    isPlacedOnOpen = true,
    exitCode = 0,
    run,
  }: {
    files?: Record<string, string>
    dirs?: string[]
    stdout?: string
    isPlacedOnOpen?: boolean
    exitCode?: number
    run?: () => Promise<Result>
  } = {},
) {
  const shown: Array<string | undefined> = []
  const opened: string[] = []
  const closed: string[] = []
  const commands: string[] = []
  const panes = new Map<string, boolean>()
  const world = { files, stdout, isPlacedOnOpen, panes }
  on('session.cwd', () => ({ value: PROJECT }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('fs.exists', ($, e) => ({ value: e.path in world.files || dirs.includes(e.path) }))
  on('fs.read', ($, e) => {
    const text = world.files[e.path]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.stat', ($, e) => {
    if (!(e.path in world.files)) throw new Error(`ENOENT ${e.path}`)
    return { value: { kind: 'file', size: 1, mtimeMs: e.path.endsWith('.json') ? 2 : 1, isLink: false } }
  })
  on('fs.list', ($, e) => ({
    value: Object.keys(world.files)
      .filter(path => path.startsWith(`${e.path}/`))
      .map(path => ({ name: path.slice(e.path!.length + 1), kind: 'file', size: 1, mtimeMs: 1, isLink: false })),
  }))
  on('process.run', async () => ({ value: run ? await run() : { ...output(world.stdout), exitCode } }))
  on('ui.status', ($, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('command.register', ($, e) => {
    commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', ($, e) => {
    opened.push(e.id)
    panes.set(e.id, world.isPlacedOnOpen)
    return { value: world.isPlacedOnOpen ? { isPlaced: true } : { isPlaced: false, reason: 'below 144 columns (120 now)' } }
  })
  on('ui.panes', () => ({
    value: [...panes].map(([id, isPlaced]) => ({ id, title: 'AI-DLC', isShown: isPlaced, isFocused: false, isPlaced })),
  }))
  on('ui.close', ($, e) => {
    closed.push(`${e.id}:${e.origin.kind}`)
    panes.delete(e.id)
    return { value: undefined }
  })
  return { shown, opened, closed, commands, world }
}

const settle = () => new Promise(r => setTimeout(r, 0))

function deferred() {
  let resolve!: (r: Result) => void
  const promise = new Promise<Result>(r => { resolve = r })
  return { promise, resolve }
}

const START = { cwd: PROJECT, surface: 'terminal', isInteractive: true } as const
const TURN = { answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const

function paneProps(bodyRows = 60) {
  return {
    title: 'AI-DLC',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows },
    view: {},
  } as const
}

function mount($: Engine, isFullscreen: boolean, surface: 'terminal' | 'desktop' = 'terminal', bodyRows = 60) {
  return $.ui.mount({
    plugin: 'aidlc-phase',
    surface,
    component: 'Pane',
    requestId: PANE,
    props: paneProps(bodyRows),
    viewport: { columns: 160, rows: 50, isFullscreen },
  })
}

function runCommand($: Engine, isFullscreen: boolean) {
  return $.command.run({
    command: 'aidlc-phase',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen, columns: 100 },
  })
}

const STAGE_ROW = /^[✓▶?↺·–] \d\.\d /
const JAPANESE = /[\u{3000}-\u{303F}\u{3040}-\u{309F}\u{30A0}-\u{30FF}\u{4E00}-\u{9FFF}\u{FF00}-\u{FFEF}]/u

describe('aidlc-phase pane', () => {
  describe('Positive Cases', () => {
    test('by default opens the pane and shows no status line once it is drawn', async ($, on) => {
      const { shown, opened, commands } = stage(on)
      await $.session.start(START)
      await settle()
      const ui = await mount($, true)
      expect(opened).toEqual([PANE])
      expect(commands).toEqual(['aidlc-phase'])
      expect(shown.at(-1)).toBeUndefined()
      expect(shown).not.toContain(SHOWN)
      await ui.unmount()
    })

    test('draws all 33 stages, colored by whether they run, the current row inverse, and the legend', async ($, on) => {
      stage(on)
      await $.session.start(START)
      await settle()
      for (const surface of ['terminal', 'desktop'] as const) {
        const ui = await mount($, true, surface)
        const rows = (await ui.findAll({ type: 'Text', text: STAGE_ROW })).filter(row => row.props.inverse !== undefined)
        expect(rows).toHaveLength(33)
        const current = rows.filter(row => row.props.inverse === true)
        expect(current.map(row => row.text)).toEqual(['▶ 1.6 Rough Mockups'])
        const colors = (await ui.findAll({ type: 'Text', text: /^\d\.\d / })).map(text => text.props.color)
        expect(colors.filter(color => color === 'suggestion')).toHaveLength(7)
        expect(colors.filter(color => color === 'warning')).toHaveLength(2)
        expect(colors.filter(color => color === 'inactive')).toHaveLength(24)
        expect(await ui.find({ type: 'Text', text: 'stage-pane-ui' })).toBeDefined()
        expect((await ui.find({ type: 'Text', text: /^Done / }))?.text).toBe('Done 4/9 · 33 stages total')
        expect(await ui.find({ type: 'Text', text: '✓done  ▶running  ?approval  ↺revising' })).toBeDefined()
        expect((await ui.find({ type: 'Text', text: /^Color:/ }))?.text).toBe('Color: ■ always ■ conditional ■ skipped')
        await ui.unmount()
      }
    })

    test('a command opens the pane even on the main screen, and the status line goes', async ($, on) => {
      const { shown, opened } = stage(on)
      await $.session.start(START)
      await settle()
      const auto = await mount($, false)
      await auto.unmount()
      expect(shown.at(-1)).toBe(SHOWN)
      await runCommand($, false)
      const ui = await mount($, false)
      expect(opened).toEqual([PANE, PANE])
      expect(shown.at(-1)).toBeUndefined()
      expect(await ui.findAll({ type: 'Text', text: STAGE_ROW })).not.toHaveLength(0)
      await ui.unmount()
    })

    test('a pane a command opened brings the status line back once it is no longer placed', async ($, on) => {
      const { shown, world } = stage(on)
      await $.session.start(START)
      await settle()
      await runCommand($, true)
      const ui = await mount($, true)
      expect(shown.at(-1)).toBeUndefined()
      await ui.unmount()
      world.panes.set(PANE, false)
      await $.turn.complete(TURN)
      await settle()
      expect(shown.at(-1)).toBe(SHOWN)
    })

    test('takes the new state at the end of each turn', async ($, on) => {
      const { world } = stage(on)
      await $.session.start(START)
      await settle()
      const ui = await mount($, true)
      expect((await ui.find({ type: 'Text', text: /^Now / }))?.text).toBe('Now ▶ 1.6 Rough Mockups')
      world.files[STATE] = stateText({ boxes: REQUIREMENTS_RUNNING })
      await $.turn.complete(TURN)
      await settle()
      expect((await ui.find({ type: 'Text', text: /^Now / }))?.text).toBe('Now ▶ 2.3 Requirements Analysis')
      expect((await ui.find({ type: 'Text', text: /^Done / }))?.text).toBe('Done 6/9 · 33 stages total')
      await ui.unmount()
    })

    test('keeps the newest state when an older read finishes last', async ($, on) => {
      const files = {
        ...baseFiles(),
        [`${INTENTS}/intents.json`]: JSON.stringify([
          { slug: 'stage-pane-ui', dirName: '261020-stage-pane-ui', status: 'in-flight' },
          { slug: 'other', dirName: '261019-other', status: 'in-flight' },
        ]),
        [`${INTENTS}/261019-other/aidlc-state.md`]: stateText({ boxes: REQUIREMENTS_RUNNING }),
      }
      const queue: Array<ReturnType<typeof deferred>> = []
      stage(on, { files, run: () => queue.shift()?.promise ?? Promise.resolve(output(`${LINE}\n`)) })
      await $.session.start(START)
      await settle()
      const ui = await mount($, true)
      const older = deferred()
      const newer = deferred()
      queue.push(older, newer)
      await $.turn.complete(TURN)
      await $.turn.complete({ ...TURN, turnId: 't2' })
      newer.resolve(output('[AIDLC] other · INCEPTION [▓▓▓░░░░░░░] 1/2 > Requirements Analysis\n'))
      await settle()
      older.resolve(output(`${LINE}\n`))
      await settle()
      expect(await ui.find({ type: 'Text', text: 'other' })).toBeDefined()
      expect((await ui.find({ type: 'Text', text: /^Now / }))?.text).toBe('Now ▶ 2.3 Requirements Analysis')
      await ui.unmount()
    })

    test('working one Unit at a time, lists the Units indented under the stage under way, uncolored', async ($, on) => {
      const files = {
        ...baseFiles(stateText({
          boxes: { ...REQUIREMENTS_RUNNING, 'requirements-analysis': 'x', 'code-generation': '-' },
          fields: { 'Lifecycle Phase': 'CONSTRUCTION', 'Construction Iteration': 'unit-major' },
        })),
        [`${RECORD}/inception/units-generation/unit-of-work-dependency.md`]: unitDag(['u1', 'u2', 'u3']),
        [`${RECORD}/audit/host-1.md`]: '# Audit\n\n' + auditEntry('GATE_APPROVED', 'u1', '2026-10-20T01:00:00Z'),
        [`${RECORD}/.aidlc-engine/active-directive.json`]: JSON.stringify({ stage: 'code-generation', unit: 'u2' }),
      }
      stage(on, { files, stdout: '[AIDLC] stage-pane-ui · CONSTRUCTION Unit 2 of 3 > Code Generation for u2\n' })
      await $.session.start(START)
      await settle()
      const ui = await mount($, true)
      expect((await ui.find({ type: 'Text', text: /^▶ 3\.5 / }))?.text).toBe('▶ 3.5 Code Generation  Unit 2/3')
      const units = await ui.findAll({ type: 'Text', text: /^ {4}/ })
      expect(units.map(unit => unit.text)).toEqual(['    ✓ u1', '    ▶ u2', '    · u3'])
      expect(units.every(unit => unit.props.color === undefined)).toBe(true)
      await ui.unmount()
    })
  })

  describe('Edge Cases', () => {
    test('on the main screen, closes the pane it opened unasked and shows the status line', async ($, on) => {
      const { shown, closed } = stage(on)
      await $.session.start(START)
      await settle()
      const ui = await mount($, false)
      await settle()
      expect(closed).toEqual([`${PANE}:plugin`])
      expect(shown.at(-1)).toBe(SHOWN)
      await ui.unmount()
    })

    test('shows the status line while the pane waits for width, and clears it once drawn', async ($, on) => {
      const { shown, world } = stage(on, { isPlacedOnOpen: false })
      await $.session.start(START)
      await settle()
      expect(shown.at(-1)).toBe(SHOWN)
      world.panes.set(PANE, true)
      const ui = await mount($, true)
      expect(shown.at(-1)).toBeUndefined()
      await ui.unmount()
    })

    test('closing its own pane on the main screen does not count as the person closing it', async ($, on) => {
      const { shown, opened } = stage(on)
      await $.session.start(START)
      await settle()
      const ui = await mount($, false)
      await ui.unmount()
      await $.turn.complete(TURN)
      await settle()
      expect(shown.at(-1)).toBe(SHOWN)
      await $.session.start(START)
      await settle()
      expect(opened).toEqual([PANE, PANE])
    })

    test('keeps the last list and says the newest state could not be read', async ($, on) => {
      const { world } = stage(on)
      await $.session.start(START)
      await settle()
      const ui = await mount($, true)
      world.files[STATE] = stateText({ boxes: { ...ROUGH_MOCKUPS_RUNNING, 'rough-mockups': '!' } })
      await $.turn.complete(TURN)
      await settle()
      expect(await ui.find({ type: 'Text', text: 'Could not read the latest state' })).toBeDefined()
      expect((await ui.findAll({ type: 'Text', text: STAGE_ROW })).filter(row => row.props.inverse !== undefined)).toHaveLength(33)
      await ui.unmount()
    })

    test('with no Intent in progress, says so and how to start', async ($, on) => {
      stage(on, { stdout: '[AIDLC] ready | $0.00\n' })
      await $.session.start(START)
      await settle()
      const ui = await mount($, true)
      const lines = [
        await ui.find({ type: 'Text', text: 'No intent in progress' }),
        await ui.find({ type: 'Text', text: /Start work with \/aidlc/ }),
      ]
      expect(lines.every(line => line !== undefined)).toBe(true)
      expect(lines.map(line => line?.props.wrap)).toEqual([undefined, undefined])
      await ui.unmount()
    })

    test('writes no Japanese, in the folded pane or in any message it can show', async ($, on) => {
      stage(on, { files: baseFiles(stateText({ boxes: REQUIREMENTS_RUNNING })) })
      await $.session.start(START)
      await settle()
      const ui = await mount($, true, 'terminal', 20)
      const texts = (await ui.findAll({ type: 'Text' })).map(text => text.text)
      expect(texts.some(text => /^✓ [A-Z]+ \d+\/\d+ done/.test(text))).toBe(true)
      expect(texts.some(text => /^– \d+ skipped$/.test(text))).toBe(true)
      const messages = [
        ...Object.values(MARK_SYMBOL), ...Object.values(UNIT_SYMBOL),
        STALE_NOTICE, ...EMPTY_LINES, ...ERROR_LINES, LOADING_LINE, ...MARK_LEGEND,
      ]
      expect([...texts, ...messages].filter(text => JAPANESE.test(text))).toEqual([])
      await ui.unmount()
    })

    test('in the status line setting, opens no pane and registers no command', { options: { display: 'statusline' } }, async ($, on) => {
      const { shown, opened, commands } = stage(on)
      await $.session.start(START)
      expect(opened).toEqual([])
      expect(commands).toEqual([])
      expect(shown.at(-1)).toBe(SHOWN)
    })
  })

  describe('Negative Cases', () => {
    test('with nothing read before, shows that the progress could not be read and how to check', async ($, on) => {
      const files = baseFiles()
      delete files[`${INTENTS}/intents.json`]
      stage(on, { files })
      await $.session.start(START)
      await settle()
      const ui = await mount($, true)
      expect(await ui.find({ type: 'Text', text: 'Could not read progress' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /\/aidlc --doctor/ })).toBeDefined()
      await ui.unmount()
    })

    test('outside an AI-DLC project, opens no pane and shows nothing', async ($, on) => {
      const { shown, opened } = stage(on, { files: {}, dirs: [] })
      await $.session.start(START)
      await settle()
      expect(opened).toEqual([])
      expect(shown.at(-1)).toBeUndefined()
    })

    test('a failing status line command leaves the conversation alone and shows the error in the pane', async ($, on) => {
      stage(on, { exitCode: 1 })
      await $.session.start(START)
      await $.turn.complete(TURN)
      await settle()
      const ui = await mount($, true)
      expect(await ui.find({ type: 'Text', text: 'Could not read progress' })).toBeDefined()
      await ui.unmount()
    })
  })
})
