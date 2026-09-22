// test/helpers/ask-form-fixtures.mjs — three declared forms every ask-forms test shares.
// Each call returns a fresh deep copy, so a test may mutate its form freely.

const REVIEW = {
  version: 1, title: 'Pick an onboarding direction',
  data: { type: 'object', required: ['images'], properties: {
    summary: { type: 'string', maxLength: 8000 },
    images: { type: 'array', maxItems: 12, items: { type: 'object', required: ['id', 'file'], properties: {
      id: { type: 'string' }, caption: { type: 'string' }, file: { type: 'file', accept: ['image/*'] } } } } } },
  answer: { type: 'object', required: ['picked', 'verdict', 'notes'], properties: {
    picked: { type: 'string', enumFrom: 'data.images[].id' },
    verdict: { type: 'string', enum: ['build', 'iterate'] },
    notes: { type: 'string', minLength: 10, maxLength: 4000 } } },
  layout: [
    { widget: 'markdown', bind: 'data.summary' },
    { widget: 'gallery', bind: 'data.images', field: 'picked', label: 'Which direction?' },
    { widget: 'select', field: 'verdict', label: 'How close is it?', labels: { build: 'Build it', iterate: 'Another pass' } },
    { widget: 'textarea', field: 'notes', label: 'What should change?', when: { verdict: 'iterate' } },
  ],
  example: { summary: 'Two directions.', images: [
    { id: 'a', caption: 'Option A', file: 'mockups/a.png' }, { id: 'b', caption: 'Option B', file: 'mockups/b.png' }] },
};

const PLAN = {
  version: 2, title: 'Approve the plan',
  data: { type: 'object', required: ['steps'], properties: {
    goal: { type: 'string' },
    steps: { type: 'array', maxItems: 20, items: { type: 'object', required: ['id', 'title'], properties: {
      id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } } } } } },
  answer: { type: 'object', required: ['steps', 'order', 'scope'], properties: {
    steps: { type: 'array', items: { type: 'object', required: ['id', 'verdict'], properties: {
      id: { type: 'string', enumFrom: 'data.steps[].id' },
      verdict: { type: 'string', enum: ['keep', 'change', 'drop'], default: 'keep' },
      note: { type: 'string', maxLength: 500 } } } },
    order: { type: 'array', uniqueItems: true, items: { type: 'string', enumFrom: 'data.steps[].id' } },
    scope: { type: 'string', enum: ['minimal', 'as-planned', 'thorough'], default: 'as-planned' },
    max_cycles: { type: 'integer', minimum: 1, maximum: 5, default: 2 },
    run_tests: { type: 'boolean', default: true } } },
  layout: [
    { widget: 'callout', tone: 'info', title: 'Goal.', bind: 'data.goal' },
    { widget: 'review-list', bind: 'data.steps', field: 'steps', label: 'Steps' },
    { widget: 'columns', columns: [
      [{ widget: 'rank', bind: 'data.steps', field: 'order', label: 'Run order' }],
      [{ widget: 'select', field: 'scope', label: 'Scope', style: 'segmented' },
        { widget: 'group', title: 'Loop', children: [
          { widget: 'slider', field: 'max_cycles', label: 'Review cycles' },
          { widget: 'toggle', field: 'run_tests', label: 'Run tests' }] }] ] },
  ],
  example: { goal: 'Ship forms.', steps: [{ id: 's1', title: 'Core' }, { id: 's2', title: 'Engine', body: 'Gate 2.' }] },
};

const RELEASE = {
  version: 1, title: 'Confirm the release', surface: 'any',
  data: { type: 'object', required: ['suggested_version'], properties: {
    suggested_version: { type: 'string' }, report: { type: 'file', accept: ['application/pdf'] } } },
  answer: { type: 'object', required: ['version', 'platforms', 'signer'], properties: {
    version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(-rc\\.\\d+)?$', patternHint: 'Use semver.', defaultFrom: 'data.suggested_version' },
    platforms: { type: 'array', minItems: 1, items: { type: 'string', enum: ['macos', 'linux', 'windows'] }, default: ['macos', 'linux', 'windows'] },
    signer: { type: 'string', minLength: 2, default: 'release bot' },
    publish_on: { type: 'string', format: 'date' } } },
  layout: [
    { widget: 'pdf', bind: 'data.report' },
    { widget: 'text', field: 'version', label: 'Version' },
    { widget: 'multiselect', field: 'platforms', label: 'Smoke-test on', style: 'chips' },
    { widget: 'signature', requires: { askCatalog: 2 }, field: 'signer', fallback: { widget: 'text', field: 'signer', label: 'Signed off by' } },
    { widget: 'date', field: 'publish_on', label: 'Publish on' },
  ],
  example: { suggested_version: '1.4.0-rc.2', report: 'reports/q3.pdf' },
};

const copy = (v) => JSON.parse(JSON.stringify(v));
export const reviewForm = () => copy(REVIEW);
export const planForm = () => copy(PLAN);
export const releaseForm = () => copy(RELEASE);
