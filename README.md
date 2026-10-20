# aidlc-phase

A Claude Code mod that shows the AI-DLC phase and stage on one line below the prompt. You keep your own statusLine; the project's statusLine does not have to be replaced by AI-DLC's.

```
⚠ aidlc-phase: [AIDLC] my-feature · INCEPTION [▓▓▓░░░░░░░] 3/9 > User Stories
```

The mod is `hooks/register.ts` and its tests are `hooks/register.test.ts`. The repository is also the marketplace (`.claude-plugin/`).

## When it runs

- Only when the working folder or one of its parents has an `aidlc/` folder (an AI-DLC project). Anywhere else it runs nothing and shows nothing
- When no workflow is in progress (`[AIDLC] ready`), the line is hidden
- Function hooks must be enabled (`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`)

## Install

Run these in the folder of a project that uses AI-DLC:

```bash
claude plugin marketplace add 70-10/aidlc-phase --scope local
claude plugin install aidlc-phase@aidlc-phase --scope local
```

`--scope local` writes to `.claude/settings.local.json` of the repository. Even when run in a subfolder, it writes to the git root.

Auto-update is off by default for this marketplace. To receive updates automatically, turn on auto-update for it in the `/plugin` screen.

## Test

```bash
claude plugin validate .
claude plugin test .
```
