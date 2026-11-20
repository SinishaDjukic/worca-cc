// test/requirements-attach-sent-card.test.mjs — the sent `feature` block card and its in-place read-only expand, in jsdom.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/#/chat' });
const { window } = dom;
after(() => window.close());
const { renderSentFeatureCard } = await import('../ui/public/requirements-attach/sent-card.mjs');

const block = (over = {}) => ({
  kind: 'feature', seq: 4, id: 'FEAT-4', title: 'Cancel order', version: 2, criteriaCount: 3, ready: true,
  markdown: '# Cancel order\n\n- a', ...over,
});
const md = (text, mount) => { mount.textContent = `MD:${text}`; };
const tick = () => new Promise((r) => setTimeout(r, 0));
const mk = (over = {}, deps = {}) => {
  const calls = [];
  const fetchJson = async (url, init) => { calls.push({ url, init }); return { items: [{ seq: 4, status: 'ok' }] }; };
  const card = renderSentFeatureCard(window.document, block(over), { fetchJson, flagOn: () => true, renderMarkdown: md, ...deps });
  window.document.body.replaceChildren(card);
  return { card, calls };
};
const open = async (card) => { card.querySelector('button').click(); await tick(); await tick(); };
const panel = (card) => card.querySelector('.sent-feature-panel');

test('the card shows title, ID and criteria count; no panel until clicked', () => {
  const { card } = mk();
  assert.match(card.textContent, /Cancel order/);
  assert.match(card.textContent, /FEAT-4/);
  assert.match(card.textContent, /3 criteria/);
  assert.equal(panel(card)?.hidden ?? true, true);
});

test('singular criterion and null count', () => {
  assert.match(mk({ criteriaCount: 1 }).card.textContent, /1 criterion\b/);
  assert.doesNotMatch(mk({ criteriaCount: null }).card.textContent, /criteri/);
});

test('click expands the frozen snapshot in place and toggles closed; no navigation', async () => {
  const { card } = mk();
  const before = window.location.href;
  const btn = card.querySelector('button');
  await open(card);
  assert.equal(panel(card).hidden, false);
  assert.equal(panel(card).textContent.includes('MD:# Cancel order'), true);
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.equal(window.location.href, before);
  assert.equal(window.document.body.children.length, 1);
  btn.click();
  assert.equal(panel(card).hidden, true);
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
});

test('first open resolves once; archived and missing add the note, ok does not', async () => {
  for (const [status, noted] of [['archived', true], ['missing', true], ['ok', false], ['not_ready', false]]) {
    const calls = [];
    const fetchJson = async (url, init) => { calls.push({ url, init }); return { items: [{ seq: 4, status }] }; };
    const { card } = mk({}, { fetchJson });
    await open(card);
    card.querySelector('button').click();
    await open(card);
    assert.equal(calls.length, 1, status);
    assert.equal(calls[0].url, '/api/requirements/attach/resolve');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].init.body), { seqs: [4] });
    assert.equal(panel(card).textContent.includes('This feature is no longer available.'), noted, status);
    assert.equal(panel(card).textContent.includes('MD:# Cancel order'), true, status);
  }
});

test('accepts the {ok,data} response shape', async () => {
  const fetchJson = async () => ({ ok: true, status: 200, data: { items: [{ seq: 4, status: 'archived' }] } });
  const { card } = mk({}, { fetchJson });
  await open(card);
  assert.match(panel(card).textContent, /no longer available/);
});

test('a failed or malformed resolve keeps the snapshot with no note', async () => {
  for (const fetchJson of [async () => { throw new Error('down'); }, async () => ({ ok: false, status: 500, data: {} }), async () => null, async () => ({ items: 'x' })]) {
    const { card } = mk({}, { fetchJson });
    await open(card);
    assert.equal(panel(card).textContent.includes('MD:# Cancel order'), true);
    assert.doesNotMatch(panel(card).textContent, /no longer available/);
  }
});

test('flag off: no request, snapshot only', async () => {
  const { card, calls } = mk({}, { flagOn: () => false });
  await open(card);
  assert.equal(calls.length, 0);
  assert.equal(panel(card).textContent.includes('MD:# Cancel order'), true);
});

test('the snapshot is never replaced by server data and the block is not mutated', async () => {
  const b = Object.freeze(block());
  const fetchJson = async () => ({ items: [{ seq: 4, status: 'ok', title: 'Renamed', markdown: 'SERVER' }] });
  const card = renderSentFeatureCard(window.document, b, { fetchJson, flagOn: () => true, renderMarkdown: md });
  window.document.body.replaceChildren(card);
  await open(card);
  assert.doesNotMatch(card.textContent, /SERVER|Renamed/);
  assert.equal(b.markdown, '# Cancel order\n\n- a');
});

test('a throwing or async markdown renderer degrades to plain text', async () => {
  const bad = mk({}, { renderMarkdown: () => { throw new Error('x'); } });
  await open(bad.card);
  assert.equal(panel(bad.card).textContent.includes('# Cancel order'), true);
  const later = mk({}, { renderMarkdown: async (t, m) => { m.textContent = `ASYNC:${t}`; } });
  await open(later.card);
  assert.equal(panel(later.card).textContent.includes('ASYNC:# Cancel order'), true);
});
