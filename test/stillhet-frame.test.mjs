// frame.js (ui/public/stillhet/shell/frame.js) draws the sidebar and top bar from the library's frame parts. The reference is
// test/fixtures/stillhet-frame.golden.json: dev's capture after the edits shell.js used to make to it, normalised (taken
// while the capture existed, and equal to frame.js's output then). STILLHET_FRAME_GOLDEN=write rewrites it from frame.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as R from '../ui/public/design-system/components/index.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const PLACES = [['Work', [['chat', 'Chat', 'simple'], ['runs', 'Tasks', 'simple'], ['schedules', 'Schedules', 'advanced']]], ['Build', [['workflows', 'Workflows', 'simple'], ['requirements', 'Requirements', 'simple', 'requirements'], ['marketplace', 'Marketplace', 'advanced']]], ['Manage', [['projects', 'Projects', 'simple'], ['settings', 'Settings', 'simple']]], ['Insight', [['insights', 'Insights', 'advanced']]]];

function world() {
  const dom = new JSDOM('<body></body>', { runScripts: 'outside-only' });
  dom.window.RailUI = R;
  dom.window.RailHost = { stillhetOn: () => true };
  dom.window.eval(read('ui/public/stillhet/shell/frame.js'));
  return dom.window;
}
// attributes sorted, comments and whitespace between tags out
function norm(node) {
  const clone = node.cloneNode(true);
  const walk = (n) => {
    for (const c of [...n.childNodes]) {
      if (c.nodeType === 8 || (c.nodeType === 3 && !c.textContent.trim())) c.remove();
      else if (c.nodeType === 3) c.textContent = c.textContent.replace(/\s+/g, ' ').trim();
      else walk(c);
    }
    if (n.attributes) {
      const at = [...n.attributes].sort((a, b) => a.name.localeCompare(b.name));
      for (const a of [...n.attributes]) n.removeAttribute(a.name);
      for (const a of at) n.setAttribute(a.name, a.value);
    }
  };
  walk(clone);
  return clone.outerHTML;
}
const GOLDEN = new URL('./fixtures/stillhet-frame.golden.json', import.meta.url);
if (process.env.STILLHET_FRAME_GOLDEN === 'write') {
  const w = world();
  writeFileSync(GOLDEN, JSON.stringify({ sidebar: norm(w.RailFrame.sidebar(PLACES)), topBar: norm(w.RailFrame.topBar()) }, null, 1) + '\n');
}
const golden = () => JSON.parse(readFileSync(GOLDEN, 'utf8'));

test('the sidebar frame.js draws equals the golden taken from the capture (landmarks, aria, ids)', () => {
  const w = world();
  assert.equal(norm(w.RailFrame.sidebar(PLACES)), golden().sidebar);
});

test('the top bar frame.js draws equals the golden taken from the capture (aria, the switch role)', () => {
  const w = world();
  const bar = w.RailFrame.topBar();
  assert.equal(norm(bar), golden().topBar);
  assert.equal(bar.querySelector('[data-design-switch]').getAttribute('role'), 'switch');
  assert.equal(bar.querySelector('#side-toggle').getAttribute('aria-expanded'), 'true');
});

test('shell.js no longer reads window.Today and the capture is gone', () => {
  assert.doesNotMatch(read('ui/public/stillhet/shell/shell.js'), /window\.Today|T\.pages|T\.sidebar|T\.topBar/);
  assert.ok(existsSync(new URL('../ui/public/stillhet/shell/frame.js', import.meta.url)));
});
