import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PROJECT = '/work/app'
const SHIPPED = 'bun "$CLAUDE_PROJECT_DIR/.claude/tools/aidlc.ts" engine statusline'
const LEGACY = 'bun "$CLAUDE_PROJECT_DIR/.claude/hooks/aidlc-statusline.ts"'
const HARNESS = `${PROJECT}/.claude/tools/data/harness.json`

type Run = { argv: readonly string[]; cwd?: string; env?: Record<string, string>; stdin?: string }
type Result = { exitCode: number; stdout: string; stderr: string; isStdoutTruncated: boolean; isStderrTruncated: boolean }

function statusLine(command: string): string {
  return JSON.stringify({ statusLine: { type: 'command', command } })
}

function stage(
  on: On,
  {
    stdout = '',
    files = { [HARNESS]: statusLine(SHIPPED) },
    dirs = [`${PROJECT}/aidlc`],
    cwd = PROJECT,
    run,
  }: {
    stdout?: string
    files?: Record<string, string>
    dirs?: string[]
    cwd?: string
    run?: () => Promise<Result>
  } = {},
) {
  const runs: Run[] = []
  const shown: Array<string | undefined> = []
  on('session.cwd', () => ({ value: cwd }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('fs.exists', ($, e) => ({ value: e.path in files || dirs.includes(e.path) }))
  on('fs.read', ($, e) => {
    const text = files[e.path]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('process.run', async ($, e) => {
    runs.push({ argv: e.argv, ...e.init })
    return { value: run ? await run() : output(stdout) }
  })
  on('ui.status', ($, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  return { runs, shown }
}

function output(stdout: string): Result {
  return { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
}

function deferred() {
  let resolve!: (r: Result) => void
  const promise = new Promise<Result>(r => { resolve = r })
  return { promise, resolve }
}

const settle = () => new Promise(r => setTimeout(r, 0))

const START = { cwd: PROJECT, surface: 'terminal', isInteractive: true } as const
const TURN = { answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const

describe('aidlc-phase', () => {
  describe('Positive Cases', () => {
    test('shows the left side of AI-DLC\'s own status line, without cost', async ($, on) => {
      const { runs, shown } = stage(on, {
        stdout: '[AIDLC] my-feature · INCEPTION [▓▓▓░░░░░░░] 3/9 > User Stories -- Product | ↑1.2k ↓300 $0.10\n',
      })
      await $.session.start(START)
      expect(shown.at(-1)).toBe('[AIDLC] my-feature · INCEPTION [▓▓▓░░░░░░░] 3/9 > User Stories -- Product')
      expect(runs[0]?.argv).toEqual(['sh', '-c', SHIPPED])
      expect(runs[0]?.cwd).toBe(PROJECT)
      expect(runs[0]?.env).toEqual({ CLAUDE_PROJECT_DIR: PROJECT })
      expect(JSON.parse(runs[0]?.stdin ?? '{}')).toEqual({ session_id: 'sess-1', workspace: { project_dir: PROJECT } })
    })

    test('finds the project from a subdirectory', async ($, on) => {
      const { runs, shown } = stage(on, {
        stdout: '[AIDLC] CONSTRUCTION Unit 1 of 3 > Code Generation\n',
        cwd: `${PROJECT}/src/lib`,
      })
      await $.session.start(START)
      expect(runs[0]?.env).toEqual({ CLAUDE_PROJECT_DIR: PROJECT })
      expect(shown.at(-1)).toBe('[AIDLC] CONSTRUCTION Unit 1 of 3 > Code Generation')
    })

    test('runs the command a settings file wires through engine statusline', async ($, on) => {
      const { runs } = stage(on, {
        stdout: '[AIDLC] INCEPTION > Requirements Analysis\n',
        files: { [`${PROJECT}/.claude/settings.json`]: statusLine('aidlc engine statusline') },
      })
      await $.session.start(START)
      expect(runs[0]?.argv).toEqual(['sh', '-c', 'aidlc engine statusline'])
    })

    test('falls back to the hook file of an install that predates the shipped command', async ($, on) => {
      const { runs } = stage(on, {
        stdout: '[AIDLC] INCEPTION > Requirements Analysis\n',
        files: { [`${PROJECT}/.claude/hooks/aidlc-statusline.ts`]: '' },
      })
      await $.session.start(START)
      expect(runs[0]?.argv).toEqual(['sh', '-c', LEGACY])
    })

    test('finishes the turn without waiting for the status line, then shows it', async ($, on) => {
      const pending = deferred()
      const { runs, shown } = stage(on, { run: () => pending.promise })
      await $.turn.complete(TURN)
      await settle()
      expect(runs).toHaveLength(1)
      expect(shown).toHaveLength(0)
      pending.resolve(output('[AIDLC] INCEPTION > User Stories\n'))
      await settle()
      expect(shown.at(-1)).toBe('[AIDLC] INCEPTION > User Stories')
    })
  })

  describe('Edge Cases', () => {
    test('shows nothing outside an AI-DLC project', async ($, on) => {
      const { runs, shown } = stage(on, { files: {}, dirs: [] })
      await $.session.start(START)
      expect(runs).toHaveLength(0)
      expect(shown.at(-1)).toBeUndefined()
    })

    test('shows nothing while no workflow is running', async ($, on) => {
      const { shown } = stage(on, { stdout: '[AIDLC] ready | ↑1k ↓2k\n' })
      await $.session.start(START)
      expect(shown.at(-1)).toBeUndefined()
    })

    test('shows nothing while no workflow is running, even with more text after ready', async ($, on) => {
      const { shown } = stage(on, { stdout: '[AIDLC] ready -- Product | ↑1k ↓2k\n' })
      await $.session.start(START)
      expect(shown.at(-1)).toBeUndefined()
    })

    test('keeps the newest status line when an older run finishes last', async ($, on) => {
      const first = deferred()
      const second = deferred()
      const queue = [first, second]
      const { shown } = stage(on, { run: () => queue.shift()!.promise })
      await $.turn.complete(TURN)
      await $.turn.complete({ ...TURN, turnId: 't2' })
      second.resolve(output('[AIDLC] INCEPTION > Application Design\n'))
      await settle()
      first.resolve(output('[AIDLC] INCEPTION > User Stories\n'))
      await settle()
      expect(shown.at(-1)).toBe('[AIDLC] INCEPTION > Application Design')
    })
  })

  describe('Negative Cases', () => {
    test('does not run a personal status line whose path mentions aidlc', async ($, on) => {
      const { runs } = stage(on, {
        files: { [`${PROJECT}/.claude/settings.local.json`]: statusLine('~/bin/my-status.sh --aidlc') },
      })
      await $.session.start(START)
      expect(runs).toHaveLength(0)
    })
  })
})
