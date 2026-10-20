import { describe, expect, test } from 'claude-code/testing'

import {
  approvedUnits,
  buildProgress,
  countPlanned,
  intentFromLine,
  isUnitMajorConstruction,
  layoutPane,
  readStageGraph,
  readStageProgress,
  recordDirFor,
  shownStep,
  spaceFromCursor,
  summaryLines,
  unitNames,
  unitProgressOf,
} from './progress'
import type { PaneLine } from './progress'
import {
  INTENTS_JSON,
  REQUIREMENTS_RUNNING,
  ROUGH_MOCKUPS_RUNNING,
  STAGE_GRAPH,
  auditEntry,
  stateText,
  unitDag,
} from './fixtures'

const GRAPH = readStageGraph(STAGE_GRAPH)

function progressOf(boxes: Record<string, string>, fields: Record<string, string> = {}) {
  const state = stateText({ boxes, fields })
  const current = Object.entries(boxes).find(([, box]) => box === '-' || box === '?')?.[0] ?? ''
  return buildProgress('stage-pane-ui', state, GRAPH, { stage: current }, null)
}

function shape(lines: readonly PaneLine[]): string[] {
  return lines.map(line => {
    switch (line.kind) {
      case 'stage': return `stage ${line.stage.number}${line.unitLabel ? ` ${line.unitLabel}` : ''}`
      case 'unit': return `unit ${line.unit.name} ${line.unit.mark}`
      case 'skipped': return `skipped ${line.count}`
      case 'notice': case 'summary': case 'phase': case 'phase-done': case 'legend': return `${line.kind} ${line.text}`
      default: return line.kind
    }
  })
}

