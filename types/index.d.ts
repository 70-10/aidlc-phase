export type StageMark = 'done' | 'running' | 'awaiting' | 'revising' | 'partly' | 'todo' | 'skipped'

export type StageTone = 'always' | 'conditional' | 'none'

export type StageRow = {
  slug: string
  number: string
  name: string
  phase: string
  mark: StageMark
  tone: StageTone
  isPerUnit: boolean
  unitsDone: number | null
}

export type UnitMark = 'done' | 'running' | 'partly' | 'todo'

export type UnitRow = { name: string; mark: UnitMark }

export type Progress = {
  intent: string
  stages: StageRow[]
  current: string | null
  isComplete: boolean
  units: UnitRow[] | null
}

export type PaneView =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'error'; reason: string }
  | { kind: 'progress'; progress: Progress; isStale: boolean }

declare module 'claude-code' {
  interface PluginState {
    'aidlc-phase': {
      view: PaneView
      isAutoOpened: boolean
      isClosedByPerson: boolean
    }
  }
}
