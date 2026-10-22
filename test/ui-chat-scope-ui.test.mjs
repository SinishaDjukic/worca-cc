// test/ui-chat-scope-ui.test.mjs — Projects, any way P4b: the chat scope's icons, scope reading, and P1b's one kind chip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { NO_PROJECT_LABEL, scopeFromContext, scopeKind, scopeIcon, kindChip, projectKind } from '../ui/public/chat/scope-ui.mjs';
import * as runKind from '../ui/public/run-kind.mjs';
import { checkRows } from './helpers/rows.mjs';

const doc = new JSDOM('<!doctype html><html><body></body></html>').window.document;
const NONE = { pinned: false, projectKey: null, workspaceId: null };

test('one kind chip (SEAMS S11): scope-ui re-exports P1b\'s kindChip and projectKind, never a copy', () => {
  assert.equal(kindChip, runKind.kindChip);
  assert.equal(projectKind, runKind.projectKind);
  assert.equal(NO_PROJECT_LABEL, runKind.KIND_LABELS.none);
  assert.equal(NO_PROJECT_LABEL, 'No project');
});

test('scopeFromContext: a pin with its one key is that scope; anything else is No project', async () => {
  await checkRows([
    { name: 'project pin', run: () => assert.deepEqual(scopeFromContext({ pinned: true, projectKey: 'demo-00000001', view: 'chat' }), { pinned: true, projectKey: 'demo-00000001', workspaceId: null }) },
    { name: 'workspace pin', run: () => assert.deepEqual(scopeFromContext({ pinned: true, workspaceId: 'wks-team-0000abcd' }), { pinned: true, projectKey: null, workspaceId: 'wks-team-0000abcd' }) },
    { name: 'old Auto (pinned:false with a page target)', run: () => assert.deepEqual(scopeFromContext({ pinned: false, projectDir: '/p', projectKey: 'demo-00000001' }), NONE) },
    { name: 'a pin without a key', run: () => assert.deepEqual(scopeFromContext({ pinned: true, projectKey: '' }), NONE) },
    { name: 'a stored context without pinned names its scope by key (S41)', run: () => assert.deepEqual(scopeFromContext({ projectKey: 'demo-00000001', view: 'new' }), { pinned: true, projectKey: 'demo-00000001', workspaceId: null }) },
    { name: 'not an object', run: () => { for (const c of [null, undefined, 'x', 3, []]) assert.deepEqual(scopeFromContext(c), NONE, String(c)); } },
    { name: 'scopeKind', run: () => assert.deepEqual([NONE, { pinned: true, projectKey: 'demo-00000001' }, { pinned: true, workspaceId: 'wks-team-0000abcd' }, null].map(scopeKind), ['none', 'project', 'workspace', 'none']) },
  ]);
});

test('scopeIcon: a decorative stroke icon per kind — dashed circle, folder, grid, folder-plus', async () => {
  const shape = (svg) => [...svg.children].map((n) => `${n.tagName}:${n.getAttribute('d') || n.getAttribute('stroke-dasharray') || n.getAttribute('x')}`);
  await checkRows([
    { name: 'the svg itself', run: () => {
      const s = scopeIcon(doc, 'project', 13);
      assert.deepEqual(['width', 'height', 'viewBox', 'fill', 'stroke', 'aria-hidden', 'focusable'].map((a) => s.getAttribute(a)), ['13', '13', '0 0 24 24', 'none', 'currentColor', 'true', 'false']);
    } },
    { name: 'none', run: () => assert.deepEqual(shape(scopeIcon(doc, 'none')), ['circle:3 3']) },
    { name: 'project', run: () => assert.deepEqual(shape(scopeIcon(doc, 'project')), ['path:M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z']) },
    { name: 'workspace', run: () => assert.deepEqual(shape(scopeIcon(doc, 'workspace')), ['rect:3', 'rect:14', 'rect:3', 'path:M17.5 14v7M14 17.5h7']) },
    { name: 'add', run: () => assert.deepEqual(shape(scopeIcon(doc, 'add')), ['path:M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z', 'path:M12 11v6M9 14h6']) },
    { name: 'unknown → none', run: () => assert.deepEqual(shape(scopeIcon(doc, 'bogus')), ['circle:3 3']) },
  ]);
});
