// test/stillhet-tasks-walk-host.test.mjs — R-qa-11, the Tasks invariant "RailWould never runs in the live kind": the walk
// over the Tasks control set (the bar's Tasks list, the Tasks center and each fixture task page, with their open menus)
// never says "Not connected" or "Would" or "the task page does not offer it", and finds a disabled control only for a
// DISABLED_OK reason. Live app host (jsdom, the real live adapter and RailTaskLive).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, clone, SOURCES, walk, DISABLED_OK, CONTROLS, toastText } from './helpers/stillhet-chat-live-host.mjs';
import { TASK_DETAILS, PR_URL } from './helpers/stillhet-live-fixture.mjs';

afterEach(closeHosts);
const DETAIL = { h3: TASK_DETAILS.failed, h2: TASK_DETAILS.approved, h5: TASK_DETAILS.failing, h1: TASK_DETAILS.capped };
function sources() {
  const s = clone(SOURCES);
  for (const p of s.history.pipelines) p.projectKey = 'web-1';
  const h2 = s.history.pipelines.find((p) => p.id === 'h2'); h2.pr = { url: PR_URL, state: 'OPEN' };
  s.history.pipelines.push({ id: 'h5', title: 'Red CI', status: 'done', projectName: 'web', projectKey: 'web-1', startedAt: h2.startedAt, mtime: h2.mtime, pr: { url: PR_URL, state: 'OPEN' } });
  s.history.pipelines.find((p) => p.id === 'h1').pauseReason = 'cost_pipeline';
  return s;
}
const read = (u) => {
  const m = /^\/api\/history\/web-1\/(\w+)$/.exec(u); if (m && DETAIL[m[1]]) return [200, { state: DETAIL[m[1]].state }];
  const c = /^\/api\/pr\/checks\?id=(\w+)/.exec(u); if (c && DETAIL[c[1]]?.checks) return [200, DETAIL[c[1]].checks];
  return null;
};
const NEVER = /^Would|Not connected to Worca yet|does not offer it/;
function strays(d, disabled) {
  return disabled.filter((html) => !Object.keys(DISABLED_OK).some((sel) => { const box = d.createElement('div'); box.innerHTML = html.replace(/>.*$/s, '>') + '</button>'; return box.firstElementChild?.matches(sel); }));
}
// A missed schedule's Run now on the center ([data-c-sact]) is the Schedules slice's: by R-arch-10 it goes through the adapter
// and refuses (test/stillhet-live-counts-2.test.mjs), so this walk leaves it out. Every other control is walked as walk() does.
const OTHER_SLICE = '[data-c-sact]';
async function walkTasks(w, d, root) {
  const seen = [], disabled = [];
  const all = () => [...d.querySelectorAll(`${root} :is(${CONTROLS})`)].filter((el) => !el.matches(OTHER_SLICE));
  const n = all().length;
  for (let k = 0; k < n; k++) {
    const el = all()[k];
    if (!el) continue;
    if (el.disabled) { disabled.push(el.outerHTML.slice(0, 120)); continue; }
    if (el.matches('input, textarea')) { el.focus(); el.dispatchEvent(new w.Event('input', { bubbles: true })); continue; }
    if (el.matches('[data-dl-copy], [data-copy]')) continue;
    el.click(); await settle(5);
    seen.push(toastText(d));
    if (d.querySelector('dialog[open], .discard-modal[open]')) d.querySelector('dialog[open] [data-dialog-no], dialog[open] .btn-quiet')?.click();
  }
  return { n, seen, disabled };
}
async function check(w, d, hash, root) {
  const { n, seen, disabled } = await (root === '#route-run #card' ? walk(w, d, root) : walkTasks(w, d, root));
  assert.ok(n > 0, `${hash} ${root}: ${n} controls`);
  const said = seen.filter((t) => NEVER.test(t));
  assert.deepEqual(said, [], `${hash} ${root}: no stand-in sentence`);
  assert.deepEqual(strays(d, disabled), [], `${hash} ${root}: disabled outside DISABLED_OK`);
}

test('the walk over the bar\'s Tasks list and the Tasks center says no stand-in sentence and disables nothing outside DISABLED_OK', async () => {
  const { w, d } = await liveHost({ sources: sources(), read, write: () => [200, { ok: true, done: [], skipped: [] }] });
  for (const [hash, root] of [['#runs', '#route-runs'], ['#runs', '#bar-tasks']]) { await go(w, hash, 300); await check(w, d, hash, root); }
});

test('the walk over each fixture task page and its open menus says no stand-in sentence; no demo sentence hook is drawn on the card', async () => {
  const { w, d } = await liveHost({ sources: sources(), read, write: () => [200, { ok: true }] });
  for (const id of ['h2', 'h3', 'h5', 'h1']) {
    const hash = `#run/${id}`;
    await go(w, hash, 250);
    // the open menus too: ⋯ and the action's ▾, each opened before its walk
    for (const menu of ['', 'more', 'act']) {
      if (menu) { await go(w, '#runs', 50); await go(w, hash, 250); const b = d.querySelector(`#card [data-menu="${menu}"]`); if (!b) continue; b.click(); await settle(30); }
      await check(w, d, `${hash} ${menu || 'page'}`, '#route-run #card');
    }
    await go(w, '#runs', 50); await go(w, hash, 250);
    // crumbs go somewhere real (the Tasks list, the place); no other control carries a demo sentence
    const hooks = [...d.querySelectorAll('#route-run #card [data-say]')].filter((x) => !/^crumb:/.test(x.dataset.key || ''));
    assert.deepEqual(hooks.map((x) => x.dataset.key), [], `${hash}: no demo sentence hook`);
  }
});
