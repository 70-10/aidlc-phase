import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PROJECT = '/work/app'
const SHIPPED = 'bun "$CLAUDE_PROJECT_DIR/.claude/tools/aidlc.ts" engine statusline'
const LEGACY = 'bun "$CLAUDE_PROJECT_DIR/.claude/hooks/aidlc-statusline.ts"'

type Run = { argv: readonly string[]; cwd?: string; env?: Record<string, string>; stdin?: string }

function stage(on: On, files: Record<string, string>, dirs: string[], stdout: string, cwd = PROJECT) {
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
  on('process.run', ($, e) => {
    runs.push({ argv: e.argv, ...e.init })
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.status', ($, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  return { runs, shown }
}

const START = { cwd: PROJECT, surface: 'terminal', isInteractive: true } as const

describe('aidlc-phase', () => {
  test('shows the left side of AI-DLC\'s own status line, without cost', async ($, on) => {
    const { runs, shown } = stage(
      on,
      { [`${PROJECT}/.claude/tools/data/harness.json`]: JSON.stringify({ statusLine: { type: 'command', command: SHIPPED } }) },
      [`${PROJECT}/aidlc`],
      '[AIDLC] my-feature · INCEPTION [▓▓▓░░░░░░░] 3/9 > User Stories -- Product | ↑1.2k ↓300 $0.10\n',
    )
    await $.session.start(START)
    expect(shown.at(-1)).toBe('[AIDLC] my-feature · INCEPTION [▓▓▓░░░░░░░] 3/9 > User Stories -- Product')
    expect(runs[0]?.argv).toEqual(['sh', '-c', SHIPPED])
    expect(runs[0]?.cwd).toBe(PROJECT)
    expect(runs[0]?.env).toEqual({ CLAUDE_PROJECT_DIR: PROJECT })
    expect(JSON.parse(runs[0]?.stdin ?? '{}')).toEqual({ session_id: 'sess-1', workspace: { project_dir: PROJECT } })
  })

  test('finds the project from a subdirectory', async ($, on) => {
    const { runs, shown } = stage(
      on,
      { [`${PROJECT}/.claude/tools/data/harness.json`]: JSON.stringify({ statusLine: { type: 'command', command: SHIPPED } }) },
      [`${PROJECT}/aidlc`],
      '[AIDLC] CONSTRUCTION Unit 1 of 3 > Code Generation\n',
      `${PROJECT}/src/lib`,
    )
    await $.session.start({ ...START, cwd: `${PROJECT}/src/lib` })
    expect(runs[0]?.env).toEqual({ CLAUDE_PROJECT_DIR: PROJECT })
    expect(shown.at(-1)).toBe('[AIDLC] CONSTRUCTION Unit 1 of 3 > Code Generation')
  })

  test('falls back to the hook file of an install that predates the shipped command', async ($, on) => {
    const { runs } = stage(
      on,
      { [`${PROJECT}/.claude/hooks/aidlc-statusline.ts`]: '' },
      [`${PROJECT}/aidlc`],
      '[AIDLC] INCEPTION > Requirements Analysis\n',
    )
    await $.session.start(START)
    expect(runs[0]?.argv).toEqual(['sh', '-c', LEGACY])
  })

  test('shows nothing outside an AI-DLC project', async ($, on) => {
    const { runs, shown } = stage(on, {}, [], '')
    await $.session.start(START)
    expect(runs).toHaveLength(0)
    expect(shown.at(-1)).toBeUndefined()
  })

  test('shows nothing while no workflow is running', async ($, on) => {
    const { shown } = stage(
      on,
      { [`${PROJECT}/.claude/tools/data/harness.json`]: JSON.stringify({ statusLine: { type: 'command', command: SHIPPED } }) },
      [`${PROJECT}/aidlc`],
      '[AIDLC] ready | ↑1k ↓2k\n',
    )
    await $.session.start(START)
    expect(shown.at(-1)).toBeUndefined()
  })

  test('refreshes when a turn completes', async ($, on) => {
    const { runs } = stage(
      on,
      { [`${PROJECT}/.claude/tools/data/harness.json`]: JSON.stringify({ statusLine: { type: 'command', command: SHIPPED } }) },
      [`${PROJECT}/aidlc`],
      '[AIDLC] INCEPTION > User Stories\n',
    )
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(runs).toHaveLength(1)
  })
})
