// test/workspace-map-css.test.mjs — the Map tab's stylesheet contract (spec D17): every edge kind
// has a colour family token, the graph scrolls inside its card, hidden message lines stay hidden
// (.hint is display:block), and the tab's rules use theme tokens only (both themes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { KINDS } from '../src/shared/workspace-map/schema.mjs';

const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (sel) => {
  const i = css.indexOf(`${sel}{`);
  return i === -1 ? null : css.slice(i + sel.length + 1, css.indexOf('}', i));
};

test('every edge kind maps to a colour family token', () => {
  for (const k of KINDS) assert.match(rule(`.wm-k-${k}`) || '', /^--wm-k:var\(--[a-z]+\);$/, k);
  assert.equal(rule('.wm-line'), 'fill:none;stroke:var(--wm-k);stroke-width:1.8;pointer-events:none;');
  assert.equal(rule('.wm-arrow'), 'fill:var(--wm-k);');
});

test('the graph scrolls inside its card; hidden lines stay hidden; dashed, confirmed and rejected read apart', () => {
  assert.match(rule('.wm-graph-scroll') || '', /overflow-x:auto;/);
  assert.equal(rule('.wm-add-msg[hidden]'), 'display:none;');
  assert.match(rule('.wm-pair.is-dashed .wm-line') || '', /stroke-dasharray:/);
  assert.match(rule('.wm-pair.is-confirmed .wm-line') || '', /stroke-width:3\.2;/);
  assert.equal(rule('.wm-row.is-rejected td'), 'color:var(--ink-3);');
  // A missing row dashes its BOTTOM border (collapsed borders: a dashed top loses to the solid bottom
  // of the row above), on the last row too — checked in jsdom's cascade, which resolves specificity.
  const win = new JSDOM(`<!doctype html><style>${css}</style><table class="wm-table"><tbody><tr class="wm-row is-missing"><td id="inner">m</td></tr>`
    + '<tr class="wm-row is-auto"><td>a</td></tr></tbody></table><table class="wm-table"><tbody><tr class="wm-row is-auto"><td>a</td></tr>'
    + '<tr class="wm-row is-missing"><td id="last">m</td></tr></tbody></table>').window;
  for (const id of ['inner', 'last']) {
    const td = win.getComputedStyle(win.document.getElementById(id));
    assert.deepEqual([td.borderBottomStyle, td.borderBottomWidth, td.fontStyle], ['dashed', '1px', 'italic'], id);
  }
});