describe('reading AI-DLC files', () => {
  describe('Positive Cases', () => {
    test('lists the 33 stages of AI-DLC itself, not those a plugin adds', () => {
      expect(GRAPH).toHaveLength(33)
      expect(GRAPH.some(stage => stage.slug === 'acme-review')).toBe(false)
      expect(GRAPH[23]).toEqual({
        slug: 'code-generation', number: '3.5', name: 'Code Generation', phase: 'construction', execution: 'ALWAYS',
      })
    })

    test('marks the 9 stages this Intent runs, 7 always and 2 conditional, and the rest as not run', () => {
      const rows = readStageProgress(stateText(), GRAPH)
      expect(rows).toHaveLength(33)
      expect(rows.filter(row => row.tone === 'always')).toHaveLength(7)
      expect(rows.filter(row => row.tone === 'conditional')).toHaveLength(2)
      expect(rows.filter(row => row.tone === 'none')).toHaveLength(24)
      expect(rows.find(row => row.slug === 'rough-mockups')?.mark).toBe('running')
    })

    test('shows a stage that always runs but the plan skips as not run', () => {
      const scope = readStageProgress(stateText(), GRAPH).find(row => row.slug === 'scope-definition')
      expect(scope).toEqual(expect.objectContaining({ mark: 'skipped', tone: 'none' }))
    })

    test('turns each box of a planned stage into its mark', () => {
      const boxes = { ...ROUGH_MOCKUPS_RUNNING, 'rough-mockups': '?', 'reverse-engineering': 'R', 'requirements-analysis': ' ' }
      const rows = readStageProgress(stateText({ boxes }), GRAPH)
      const markOf = (slug: string) => rows.find(row => row.slug === slug)?.mark
      expect(markOf('intent-capture')).toBe('done')
      expect(markOf('rough-mockups')).toBe('awaiting')
      expect(markOf('reverse-engineering')).toBe('revising')
      expect(markOf('requirements-analysis')).toBe('todo')
    })

    test('a stage skipped midway leaves the count as done 4 of 8', () => {
      const boxes = { ...ROUGH_MOCKUPS_RUNNING, 'rough-mockups': 'S', 'reverse-engineering': '-' }
      const rows = readStageProgress(stateText({ boxes }), GRAPH)
      expect(rows.find(row => row.slug === 'rough-mockups')).toEqual(expect.objectContaining({ mark: 'skipped', tone: 'none' }))
      expect(countPlanned(rows)).toEqual({ done: 4, planned: 8 })
    })

    test('takes the Intent name from the status line, with and without a space in front', () => {
      expect(intentFromLine('[AIDLC] stage-pane-ui · CONSTRUCTION > Code Generation -- Developer'))
        .toEqual({ space: null, slug: 'stage-pane-ui' })
      expect(intentFromLine('[AIDLC] team-a · stage-pane-ui · INCEPTION [▓░] 1/2 > User Stories'))
        .toEqual({ space: 'team-a', slug: 'stage-pane-ui' })
      expect(spaceFromCursor('team-a\n')).toBe('team-a')
      expect(spaceFromCursor(null)).toBe('default')
    })

    test('finds the record of the Intent the status line names', () => {
      expect(recordDirFor(INTENTS_JSON, 'stage-pane-ui')).toBe('261020-stage-pane-ui')
    })

    test('of two Intents with one name, takes the one in flight', () => {
      const intents = JSON.stringify([
        { slug: 'pane', dirName: '261001-pane', status: 'complete' },
        { slug: 'pane', dirName: '261020-pane', status: 'in-flight' },
      ])
      expect(recordDirFor(intents, 'pane')).toBe('261020-pane')
    })

    test('working one Unit at a time, counts Unit 2 of 3 with u1 approved and u2 under way', () => {
      const state = stateText({ fields: { 'Lifecycle Phase': 'CONSTRUCTION', 'Construction Iteration': 'unit-major' } })
      expect(isUnitMajorConstruction(state)).toBe(true)
      const units = unitNames(unitDag(['u1', 'u2', 'u3']))
      const approved = approvedUnits(['# Audit\n\n' + auditEntry('GATE_APPROVED', 'u1', '2026-10-20T01:00:00Z')], units)
      expect(unitProgressOf(units, approved, 'u2')).toEqual({
        current: 2,
        total: 3,
        units: [{ name: 'u1', mark: 'done' }, { name: 'u2', mark: 'running' }, { name: 'u3', mark: 'todo' }],
      })
    })

    test('shows the step AI-DLC last put to the person while nothing has written the state since', () => {
      const state = stateText({ fields: { 'Current Stage': 'functional-design' } })
      const marker = JSON.stringify({ stage: 'code-generation', unit: 'u2' })
      expect(shownStep(state, { text: marker, isFresh: true })).toEqual({ stage: 'code-generation', unit: 'u2' })
      expect(shownStep(state, { text: marker, isFresh: false })).toEqual({ stage: 'functional-design', unit: '' })
      expect(shownStep(stateText({ fields: { 'Unit Stage': 'nfr-design' } }), { text: marker, isFresh: true }))
        .toEqual({ stage: 'nfr-design', unit: '' })
    })
  })

  describe('Edge Cases', () => {
    test('ignores rows of stages that are not among the 33', () => {
      const rows = readStageProgress(stateText({ extraRows: ['- [?] acme-review — EXECUTE'] }), GRAPH)
      expect(rows).toHaveLength(33)
    })

    test('a later rejection takes a Unit back out of the approved ones', () => {
      const audit = [
        auditEntry('GATE_APPROVED', 'u1', '2026-10-20T01:00:00Z'),
        auditEntry('GATE_REJECTED', 'u1', '2026-10-20T02:00:00Z'),
      ].join('\n')
      expect(approvedUnits(['# Audit\n\n' + audit], ['u1', 'u2'])).toEqual([])
    })

    test('working stage by stage, shows no Unit progress', () => {
      const state = stateText({ fields: { 'Lifecycle Phase': 'CONSTRUCTION', 'Construction Iteration': 'stage-major' } })
      expect(isUnitMajorConstruction(state)).toBe(false)
    })

    test('with no Unit list, or every Unit approved, shows no Unit progress', () => {
      expect(unitNames('# Unit of Work Dependency\n\nno edge block')).toEqual([])
      expect(unitProgressOf([], [], '')).toBeNull()
      expect(unitProgressOf(['u1'], ['u1'], '')).toBeNull()
    })

    test('counts every planned stage done as all done', () => {
      const boxes = Object.fromEntries(
        ['workspace-scaffold', 'workspace-detection', 'state-init', 'intent-capture', 'rough-mockups',
          'reverse-engineering', 'requirements-analysis', 'code-generation', 'build-and-test'].map(slug => [slug, 'x']),
      )
      const progress = buildProgress('stage-pane-ui', stateText({ boxes }), GRAPH, { stage: '' }, null)
      expect(progress.isComplete).toBe(true)
    })
  })

  describe('Negative Cases', () => {
    test('fails on a box it does not know', () => {
      const boxes = { ...ROUGH_MOCKUPS_RUNNING, 'rough-mockups': '!' }
      expect(() => readStageProgress(stateText({ boxes }), GRAPH)).toThrow(/rough-mockups/)
    })

    test('fails on a skipped stage marked done', () => {
      const boxes = { ...ROUGH_MOCKUPS_RUNNING, 'market-research': 'x' }
      expect(() => readStageProgress(stateText({ boxes }), GRAPH)).toThrow(/market-research/)
    })

    test('fails when one of the 33 stages has no row', () => {
      expect(() => readStageProgress(stateText({ omit: ['ci-pipeline'] }), GRAPH)).toThrow(/ci-pipeline/)
    })

    test('fails when the status line names an Intent the list does not have', () => {
      expect(() => recordDirFor(INTENTS_JSON, 'other')).toThrow(/other/)
    })

    test('fails when two Intents of one name are both in flight', () => {
      const intents = JSON.stringify([
        { slug: 'pane', dirName: '261001-pane', status: 'in-flight' },
        { slug: 'pane', dirName: '261020-pane', status: 'in-flight' },
      ])
      expect(() => recordDirFor(intents, 'pane')).toThrow(/2 intents/)
    })

    test('fails on a stage graph it cannot read', () => {
      expect(() => readStageGraph('{')).toThrow(/not JSON/)
      expect(() => readStageGraph(JSON.stringify([{ slug: 'x', number: '0.1' }]))).toThrow(/cannot read/)
    })

    test('a status line with no Intent name gives none', () => {
      expect(intentFromLine('[AIDLC] CONSTRUCTION > Code Generation')).toBeNull()
    })

    test('never takes a space or record name that leads out of its folder', () => {
      expect(intentFromLine('[AIDLC] ../x · pane · INCEPTION > User Stories')).toBeNull()
      expect(() => recordDirFor(JSON.stringify([{ slug: 'pane', dirName: '../../etc' }]), 'pane')).toThrow(/no intent/)
    })
  })
})

