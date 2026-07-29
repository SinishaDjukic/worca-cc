// test/plugin-provenance-ui.test.mjs — provenance helpers (spec §7.5/§9.3/§11):
// source badge from pipelines.source_ref, manual write-back retry control,
// workflow-picker labels for plugin-origin workflows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { sourceBadge, reportResultControl, workflowPickerLabel } from '../ui/public/results-view.mjs';

const win = new JSDOM('<!doctype html><body></body>').window;
const doc = win.document;

test('sourceBadge renders plugin/task info with a link; null for prompt/markdown rows', () => {
  const row = {
    source_type: 'plugin',
    source_ref: JSON.stringify({ plugin: 'github-source', sourceId: 'github', taskId: 'acme/api#123', url: 'https://github.com/acme/api/issues/123', title: 'Fix login' }),
  };
  const el = sourceBadge(row, { doc });
  assert.ok(el.classList.contains('src-badge'));
  assert.match(el.textContent, /github-source/);
  assert.match(el.textContent, /acme\/api#123/);
  assert.equal(el.querySelector('a').href, 'https://github.com/acme/api/issues/123');
  assert.equal(sourceBadge({ source_type: 'prompt', source_ref: null }, { doc }), null);
  assert.equal(sourceBadge({ source_type: 'plugin', source_ref: '{broken' }, { doc }), null, 'corrupt ref renders nothing, never throws');
});

test('reportResultControl posts to the retry endpoint and renders the outcome', async () => {
  const posts = [];
  const post = async (url) => { posts.push(url); return { ok: true }; };
  const el = reportResultControl('pipe-1', { doc, post });
  const btn = el.querySelector('button.src-report');
  btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await el._pending;                        // promise kept for deterministic tests
  assert.deepEqual(posts, ['/api/pipelines/pipe-1/report-result']);
  assert.match(el.querySelector('.src-report-status').textContent, /reported/i);

  const failing = reportResultControl('pipe-2', { doc, post: async () => ({ ok: false, error: 'rate limited' }) });
  failing.querySelector('button.src-report').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await failing._pending;
  assert.match(failing.querySelector('.src-report-status').textContent, /rate limited/);
});

test('workflowPickerLabel suffixes plugin origin and flags disabled plugins', () => {
  assert.equal(workflowPickerLabel({ name: 'My Flow', origin: null }, ['gh']), 'My Flow');
  assert.equal(workflowPickerLabel({ name: 'Triage', origin: 'plugin:gh' }, ['gh']), 'Triage [plugin: gh]');
  assert.equal(workflowPickerLabel({ name: 'Triage', origin: 'plugin:gh' }, []), 'Triage [plugin: gh — disabled]');
});
