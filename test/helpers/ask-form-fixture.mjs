// test/helpers/ask-form-fixture.mjs — ONE kind:'form' ask covering every class in
// widget catalog v1. Used by tools/verify-ask-forms-cdp.mjs; safe to import from a
// test (pure data, no side effects).
export const ASK_FORM_FIXTURE = Object.freeze({
  // X1: `id` is the question id (colons and all, as a real one has); `askId` is the
  // sanitized route token the /ask-files/ URL is built from.
  id: 'questions-x:n_design:1-r1', askId: 'questions-x_n_design_1-r1',
  kind: 'form', agent: 'designer', surface: 'any',
  form: 'review-mockups', version: 1, title: 'Review mockups',
  data: {
    summary: '## Two directions\n\nPick one, or ask for changes.',
    images: [{ id: 'a', caption: 'Option A', file: 'mockups/a.png' },
      { id: 'b', caption: 'Option B', file: 'mockups/b.png' }],
    items: [{ id: 'x', title: 'Ship the banner', meta: '2 files' },
      { id: 'y', title: 'Rework the nav', meta: '5 files' }],
    doc: 'out/report.pdf',
    patch: '@@ -1,2 +1,3 @@\n-old line\n+new line\n context',
  },
  layout: [
    { widget: 'markdown', bind: 'data.summary' },
    { widget: 'tabs', tabs: [
      { label: 'Mockups', children: [
        { widget: 'gallery', field: 'picked', bind: 'data.images', captionKey: 'caption', fileKey: 'file' },
      ] },
      { label: 'Changes', children: [{ widget: 'diff', name: 'patch', bind: 'data.patch' }] },
      { label: 'Report', children: [{ widget: 'pdf', bind: 'data.doc' }] },
    ] },
    { widget: 'columns', columns: [
      [{ widget: 'select', field: 'verdict', label: 'Verdict',
        labels: { approve: 'Approve', changes: 'Request changes' } }],
      [{ widget: 'rank', field: 'order', label: 'Priority', bind: 'data.items', titleKey: 'title', metaKey: 'meta' }],
    ] },
    { widget: 'textarea', field: 'notes', label: 'What should change?', when: { verdict: 'changes' } },
  ],
  answerSchema: {
    type: 'object', required: ['verdict', 'order'],
    properties: {
      verdict: { type: 'string', enum: ['approve', 'changes'] },
      picked: { type: 'string', enum: ['a', 'b'] },
      order: { type: 'array', items: { type: 'string' } },
      notes: { type: 'string', maxLength: 4000 },
    },
  },
  // X16: document order, fileRefs[i] <-> files[i]. `data.patch` is a plain string
  // field and is deliberately ABSENT, so the diff widget renders it as content.
  fileRefs: [
    { path: 'data.images[0].file', rel: 'mockups/a.png' },
    { path: 'data.images[1].file', rel: 'mockups/b.png' },
    { path: 'data.doc', rel: 'out/report.pdf' },
  ],
  files: [
    { index: 0, rel: 'mockups/a.png', name: 'a.png', mime: 'image/png', bytes: 2048, sha256: 'a' },
    { index: 1, rel: 'mockups/b.png', name: 'b.png', mime: 'image/png', bytes: 2100, sha256: 'b' },
    { index: 2, rel: 'out/report.pdf', name: 'report.pdf', mime: 'application/pdf', bytes: 524288, sha256: 'c' },
  ],
});
