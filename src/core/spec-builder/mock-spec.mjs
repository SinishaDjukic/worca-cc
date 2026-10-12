// src/core/spec-builder/mock-spec.mjs — the offline Spec Builder (engines/mock.mjs) and the shape tests' well-shaped
// fixture. Passes all eight checks when the project has MOCK_SPEC_PATHS; failing:'testable' breaks one criterion.
import { renderWorcaFrontMatter, GENERATED_BY } from '../../shared/spec-builder/front-matter.mjs';

export const MOCK_SPEC_FM = Object.freeze({ kind: 'feature', size: 'medium', roles: Object.freeze(['product', 'architect', 'qa']), generatedBy: GENERATED_BY, mode: 'draft' });
export const MOCK_SPEC_PATHS = Object.freeze(['src/app.mjs', 'src/store.mjs', 'test/app.test.mjs']);
export const MOCK_SPEC_QUESTIONS = Object.freeze([Object.freeze({
  id: 'chart-storage', text: 'Where should pinned charts be stored?',
  why: '`src/store.mjs` keeps per-project state only.', options: Object.freeze(['Per project', 'Per user']),
})]);

export function mockSpecMarkdown({ failing = null } = {}) {
  const second = failing === 'testable'
    ? '2. Charts work properly.'
    : '2. A pinned chart is listed by `listCharts()` after a reload.';
  return `${renderWorcaFrontMatter({ ...MOCK_SPEC_FM, roles: [...MOCK_SPEC_FM.roles] })}# Charts from a question

## 1. Problem and goal

People want a chart without writing a query.

1. Asking "runs per day" shows a bar chart within 2 s.
${second}

## 2. Decisions

| # | Decision |
|---|---|
| 1 | Charts are stored as definitions in \`src/store.mjs\`, never as images. |
| 2 | The chart builder lives in \`src/charts.mjs\` (new). |

## 3. Code layout

- \`src/app.mjs\`: registers the charts route.
- \`src/charts.mjs\` (new): \`buildChart(question)\` returns a chart definition.

### Checklist

- [ ] R-arch-1 Charts are stored as definitions, not images.

## 4. Testing

- \`test/app.test.mjs\`: the charts route answers 200 with a definition.
- \`test/charts.test.mjs\` (new): \`buildChart\` rejects an unknown metric with an error.

### Checklist

- [ ] R-qa-1 An unknown metric is rejected with a 400.
- [ ] R-qa-2 A pinned chart is listed after a reload.

## 5. Out of scope

- Dashboards with more than one chart.

## 6. Open questions

1. None yet.
`;
}
