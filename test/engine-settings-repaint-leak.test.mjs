// test/engine-settings-repaint-leak.test.mjs — Settings repaints the Engines and Ask Worca cards on every entry and
// every settings-changed broadcast. Their hosts outlive the repaints, so the status listeners must be bound once: a
// listener per paint kept every earlier build of the card alive (perf audit §6.1) and ran the count N times.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { renderEngineSection, renderAskEngineSection } from '../ui/public/engine-settings-view.mjs';

const trackDom = useDomRelease(afterEach);
const CATALOG = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', engine: 'claude', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'gpt-5.5', label: 'GPT-5.5', engine: 'codex', efforts: ['minimal', 'low', 'medium', 'high'] },
];
/** The host's own addEventListener calls (not its children's). */
const countListeners = (host) => { let n = 0; const add = host.addEventListener.bind(host); host.addEventListener = (...a) => { n += 1; return add(...a); }; return () => n; };

for (const [name, render] of [
  ['Engines', (host, status) => renderEngineSection(host, { level: 'user', catalog: CATALOG, roles: [], fields: {}, status })],
  ['Ask Worca', (host, status) => renderAskEngineSection(host, { catalog: CATALOG, status })],
]) {
  test(`${name} card: five repaints bind the host once, and the unsaved count still follows the latest build`, () => {
    const dom = trackDom(new JSDOM('<div id="h"></div><p id="s"></p>'));
    const doc = dom.window.document;
    const host = doc.getElementById('h'); const status = doc.getElementById('s');
    const added = countListeners(host);
    render(host, status);
    const once = added();
    assert.ok(once > 0);
    for (let i = 0; i < 4; i++) render(host, status);
    assert.equal(added(), once, 'no new host listeners on a repaint');
    const field = host.querySelector('.inherit-field');
    field.dataset.dirty = '1';
    host.dispatchEvent(new dom.window.Event('change'));
    assert.equal(status.textContent, '1 unsaved change');
  });
}
