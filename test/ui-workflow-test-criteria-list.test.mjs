// test/ui-workflow-test-criteria-list.test.mjs — board 1's "Your criteria N" chip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderTestsPage } from '../ui/public/workflows/tests-view.mjs';

const dom = () => new JSDOM('<!doctype html><div id="r"></div>').window;
const overview = (ex) => ({ workflowId: 'wf', name: 'W', needsProject: false, ctx: {}, draftSameAs: null, columns: [{ use: 'draft', label: 'Your draft · yours' }],
  examples: [{ id: 1, name: 'Bulk invoice export', hasRequest: true, files: [], fromAt: null, note: null, tries: 3, basics: 3, checks: 2, cells: {}, project: null, ready: true, reason: null, readyText: null, ...ex }],
  running: null, latest: null, pastRuns: [] });

test('the chips: Basics, Automatic, Your criteria (only when there are some)', () => {
  const win = dom();
  const root = win.document.getElementById('r');
  renderTestsPage(root, overview({ criteria: 3 }), {}, { doc: win.document });
  assert.deepEqual([...root.querySelectorAll('.wft-kind')].map((k) => k.textContent), ['Basics 3', 'Automatic 2', 'Your criteria 3']);
  renderTestsPage(root, overview({ criteria: 0 }), {}, { doc: win.document });
  assert.deepEqual([...root.querySelectorAll('.wft-kind')].map((k) => k.textContent), ['Basics 3', 'Automatic 2']);
});
