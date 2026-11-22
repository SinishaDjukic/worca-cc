// test/ui-tool-design.test.mjs — the tool panel's Design tab (ui/public/tool-design.mjs): where it opens, how it lends
// its host to the design chat's studio, and the tab the panel mounted before the studio existed (ready).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { createDesignKind, DESIGN_ONLY } from '../ui/public/tool-design.mjs';

const trackDom = useDomRelease(afterEach);
const page = () => trackDom(new JSDOM('<!doctype html><html><body><div id="h"></div></body></html>')).window.document;
const fakeStudio = () => {
  const s = { attached: [], detached: 0 };
  s.attachStage = (host) => { s.attached.push(host); host.append(host.ownerDocument.createElement('section')); return Promise.resolve(); };
  s.detachStage = () => { s.detached += 1; };
  return s;
};

test('it opens on its design chat only, with or without a project; its icon shows only there', () => {
  const doc = page();
  const studio = fakeStudio();
  const kind = createDesignKind({ doc, studioFor: (id) => (id === 'ask_1' ? studio : null) });
  assert.deepEqual([kind.strip, kind.onlyWhenAvailable, kind.folderless], [true, true, true]);
  assert.equal(kind.unavailable({ side: { type: 'chat', id: 'ask_1' } }), null);
  assert.equal(kind.unavailable({ side: { type: 'chat', id: 'ask_2' } }), DESIGN_ONLY);
  assert.equal(kind.unavailable({ side: { type: 'run', id: 'ask_1' } }), DESIGN_ONLY);
  assert.equal(kind.unavailable({ project: 'p', side: null }), DESIGN_ONLY);
});

test('mount lends the tab to the studio\'s stage; unmount takes it back', async () => {
  const doc = page();
  const studio = fakeStudio();
  const kind = createDesignKind({ doc, studioFor: () => studio });
  const host = doc.getElementById('h');
  const tab = { id: 'tab_1', kind: 'design', scope: { type: 'chat', id: 'ask_1' } };
  await kind.mount(tab, host);
  assert.deepEqual([studio.attached.length, studio.attached[0] === host], [1, true]);
  kind.unmount(tab);
  assert.equal(studio.detached, 1);
});

test('a tab mounted before its chat\'s studio waits, and ready gives it the stage (another chat\'s ready does not)', () => {
  const doc = page();
  const studio = fakeStudio();
  let current = null;
  const kind = createDesignKind({ doc, studioFor: (id) => (id === 'ask_1' ? current : null) });
  const host = doc.getElementById('h');
  const tab = { id: 'tab_1', kind: 'design', scope: { type: 'chat', id: 'ask_1' } };
  kind.mount(tab, host);
  assert.match(host.textContent, /No design here/);
  current = studio;
  kind.ready('ask_2');
  assert.equal(studio.attached.length, 0);
  kind.ready('ask_1');
  assert.deepEqual([studio.attached.length, /No design here/.test(host.textContent)], [1, false]);
  kind.ready('ask_1');
  assert.equal(studio.attached.length, 1, 'once');
  kind.mount(tab, host);
  kind.unmount(tab);
  current = null;
  kind.ready('ask_1');
  assert.equal(studio.attached.length, 2, 'an unmounted tab waits for nothing');
});
