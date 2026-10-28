// test/ui-chat-home-presets.test.mjs — Chat home preset chips (ui/public/chat/home-presets.mjs, home.mjs): the scoped
// list (this target's pinned presets, then Any project, at most 6), the More chip, and a click → usePreset.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { homePresets, createHomePresets, HOME_PRESETS_MAX } from '../ui/public/chat/home-presets.mjs';
import { createChatHome } from '../ui/public/chat/home.mjs';

const trackDom = useDomRelease(afterEach);

const P = (id, kind = 'global', ref = null) => ({ id, name: `Preset ${id}`, scope: { kind, ref }, setup: {} });

test('homePresets: pinned to this target first, then Any project; another target\'s presets are left out', () => {
  const list = [P('g1'), P('a', 'project', 'api-1'), P('b', 'project', 'web-2'), P('w', 'workspace', 'wks-x'), P('g2')];
  assert.deepEqual(homePresets(list, { kind: 'project', ref: 'api-1' }).shown.map((p) => p.id), ['a', 'g1', 'g2']);
  assert.deepEqual(homePresets(list, null).shown.map((p) => p.id), ['g1', 'g2']);
  assert.deepEqual(homePresets(null, null), { shown: [], more: 0 });
});

test('at most 6 chips; the rest is counted for the More chip', () => {
  const list = Array.from({ length: 9 }, (_, i) => P(`g${i}`));
  const r = homePresets(list, null);
  assert.equal(HOME_PRESETS_MAX, 6);
  assert.equal(r.shown.length, 6);
  assert.equal(r.more, 3);
});

test('the section: hidden with 0 matches; chips call onUse with the id; More calls onMore; names are text', () => {
  const { document } = trackDom(new JSDOM('')).window;
  const used = [];
  let more = 0;
  const ui = createHomePresets({ doc: document, onUse: (id) => used.push(id), onMore: () => { more += 1; } });
  ui.render({ presets: [], target: null });
  assert.equal(ui.el.hidden, true);
  const evil = { ...P('x'), name: '<img src=x onerror=alert(1)>' };
  ui.render({ presets: [evil, ...Array.from({ length: 7 }, (_, i) => P(`g${i}`))], target: null });
  assert.equal(ui.el.hidden, false);
  const chips = ui.el.querySelectorAll('.chat-home-preset');
  assert.equal(chips.length, 6);
  assert.equal(ui.el.querySelectorAll('img').length, 0);
  assert.equal(chips[0].textContent, '<img src=x onerror=alert(1)>');
  chips[1].click();
  assert.deepEqual(used, ['g0']);
  ui.el.querySelector('.chat-home-preset-more').click();
  assert.equal(more, 1);
  assert.equal(ui.el.querySelector('.chat-home-preset-more').textContent, '2 more…');
});

const SHELL = `<!doctype html><html><body><section class="view" data-view="chat"><div class="chat-page" data-chat-page data-view="home">
  <div class="chat-convo"><div class="chat-home" data-chat-home><div class="chat-hero-slot" data-chat-hero-slot>
    <div class="ask-composer"><div class="ask-composer-box"><textarea class="ask-input"></textarea></div></div>
  </div></div></div></div></section></body></html>`;

test('createChatHome: a visit lists the presets and a chip click calls deps.usePreset', async () => {
  const { window } = trackDom(new JSDOM(SHELL, { url: 'http://localhost:4317/' }));
  const doc = window.document;
  const used = [];
  const deps = {
    runs: () => ({ needs: [], running: [], finished: [], project: null }),
    threads: async () => [],
    workflows: async () => ({ list: [], portsFn: null }),
    flags: async () => ({ scripts: true, tasks: false }),
    presets: async () => ({ presets: [P('g1')], target: null }),
    usePreset: (id) => used.push(id),
    threadForRun: async () => null, openThread: () => {}, openRunPanel: () => {}, setIntent: () => {}, prefill: () => {},
    navigate: () => {}, level: () => 'expert',
  };
  const home = createChatHome({ doc, host: doc.querySelector('[data-chat-home]'), heroSlot: doc.querySelector('[data-chat-hero-slot]'), deps });
  for (let i = 0; i < 6; i++) await new Promise((r) => window.setTimeout(r, 0));
  const chips = doc.querySelectorAll('.chat-home-preset');
  assert.equal(chips.length, 1);
  chips[0].click();
  assert.deepEqual(used, ['g1']);
  home.destroy();
});

test('a chip\'s tooltip is the scope, the workflow name and the engine label, never their ids', () => {
  const { document } = trackDom(new JSDOM('')).window;
  const ui = createHomePresets({ doc: document, onUse: () => {}, onMore: () => {} });
  const p = (id, setup, kind = 'global', ref = null) => ({ id, name: id, scope: { kind, ref }, setup });
  ui.render({ target: { kind: 'project', ref: 'api-1' }, workflowNames: { wf_default: 'Default' }, presets: [
    p('a', { workflowId: 'wf_auto', engine: 'codex' }, 'project', 'api-1'), p('b', { workflowId: 'wf_gone99' })] });
  assert.deepEqual([...ui.el.querySelectorAll('.chat-home-preset')].map((b) => b.title),
    ['Only this project · Auto workflow · Codex', 'Any project · Workflow removed · Claude']);
});

for (const [level, want] of [['simple', '#new'], ['advanced', '#settings/presets'], ['expert', '#settings/presets']]) {
  test(`createChatHome at ${level}: "N more…" navigates to ${want}`, async () => {
    const { window } = trackDom(new JSDOM(SHELL, { url: 'http://localhost:4317/' }));
    const doc = window.document;
    const went = [];
    const deps = {
      runs: () => ({ needs: [], running: [], finished: [], project: null }), threads: async () => [],
      workflows: async () => ({ list: [], portsFn: null }), flags: async () => ({ scripts: true, tasks: false }),
      presets: async () => ({ presets: Array.from({ length: 7 }, (_, i) => P(`g${i}`)), target: null, workflowNames: {} }),
      usePreset: () => {}, threadForRun: async () => null, openThread: () => {}, openRunPanel: () => {}, setIntent: () => {}, prefill: () => {},
      navigate: (h) => went.push(h), level: () => level,
    };
    const home = createChatHome({ doc, host: doc.querySelector('[data-chat-home]'), heroSlot: doc.querySelector('[data-chat-hero-slot]'), deps });
    for (let i = 0; i < 6; i++) await new Promise((r) => window.setTimeout(r, 0));
    doc.querySelector('.chat-home-preset-more').click();
    assert.deepEqual(went.filter((h) => h === want), [want]);
    home.destroy();
  });
}
