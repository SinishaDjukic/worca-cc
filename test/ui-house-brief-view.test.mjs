// test/ui-house-brief-view.test.mjs — Settings → Project → House brief card: one primary-free action row with
// 'Refresh now' as secondary; corners only --r-xs/--r-sm; pins PUT; refresh POSTs; empty and error states.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { mountHouseBrief } from '../ui/public/house-brief-view.mjs';

const tick = () => new Promise((r) => setTimeout(r, 0));
const VIEW = {
  brief: '# House brief\n\n## Memory\n- a — b\n', words: 9, budget: 2000, builtAt: '2026-10-18T12:02:00.000Z',
  trimmed: { lines: 214, bySection: { endpoints: 214 } }, pinned: ['Keep 4px corners.'], rebuilt: false,
  sources: [{ kind: 'memory', label: 'Memory', files: 50, readAt: '2026-10-18T12:02:00.000Z' }],
};
function harness(routes = {}) {
  const { window } = new JSDOM('<!doctype html><div id="host"></div>');
  const calls = [];
  const fetchFn = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    calls.push({ url: String(url), method, body: opts.body ? JSON.parse(opts.body) : null });
    const r = (routes[`${method} ${url}`] || (() => ({ status: 200, body: VIEW })))(opts);
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  const host = window.document.getElementById('host');
  mountHouseBrief(host, { projectKey: 'proj-1', fetchFn });
  return { window, host, calls };
}
const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };
const BASE = '/api/projects/proj-1/house-brief';

test('one primary-free action row with Refresh now as secondary', async () => {
  const { host } = harness();
  await settle();
  const rows = host.querySelectorAll('.hb-actions');
  assert.equal(rows.length, 1);
  const buttons = rows[0].querySelectorAll('button');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].textContent, 'Refresh now');
  assert.ok(buttons[0].classList.contains('btn'));
  assert.equal(host.querySelectorAll('.btn-primary').length, 0);
});

test('built state: summary, sources with read time, brief, pins', async () => {
  const { host } = harness();
  await settle();
  assert.match(host.querySelector('.hb-summary').textContent, /^9 of 2,000 words · built .+ · 214 index lines trimmed$/);
  assert.match(host.querySelector('.hb-source').textContent, /^Memory50 files · read .+/);
  assert.equal(host.querySelector('.hb-text').hidden, false);
  assert.equal(host.querySelector('.hb-pin-text').textContent, 'Keep 4px corners.');
});

test('no sources: the empty line shows and the brief is hidden', async () => {
  const { host } = harness({ [`GET ${BASE}`]: () => ({ status: 200, body: { ...VIEW, brief: '', words: 0, sources: [], pinned: [] } }) });
  await settle();
  assert.equal(host.querySelector('.hb-summary').textContent, 'No sources yet. Add a CLAUDE.md, project memory or a spec in plans/, then refresh.');
  assert.equal(host.querySelector('.hb-text').hidden, true);
  assert.equal(host.querySelectorAll('.hb-actions').length, 1);
});

test('no sources but pins: still the empty line, the pins list and the action row', async () => {
  const { host } = harness({ [`GET ${BASE}`]: () => ({ status: 200, body: { ...VIEW, brief: '# House brief\n\n## Pinned\n- Keep 4px corners.\n', words: 7, sources: [] } }) });
  await settle();
  assert.match(host.querySelector('.hb-summary').textContent, /^No sources yet\./);
  assert.equal(host.querySelector('.hb-text').hidden, true);
  assert.equal(host.querySelector('.hb-pin-text').textContent, 'Keep 4px corners.');
  assert.equal(host.querySelectorAll('.hb-actions').length, 1);
});

test('Pin line PUTs the whole list; Remove PUTs it without the line', async () => {
  const { host, calls } = harness();
  await settle();
  host.querySelector('.hb-pin-input').value = 'No new engine state.';
  host.querySelector('.hb-pin-add').click();
  await settle();
  assert.deepEqual(calls.at(-1), { url: `${BASE}/pinned`, method: 'PUT', body: { pinned: ['Keep 4px corners.', 'No new engine state.'] } });
  host.querySelector('.hb-pin-remove').click();
  await settle();
  assert.deepEqual(calls.at(-1).body, { pinned: [] });
});

test('a 400 on pins shows a card alert; Refresh now POSTs and toasts', async () => {
  const { host, window, calls } = harness({ [`PUT ${BASE}/pinned`]: () => ({ status: 400, body: { error: 'a pinned line is longer than 240 characters' } }) });
  await settle();
  host.querySelector('.hb-pin-input').value = 'x';
  host.querySelector('.hb-pin-add').click();
  await settle();
  assert.match(host.querySelector('.card-alert').textContent, /Pinned lines not saved.*240 characters/s);
  host.querySelector('.hb-refresh').click();
  await settle();
  assert.equal(calls.at(-1).method, 'POST');
  assert.equal(calls.at(-1).url, `${BASE}/refresh`);
  assert.match(window.document.querySelector('.toast.ok .tt').textContent, /Brief refreshed/);
});

test('a read failure shows a card alert', async () => {
  const { host } = harness({ [`GET ${BASE}`]: () => ({ status: 500, body: { error: 'boom' } }) });
  await settle();
  assert.match(host.querySelector('.card-alert').textContent, /House brief could not be read.*boom/s);
});

test('CSS: no radius outside --r-xs/--r-sm/--r-card, tokens defined, dividers 1px, colours only tokens', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // D11: defined once, in :root, with the UI/UX review's values (decided 2026-10-19: xs 4px, sm 6px).
  assert.equal((css.match(/--r-xs:\s*4px;/g) || []).length, 1);
  assert.equal((css.match(/--r-sm:\s*6px;/g) || []).length, 1);
  assert.match(/(?:^|\})\s*:root\s*\{([^{}]*)\}/m.exec(css)?.[1] || '', /--r-xs:\s*4px;[\s\S]*--r-sm:\s*6px;|--r-sm:\s*6px;[\s\S]*--r-xs:\s*4px;/);
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /house-brief/.test(m[1]));
  assert.ok(rules.length >= 8);
  for (const [, sel, body] of rules) {
    for (const r of body.matchAll(/border-radius\s*:\s*([^;]+)/g)) assert.match(r[1].trim(), /^var\(--r-(xs|sm|card)\)$/, sel.trim());
    assert.doesNotMatch(body, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, sel.trim());
    for (const b of body.matchAll(/border(?:-top|-bottom)?\s*:\s*([^;]+)/g)) assert.match(b[1], /^1px solid var\(--line(-2)?\)$/, sel.trim());
  }
  const radiusOf = (selector) => rules.find(([, sel, body]) => sel.trim() === selector && /border-radius/.test(body));
  for (const s of ['.card.house-brief', '.house-brief .btn', '.house-brief .hb-text', '.house-brief .hb-pin-input']) assert.ok(radiusOf(s), s);
});
