import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { LOG_VIEW_KEY, readLogView, writeLogView, logMsgText, paintLogMsg, applyLogView, syncLogViewSeg } from '../ui/public/log-view.mjs';

const mem = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
const REC = { text: '→ Bash node --test test/naming.test.mjs', desc: 'Run the naming tests' };

test('readLogView: default summary; stored raw; stale or throwing storage falls back', () => {
  assert.equal(LOG_VIEW_KEY, 'worca-cc.logs.view');
  assert.equal(readLogView(mem()), 'summary');
  assert.equal(readLogView(mem({ [LOG_VIEW_KEY]: 'raw' })), 'raw');
  assert.equal(readLogView(mem({ [LOG_VIEW_KEY]: 'bogus' })), 'summary');
  assert.equal(readLogView({ getItem() { throw new Error('SecurityError'); } }), 'summary');
  assert.equal(readLogView(null), 'summary');
});

test('writeLogView stores only a known view and never throws', () => {
  const s = mem();
  writeLogView(s, 'raw');
  assert.equal(s.m.get(LOG_VIEW_KEY), 'raw');
  writeLogView(s, 'nope');
  assert.equal(s.m.get(LOG_VIEW_KEY), 'raw');
  assert.doesNotThrow(() => writeLogView({ setItem() { throw new Error('quota'); } }, 'summary'));
});

test('logMsgText: summary shows the description; raw and desc-less records show text', () => {
  assert.equal(logMsgText(REC, 'summary'), '→ Run the naming tests');
  assert.equal(logMsgText(REC, 'raw'), '→ Bash node --test test/naming.test.mjs');
  assert.equal(logMsgText({ text: "→ Bash /bin/zsh -lc 'ls'" }, 'summary'), "→ Bash /bin/zsh -lc 'ls'");
  assert.equal(logMsgText({ text: 42 }, 'summary'), '42');
});

test('paintLogMsg + applyLogView swap the same node in place; title only in summary', () => {
  const { document } = new JSDOM('<div class="log"></div>').window;
  const m = document.createElement('span');
  m.className = 'log-msg';
  document.querySelector('.log').appendChild(m);
  paintLogMsg(m, REC, 'summary');
  assert.equal(m.textContent, '→ Run the naming tests');
  assert.equal(m.title, REC.text);
  applyLogView(document, 'raw');
  assert.equal(document.querySelector('.log-msg'), m, 'same node');
  assert.equal(m.textContent, REC.text);
  assert.equal(m.hasAttribute('title'), false);
  applyLogView(document, 'summary');
  assert.equal(m.textContent, '→ Run the naming tests');
  // a desc-less line is never stamped, so applyLogView leaves it alone
  const plain = document.createElement('span');
  plain.className = 'log-msg';
  paintLogMsg(plain, { text: '→ Read a.js' }, 'summary');
  assert.equal(plain.hasAttribute('data-desc'), false);
  assert.equal(plain.textContent, '→ Read a.js');
});

test('syncLogViewSeg presses exactly the chosen button; applyLogView syncs every switch', () => {
  const { document } = new JSDOM(
    '<span class="seg log-view-seg"><button data-log-view="summary"></button><button data-log-view="raw"></button></span>' +
    '<span class="seg log-view-seg"><button data-log-view="summary"></button><button data-log-view="raw"></button></span>').window;
  applyLogView(document, 'raw');
  for (const seg of document.querySelectorAll('.log-view-seg')) {
    assert.deepEqual([...seg.querySelectorAll('button')].map((b) => b.getAttribute('aria-pressed')), ['false', 'true']);
    assert.ok(seg.querySelector('[data-log-view="raw"]').classList.contains('on'));
  }
  syncLogViewSeg(document.querySelector('.log-view-seg'), 'summary');
  assert.equal(document.querySelector('[data-log-view="summary"]').getAttribute('aria-pressed'), 'true');
});
