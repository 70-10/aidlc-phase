import { describe, expect, test } from 'claude-code/testing'

import {
  buildProgress,
  countPlanned,
  intentFromLine,
  layoutPane,
  readStageGraph,
  readStageProgress,
  recordDirFor,
  shownStep,
  spaceFromCursor,
  summaryLines,
  unitHeader,
  unitNames,
  readUnitLedger,
} from './progress'
import type { PaneLine } from './progress'
import {
  INTENTS_JSON,
  REQUIREMENTS_RUNNING,
  ROUGH_MOCKUPS_RUNNING,
  STAGE_GRAPH,
  auditOf,
  stateText,
  unitDag,
  unitEvent,
} from './fixtures'

const GRAPH = readStageGraph(STAGE_GRAPH)

const NO_UNITS = { names: [], ledger: readUnitLedger([], []) }

function progressOf(boxes: Record<string, string>, fields: Record<string, string> = {}) {
  const state = stateText({ boxes, fields })
  const current = Object.entries(boxes).find(([, box]) => box === '-' || box === '?')?.[0] ?? ''
  return buildProgress('stage-pane-ui', state, GRAPH, { stage: current, unit: '' }, NO_UNITS)
}

const THREE = ['auth', 'orders', 'billing']
const WITH_FUNCTIONAL_DESIGN = { 'functional-design': 'EXECUTE' }

// auth has finished every stage, orders has finished Functional Design and is in Code Generation.
const ORDERS_IN_CODE_GENERATION = auditOf(
  unitEvent('UNIT_COMPLETED', 'functional-design', 'auth', '2026-10-20T01:00:00Z'),
  unitEvent('UNIT_COMPLETED', 'code-generation', 'auth', '2026-10-20T02:00:00Z'),
  unitEvent('UNIT_COMPLETED', 'functional-design', 'orders', '2026-10-20T03:00:00Z'),
  unitEvent('UNIT_STARTED', 'code-generation', 'orders', '2026-10-20T04:00:00Z'),
)

function unitsProgress(boxes: Record<string, string>, audits: string[], shown = { stage: '', unit: '' }, names = THREE) {
  const state = stateText({ boxes, kinds: WITH_FUNCTIONAL_DESIGN })
  const current = shown.stage || (Object.entries(boxes).find(([, box]) => box === '-' || box === '?')?.[0] ?? '')
  return buildProgress('stage-pane-ui', state, GRAPH, { ...shown, stage: current }, { names, ledger: readUnitLedger(audits, names) })
}

const CODE_GENERATION_RUNNING = { ...REQUIREMENTS_RUNNING, 'requirements-analysis': 'x', 'functional-design': 'x', 'code-generation': '-' }

