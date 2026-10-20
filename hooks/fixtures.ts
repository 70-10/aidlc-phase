const STAGES: ReadonlyArray<readonly [string, string, string, string, 'ALWAYS' | 'CONDITIONAL']> = [
  ['0.1', 'workspace-scaffold', 'Workspace Scaffold', 'initialization', 'ALWAYS'],
  ['0.2', 'workspace-detection', 'Workspace Detection', 'initialization', 'ALWAYS'],
  ['0.3', 'state-init', 'State Initialization', 'initialization', 'ALWAYS'],
  ['1.1', 'intent-capture', 'Intent Capture & Framing', 'ideation', 'ALWAYS'],
  ['1.2', 'market-research', 'Market Research', 'ideation', 'CONDITIONAL'],
  ['1.3', 'feasibility', 'Feasibility & Constraints', 'ideation', 'CONDITIONAL'],
  ['1.4', 'scope-definition', 'Scope Definition', 'ideation', 'ALWAYS'],
  ['1.5', 'team-formation', 'Team Formation', 'ideation', 'CONDITIONAL'],
  ['1.6', 'rough-mockups', 'Rough Mockups', 'ideation', 'CONDITIONAL'],
  ['1.7', 'approval-handoff', 'Approval & Handoff', 'ideation', 'ALWAYS'],
  ['2.1', 'reverse-engineering', 'Reverse Engineering', 'inception', 'CONDITIONAL'],
  ['2.2', 'practices-discovery', 'Practices Discovery', 'inception', 'CONDITIONAL'],
  ['2.3', 'requirements-analysis', 'Requirements Analysis', 'inception', 'ALWAYS'],
  ['2.4', 'user-stories', 'User Stories', 'inception', 'CONDITIONAL'],
  ['2.5', 'refined-mockups', 'Refined Mockups', 'inception', 'CONDITIONAL'],
  ['2.6', 'domain-design', 'Domain Design', 'inception', 'CONDITIONAL'],
  ['2.7', 'units-generation', 'Units Generation', 'inception', 'ALWAYS'],
  ['2.8', 'contract-design', 'Contract Design', 'inception', 'CONDITIONAL'],
  ['2.9', 'delivery-planning', 'Delivery Planning', 'inception', 'ALWAYS'],
  ['3.1', 'functional-design', 'Functional Design', 'construction', 'CONDITIONAL'],
  ['3.2', 'nfr-requirements', 'NFR Requirements', 'construction', 'CONDITIONAL'],
  ['3.3', 'nfr-design', 'NFR Design', 'construction', 'CONDITIONAL'],
  ['3.4', 'infrastructure-design', 'Infrastructure Design', 'construction', 'CONDITIONAL'],
  ['3.5', 'code-generation', 'Code Generation', 'construction', 'ALWAYS'],
  ['3.6', 'build-and-test', 'Build and Test', 'construction', 'ALWAYS'],
  ['3.7', 'ci-pipeline', 'CI Pipeline', 'construction', 'CONDITIONAL'],
  ['4.1', 'deployment-pipeline', 'Deployment Pipeline', 'operation', 'CONDITIONAL'],
  ['4.2', 'environment-provisioning', 'Environment Provisioning', 'operation', 'CONDITIONAL'],
  ['4.3', 'deployment-execution', 'Deployment Execution', 'operation', 'CONDITIONAL'],
  ['4.4', 'observability-setup', 'Observability Setup', 'operation', 'CONDITIONAL'],
  ['4.5', 'incident-response', 'Incident Response', 'operation', 'CONDITIONAL'],
  ['4.6', 'performance-validation', 'Performance Validation', 'operation', 'CONDITIONAL'],
  ['4.7', 'feedback-optimization', 'Feedback & Optimization', 'operation', 'CONDITIONAL'],
]

export const STAGE_GRAPH = JSON.stringify([
  ...STAGES.map(([number, slug, name, phase, execution]) => ({ slug, number, name, phase, execution, scopes: [] })),
  { slug: 'acme-review', number: '2.10', name: 'Acme Review', phase: 'inception', execution: 'ALWAYS', plugin: 'acme' },
])

const EXECUTED = new Set([
  'workspace-scaffold', 'workspace-detection', 'state-init', 'intent-capture', 'rough-mockups',
  'reverse-engineering', 'requirements-analysis', 'code-generation', 'build-and-test',
])

const PHASE_HEADINGS: Record<string, string> = {
  initialization: '### INITIALIZATION PHASE',
  ideation: '### IDEATION PHASE',
  inception: '### INCEPTION PHASE',
  construction: '### CONSTRUCTION PHASE',
  operation: '### OPERATION PHASE',
}

export const ROUGH_MOCKUPS_RUNNING: Record<string, string> = {
  'workspace-scaffold': 'x', 'workspace-detection': 'x', 'state-init': 'x', 'intent-capture': 'x', 'rough-mockups': '-',
}

export const REQUIREMENTS_RUNNING: Record<string, string> = {
  ...ROUGH_MOCKUPS_RUNNING, 'rough-mockups': 'x', 'reverse-engineering': 'x', 'requirements-analysis': '-',
}

export function stateText({
  boxes = ROUGH_MOCKUPS_RUNNING,
  kinds = {},
  fields = {},
  extraRows = [],
  omit = [],
}: {
  boxes?: Record<string, string>
  kinds?: Record<string, string>
  fields?: Record<string, string>
  extraRows?: string[]
  omit?: string[]
} = {}): string {
  const current = Object.entries(boxes).find(([, box]) => box === '-' || box === '?' || box === 'R')?.[0] ?? ''
  const allFields: Record<string, string> = {
    'Lifecycle Phase': 'IDEATION',
    'Current Stage': current,
    Status: 'Running',
    ...fields,
  }
  const lines = ['# AI-DLC State Tracking', '', '## Current Status']
  for (const [label, value] of Object.entries(allFields)) lines.push(`- **${label}**: ${value}`)
  lines.push('', '## Stage Progress', '<!-- Checkbox states -->')
  let phase = ''
  for (const [, slug, , stagePhase] of STAGES) {
    if (stagePhase !== phase) {
      phase = stagePhase
      lines.push('', PHASE_HEADINGS[phase]!)
      if (phase === 'construction') lines.push('Per unit: [TBD]')
    }
    if (omit.includes(slug)) continue
    const kind = kinds[slug] ?? (EXECUTED.has(slug) ? 'EXECUTE' : 'SKIP')
    lines.push(`- [${boxes[slug] ?? ' '}] ${slug} — ${kind}`)
  }
  lines.push(...extraRows, '', '## Session Resume Point', '- **Next Action**: Execute')
  return lines.join('\n')
}

export const INTENTS_JSON = JSON.stringify([
  { uuid: '01a1', slug: 'stage-pane-ui', dirName: '261020-stage-pane-ui', scope: 'bugfix', status: 'in-flight' },
])

export function unitDag(names: readonly string[]): string {
  return [
    '# Unit of Work Dependency',
    '',
    '## Machine-Readable Edge Block',
    '',
    '```yaml',
    'units:',
    ...names.flatMap(name => [`  - name: ${name}`, '    depends_on: []']),
    '```',
    '',
  ].join('\n')
}

export function auditEntry(event: 'GATE_APPROVED' | 'GATE_REJECTED', unit: string, at: string): string {
  return [
    `## ${event}`,
    `**Timestamp**: ${at}`,
    `**Event**: ${event}`,
    '**Checkpoint**: construction-unit',
    `**Unit**: ${unit}`,
    '',
  ].join('\n')
}
