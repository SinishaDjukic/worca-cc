// test/ui-chat-run-controls-history-load.test.mjs — the test of test/ui-chat-run-controls.test.mjs that needs the app's
// FIRST History load still in flight: a finished run's Chat card offers Create pull request once that load names a PR
// host. The first hello starts that load once per app, so this test lives in its own file, whose one shared app
// (test/helpers/shared-app-boot.mjs) answers it only when the test releases it.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { runPageOn } from './helpers/run-page-boot.mjs';
import { chatCardBuilder } from '../ui/public/chat/extensions.mjs';
import { useSharedApp } from './helpers/shared-app-boot.mjs';

let release;
const gate = new Promise((r) => { release = r; });
const app = useSharedApp({ before, beforeEach, after }, {
  fetchHandler: (url) => {
    if (url === '/api/history') return gate.then(() => ({ ok: true, status: 200, json: async () => ({ pipelines: [], live: [], ghAvailable: true }) }));
    if (url === '/api/ask/runs/beef00aa') return Promise.resolve({ ok: true, status: 200, json: async () => ({ state: { id: 'beef00aa', title: 'Done run', projectDir: '/tmp/p', projectKey: 'proj-00000001', status: 'done' }, live: null,
      extras: { results: { filesChanged: 1, additions: 2, deletions: 0, checks: 0, topFiles: [] }, artifacts: [], moreArtifacts: false, pr: null } }) });
    return null;
  },
});
const bootApp = runPageOn(app);

test('a finished run card painted before the first History load offers Create pull request once that load names a PR host', async () => {
  const ctx = await bootApp();
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: [] });   // the first connect loads History in the background (cold cache here)
  await ctx.settle();
  const doc = ctx.window.document;
  const built = chatCardBuilder('progress')({ kind: 'card', id: 'card_000000aa', state: 'tracked', card: { type: 'progress', pipelineId: 'beef00aa', runId: 'beef00aa', projectKey: 'proj-00000001', title: 'Done run' } },
    { doc, win: ctx.window, fetch: (...a) => ctx.window.fetch(...a), openRunPanel: () => {}, openArtifact: () => {}, announce: () => {} });
  doc.body.appendChild(built.el);
  await ctx.settle(6);
  assert.equal(built.el.querySelector('.chat-rc-res-title').textContent, 'Clean: no blocking issues flagged');
  assert.equal(built.el.querySelector('.chat-rc-create-pr'), null, 'no PR host known yet');
  release();
  await ctx.settle(10);
  assert.ok(built.el.querySelector('.chat-rc-create-pr'), 'the History load named a PR host: no frame needed');
  built.dispose();
});