function shape(lines: readonly PaneLine[]): string[] {
  return lines.map(line => {
    switch (line.kind) {
      case 'stage': return [`stage ${line.stage.number}`, line.bracket ?? '', line.unitCount].filter(Boolean).join(' ')
      case 'units': return `units ${line.units.map(unit => `${unit.mark}:${unit.name}`).join(' ')}`
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
        isPerUnit: true,
      })
    })

    test('runs 3.1 to 3.5 once per Unit, and every other stage once', () => {
      expect(GRAPH.filter(stage => stage.isPerUnit).map(stage => stage.number)).toEqual(['3.1', '3.2', '3.3', '3.4', '3.5'])
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

    test('reads the Units from the yaml block that lists them, whatever its heading says', () => {
      const localized = unitDag(THREE).replace('## Machine-Readable Edge Block', '## 機械で読む形')
      const withOtherYaml = ['```yaml', 'note: not the units', '```', '', localized].join('\n')
      expect(unitNames(withOtherYaml)).toEqual(THREE)
    })

    test('reads from the audit which Unit finished which stage, and the Unit still open', () => {
      const ledger = readUnitLedger([ORDERS_IN_CODE_GENERATION], unitNames(unitDag(THREE)))
      expect([...ledger.completed.get('functional-design')!].sort()).toEqual(['auth', 'orders'])
      expect([...ledger.completed.get('code-generation')!]).toEqual(['auth'])
      expect(ledger.open).toBe('orders')
    })

    test('with orders in Code Generation, counts the Units done per stage and marks Functional Design partly done', () => {
      const progress = unitsProgress(CODE_GENERATION_RUNNING, [ORDERS_IN_CODE_GENERATION])
      const row = (slug: string) => progress.stages.find(stage => stage.slug === slug)!
      expect([row('functional-design').mark, row('functional-design').unitsDone]).toEqual(['partly', 2])
      expect([row('code-generation').mark, row('code-generation').unitsDone]).toEqual(['running', 1])
      expect(row('nfr-design').unitsDone).toBeNull()
      expect(row('build-and-test').unitsDone).toBeNull()
      expect(progress.units).toEqual([
        { name: 'auth', mark: 'done' }, { name: 'orders', mark: 'running' }, { name: 'billing', mark: 'todo' },
      ])
    })

    test('once Build and Test is under way, counts every Unit done', () => {
      const boxes = { ...CODE_GENERATION_RUNNING, 'code-generation': 'x', 'build-and-test': '-' }
      const progress = unitsProgress(boxes, [])
      expect(progress.stages.find(stage => stage.slug === 'functional-design')).toMatchObject({ mark: 'done', unitsDone: 3 })
      expect(progress.units?.every(unit => unit.mark === 'done')).toBe(true)
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

    test('a later start takes back the Unit\'s earlier finish of that stage, across audit files', () => {
      const restarted = auditOf(unitEvent('UNIT_STARTED', 'functional-design', 'auth', '2026-10-20T05:00:00Z'))
      const ledger = readUnitLedger([restarted, ORDERS_IN_CODE_GENERATION], THREE)
      expect([...ledger.completed.get('functional-design')!]).toEqual(['orders'])
      expect(ledger.open).toBe('auth')
    })

    test('counts a Unit skipped for a stage as done with it', () => {
      const skipped = auditOf(unitEvent('UNIT_SKIPPED', 'functional-design', 'billing', '2026-10-20T05:00:00Z'))
      const progress = unitsProgress(CODE_GENERATION_RUNNING, [ORDERS_IN_CODE_GENERATION, skipped])
      expect(progress.stages.find(stage => stage.slug === 'functional-design')).toMatchObject({ mark: 'done', unitsDone: 3 })
    })

    test('names the Unit AI-DLC last put to the person as the one under way', () => {
      const progress = unitsProgress(CODE_GENERATION_RUNNING, [], { stage: 'code-generation', unit: 'billing' })
      expect(progress.units?.find(unit => unit.mark === 'running')?.name).toBe('billing')
    })

    test('trusts a stage AI-DLC marks done when the audit has no Unit record of it', () => {
      const progress = unitsProgress(CODE_GENERATION_RUNNING, [])
      expect(progress.stages.find(stage => stage.slug === 'functional-design')).toMatchObject({ mark: 'done', unitsDone: 3 })
    })

    test('with one Unit, or no Unit list, keeps no Units', () => {
      expect(unitNames('# Unit of Work Dependency\n\nno edge block')).toEqual([])
      const progress = unitsProgress(CODE_GENERATION_RUNNING, [ORDERS_IN_CODE_GENERATION], undefined, ['auth'])
      expect(progress.units).toBeNull()
      expect(progress.stages.every(stage => stage.unitsDone === null)).toBe(true)
    })

    test('counts every planned stage done as all done', () => {
      const boxes = Object.fromEntries(
        ['workspace-scaffold', 'workspace-detection', 'state-init', 'intent-capture', 'rough-mockups',
          'reverse-engineering', 'requirements-analysis', 'code-generation', 'build-and-test'].map(slug => [slug, 'x']),
      )
      const progress = buildProgress('stage-pane-ui', stateText({ boxes }), GRAPH, { stage: '', unit: '' }, NO_UNITS)
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
        'Done 4/9 stages of 33',
        'Now ▶ 1.6 Rough Mockups',
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
        'summary Done 6/9 stages of 33',
        'summary Now ▶ 2.3 Requirements Analysis',
        'blank',
        'phase-done INITIALIZATION 3/3 done',
        'phase-done IDEATION 2/2 done · 5 skipped',
        'phase INCEPTION', 'stage 2.1', 'stage 2.3', 'skipped 7',
        'phase CONSTRUCTION', 'stage 3.5', 'stage 3.6', 'skipped 5',
        'phase OPERATION', 'skipped 7',
        'rule',
        'legend ✓done  ▶running  ?approval  ↺revising',
        'legend ·todo  –skipped',
        'legend-tones',
      ])
    })

    test('says all done once every planned stage is done', () => {
      const boxes = { ...REQUIREMENTS_RUNNING, 'requirements-analysis': 'x', 'code-generation': 'x', 'build-and-test': 'x' }
      expect(summaryLines(progressOf(boxes)).slice(1)).toEqual(['Done 9/9 stages of 33', 'Now all done'])
    })

    test('says a stage waits for approval', () => {
      const boxes = { ...ROUGH_MOCKUPS_RUNNING, 'rough-mockups': '?' }
      expect(summaryLines(progressOf(boxes))[2]).toBe('Now ? 1.6 Rough Mockups (approval)')
    })

    test('brackets the stages run per Unit under the Units, with the stages run once for all below it', () => {
      const progress = unitsProgress(CODE_GENERATION_RUNNING, [ORDERS_IN_CODE_GENERATION])
      const lines = shape(layoutPane(progress, 60, false))
      const at = lines.indexOf('phase CONSTRUCTION')
      expect(lines.slice(at, at + 11)).toEqual([
        'phase CONSTRUCTION', 'units done:auth running:orders todo:billing',
        'stage 3.1 mid 2/3', 'stage 3.2 mid', 'stage 3.3 mid', 'stage 3.4 mid', 'stage 3.5 end 1/3',
        'once', 'stage 3.6', 'stage 3.7', 'phase OPERATION',
      ])
    })

    test('with Units, sums up the stages run of all 33, the Units done, and the Unit under way', () => {
      const progress = unitsProgress(CODE_GENERATION_RUNNING, [ORDERS_IN_CODE_GENERATION])
      expect(summaryLines(progress).slice(1)).toEqual(['Done 7/10 stages of 33 · Units 1/3', 'Now ▶ 3.5 Code Generation · orders'])
      expect(shape(layoutPane(progress, 60, false)).filter(line => line.startsWith('legend '))).toEqual([
        'legend ✓done  ▶running  ?approval  ↺revising', 'legend ·todo  –skipped  ◐partly  n/N Units done',
      ])
    })

    test('lists every Unit after the bracket when they fit, and counts them when they do not', () => {
      const units = [
        { name: 'catalog', mark: 'done' }, { name: 'checkout', mark: 'done' }, { name: 'payments', mark: 'running' },
        { name: 'notifications', mark: 'todo' }, { name: 'reporting', mark: 'todo' },
      ] as const
      const text = (columns: number, list: readonly { name: string; mark: 'done' | 'running' | 'partly' | 'todo' }[]) =>
        unitHeader(list, columns).map(part => part.text).join('')
      expect(text(50, units.slice(0, 3))).toBe('┌ For each Unit ✓catalog  ✓checkout  ▶payments')
      expect(text(44, units)).toBe('┌ For each of 5 Units  ✓2 ▶payments ·2')
      expect(text(30, units)).toBe('┌ For each of 5 Units  ✓2 ▶p…')
    })
  })

  describe('Edge Cases', () => {
    test('with one Unit, brackets no stages and keeps the legend short', () => {
      const progress = unitsProgress(CODE_GENERATION_RUNNING, [ORDERS_IN_CODE_GENERATION], undefined, ['auth'])
      const lines = shape(layoutPane(progress, 60, false))
      expect(lines.filter(line => line.startsWith('units ') || line === 'once' || / (mid|end)/.test(line))).toEqual([])
      expect(lines).toContain('legend ·todo  –skipped')
    })

    test('with the skipped stages folded, closes the bracket on the last per-Unit stage still shown', () => {
      const progress = unitsProgress(CODE_GENERATION_RUNNING, [ORDERS_IN_CODE_GENERATION])
      const lines = shape(layoutPane(progress, 3, false))
      const at = lines.indexOf('phase CONSTRUCTION')
      expect(lines.slice(at, at + 7)).toEqual([
        'phase CONSTRUCTION', 'units done:auth running:orders todo:billing', 'stage 3.1 mid 2/3', 'stage 3.5 end 1/3',
        'once', 'stage 3.6', 'skipped 4',
      ])
    })

    test('folds only as much as the height lacks', () => {
      const lines = shape(layoutPane(progressOf(REQUIREMENTS_RUNNING), 45, false))
      expect(lines).toHaveLength(43)
      expect(lines.filter(line => line.startsWith('phase-done'))).toEqual(['phase-done INITIALIZATION 3/3 done'])
    })

    test('counts the stale notice in the height and puts it first', () => {
      const lines = layoutPane(progressOf(REQUIREMENTS_RUNNING), 20, true)
      expect(shape(lines)[0]).toBe('notice Could not read the latest state')
      expect(lines).toHaveLength(21)
    })

    test('with no stage planned, counts done 0 of 0', () => {
      const state = stateText({
        boxes: {},
        kinds: Object.fromEntries(GRAPH.map(stage => [stage.slug, 'SKIP'])),
      })
      const progress = buildProgress('empty', state, GRAPH, { stage: '', unit: '' }, NO_UNITS)
      expect(summaryLines(progress)).toEqual(['empty', 'Done 0/0 stages of 33', 'Now —'])
    })
  })

  describe('Negative Cases', () => {
    test('never folds the summary or the legend, even when nothing fits', () => {
      const lines = shape(layoutPane(progressOf(REQUIREMENTS_RUNNING), 3, false))
      expect(lines.slice(0, 4)).toEqual([
        'summary stage-pane-ui', 'summary Done 6/9 stages of 33', 'summary Now ▶ 2.3 Requirements Analysis', 'blank',
      ])
      expect(lines.slice(-4)).toEqual(['rule', 'legend ✓done  ▶running  ?approval  ↺revising', 'legend ·todo  –skipped', 'legend-tones'])
      expect(lines).toHaveLength(20)
    })
  })
})
