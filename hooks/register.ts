import type { EngineInterface, Register } from 'claude-code'

// AI-DLC's own renderer is run instead of reading aidlc-state.md here: which
// intent a session shows (its binding, the active-intent cursor, archived
// records, Unit progress) is the engine's rule and changes with each release.
const COMMAND_SOURCES = [
  '.claude/tools/data/harness.json',
  '.claude/settings.local.json',
  '.claude/settings.json',
]
const LEGACY_HOOK = '.claude/hooks/aidlc-statusline.ts'

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
      if (typeof command === 'string' && command.includes('aidlc')) return command
    } catch {
      // A missing or unreadable file only means the next place may have it.
    }
  }
  return (await $.fs.exists(`${project}/${LEGACY_HOOK}`))
    ? `bun "$CLAUDE_PROJECT_DIR/${LEGACY_HOOK}"`
    : null
}

async function phaseLine($: EngineInterface): Promise<string | undefined> {
  const project = await projectDir($, await $.session.cwd())
  if (project === null) return undefined
  const command = await statusLineCommand($, project)
  if (command === null) return undefined
  // No model or context figures go in, so the right side carries cost at most;
  // the person's own status line already shows those.
  const { exitCode, stdout } = await $.process.run(['sh', '-c', command], {
    cwd: project,
    env: { CLAUDE_PROJECT_DIR: project },
    stdin: JSON.stringify({ session_id: await $.session.id(), workspace: { project_dir: project } }),
    timeoutMs: 10_000,
  })
  if (exitCode !== 0) return undefined
  const left = (stdout.split('\n')[0] ?? '').replace(/\x1b\[[0-9;]*m/g, '').split(' | ')[0]?.trim() ?? ''
  return left === '' || left === '[AIDLC] ready' ? undefined : left
}

async function refresh($: EngineInterface): Promise<void> {
  try {
    $.ui.status(await phaseLine($))
  } catch {
    $.ui.status(undefined)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await refresh($)
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await refresh($)
    return done
  })
}