describe('laying out the pane', () => {
  describe('Positive Cases', () => {
    test('sums up the Intent, its count of all 33 stages, and the stage under way', () => {
      expect(summaryLines(progressOf(ROUGH_MOCKUPS_RUNNING))).toEqual([
        'stage-pane-ui',
        '実施 4/9 完了 ・ 全 33 ステージ',
        '現在 ▶ 1.6 Rough Mockups',
      ])
    })

    test('with room for every row, folds nothing', () => {
      const lines = layoutPane(progressOf(REQUIREMENTS_RUNNING), 46, false)
      expect(lines).toHaveLength(46)
      expect(lines.filter(line => line.kind === 'stage')).toHaveLength(33)
      expect(lines.filter(line => line.kind === 'phase')).toHaveLength(5)
      expect(lines.find(line => line.kind === 'stage' && line.isCurrent)).toEqual(
        expect.objectContaining({ stage: expect.objectContaining({ slug: 'requirements-analysis' }) }),
      )
    })

    test('in 20 rows, folds finished phases, then the skipped stages of each phase', () => {
      const lines = layoutPane(progressOf(REQUIREMENTS_RUNNING), 20, false)
      expect(shape(lines)).toEqual([
        'summary stage-pane-ui',
        'summary 実施 6/9 完了 ・ 全 33 ステージ',
        'summary 現在 ▶ 2.3 Requirements Analysis',
        'blank',
        'phase-done INITIALIZATION 実施 3/3 完了',
        'phase-done IDEATION 実施 2/2 完了 ・ 飛ばす 5',
        'phase INCEPTION', 'stage 2.1', 'stage 2.3', 'skipped 7',
        'phase CONSTRUCTION', 'stage 3.5', 'stage 3.6', 'skipped 5',
        'phase OPERATION', 'skipped 7',
        'rule',
        'legend ✓完了  ▶実行中  ?承認待ち  ↺直し中',
        'legend ・これから  –飛ばす',
        'legend-tones',
      ])
    })

    test('says all done once every planned stage is done', () => {
      const boxes = { ...REQUIREMENTS_RUNNING, 'requirements-analysis': 'x', 'code-generation': 'x', 'build-and-test': 'x' }
      expect(summaryLines(progressOf(boxes)).slice(1)).toEqual(['実施 9/9 完了 ・ 全 33 ステージ', '現在 すべて完了'])
    })

    test('says a stage waits for approval', () => {
      const boxes = { ...ROUGH_MOCKUPS_RUNNING, 'rough-mockups': '?' }
      expect(summaryLines(progressOf(boxes))[2]).toBe('現在 ? 1.6 Rough Mockups（承認待ち）')
    })

    test('lists the Units under the stage under way, with its Unit count', () => {
      const progress = {
        ...progressOf({ ...REQUIREMENTS_RUNNING, 'requirements-analysis': 'x', 'code-generation': '-' }),
        units: unitProgressOf(['u1', 'u2', 'u3'], ['u1'], 'u2'),
      }
      const lines = shape(layoutPane(progress, 60, false))
      const at = lines.indexOf('stage 3.5 Unit 2/3')
      expect(lines.slice(at, at + 4)).toEqual(['stage 3.5 Unit 2/3', 'unit u1 done', 'unit u2 running', 'unit u3 todo'])
    })
  })

  describe('Edge Cases', () => {
    test('folds only as much as the height lacks', () => {
      const lines = shape(layoutPane(progressOf(REQUIREMENTS_RUNNING), 45, false))
      expect(lines).toHaveLength(43)
      expect(lines.filter(line => line.startsWith('phase-done'))).toEqual(['phase-done INITIALIZATION 実施 3/3 完了'])
    })

    test('counts the stale notice in the height and puts it first', () => {
      const lines = layoutPane(progressOf(REQUIREMENTS_RUNNING), 20, true)
      expect(shape(lines)[0]).toBe('notice 最新の状態を読み取れませんでした')
      expect(lines).toHaveLength(21)
    })

    test('with no stage planned, counts done 0 of 0', () => {
      const state = stateText({
        boxes: {},
        kinds: Object.fromEntries(GRAPH.map(stage => [stage.slug, 'SKIP'])),
      })
      const progress = buildProgress('empty', state, GRAPH, { stage: '' }, null)
      expect(summaryLines(progress)).toEqual(['empty', '実施 0/0 完了 ・ 全 33 ステージ', '現在 —'])
    })
  })

  describe('Negative Cases', () => {
    test('never folds the summary or the legend, even when nothing fits', () => {
      const lines = shape(layoutPane(progressOf(REQUIREMENTS_RUNNING), 3, false))
      expect(lines.slice(0, 4)).toEqual([
        'summary stage-pane-ui', 'summary 実施 6/9 完了 ・ 全 33 ステージ', 'summary 現在 ▶ 2.3 Requirements Analysis', 'blank',
      ])
      expect(lines.slice(-4)).toEqual(['rule', 'legend ✓完了  ▶実行中  ?承認待ち  ↺直し中', 'legend ・これから  –飛ばす', 'legend-tones'])
      expect(lines).toHaveLength(20)
    })
  })
})
