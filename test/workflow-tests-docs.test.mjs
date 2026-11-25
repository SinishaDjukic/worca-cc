// test/workflow-tests-docs.test.mjs — docs/workflow-tests.md: the workflowTests flag's "How it works" points at it, the flags row
// and the docs index link it (as design-docs.test.mjs and docs-sessions.test.mjs pin theirs), and every relative link on it resolves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { flagByKey } from '../src/shared/flags/registry.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const page = read('docs/workflow-tests.md');

test('the flag, the flags row and the docs index point at the page', () => {
  assert.equal(flagByKey('workflowTests').docs, 'docs/workflow-tests.md');
  const row = read('docs/feature-flags.md').split('\n').find((l) => l.startsWith('| `workflowTests` |'));
  assert.match(row, /\(\[docs\]\(workflow-tests\.md\)\)/);
  assert.doesNotMatch(row, /Part \d/, 'no internal part numbers in the flags row');
  assert.match(read('docs/README.md'), /\]\(workflow-tests\.md\)/);
  assert.match(read('docs/workflows.md'), /\]\(workflow-tests\.md\)/, 'workflows.md › Tests (Labs) points here');
});

/** GitHub's heading slug: lower case, marks other than "-" and "_" dropped, spaces to "-". */
const slug = (h) => h.trim().toLowerCase().replace(/[`*]/g, '').replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
const anchorsOf = (md) => new Set(md.split('\n').filter((l) => /^#{1,6}\s/.test(l)).map((l) => slug(l.replace(/^#+\s*/, ''))));

test('every relative link on the page, and every link to the page, lands on a file and a heading', () => {
  const sources = [['docs/workflow-tests.md', page], ['docs/changelog/unreleased.md', read('docs/changelog/unreleased.md')]];
  let n = 0;
  for (const [from, md] of sources) {
    for (const m of md.matchAll(/\]\(([^)\s#]*)(?:#([^)\s]*))?\)/g)) {
      const [, file, anchor] = m;
      if (/^[a-z]+:/i.test(file)) continue;   // a web address
      const target = file ? new URL(file, new URL(`../${from}`, import.meta.url)) : new URL(`../${from}`, import.meta.url);
      if (from.endsWith('unreleased.md') && !/workflow-tests\.md$/.test(target.pathname)) continue;   // only the links into this page there
      assert.ok(existsSync(target), `${from}: ${m[0]}`);
      if (anchor && target.pathname.endsWith('.md')) assert.ok(anchorsOf(readFileSync(target, 'utf8')).has(anchor), `${from}: ${m[0]}`);
      n += 1;
    }
  }
  assert.ok(n > 10, `the links were read (${n})`);
});
