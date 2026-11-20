// test/requirements-attach-hash.test.mjs
import { after, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  findHashToken,
  stripToken,
} from '../ui/public/requirements-attach/hash-token.mjs';

describe('hash-token', () => {
  const cases = [
    ['see #7, caret at end', 'see #7', 6, { start: 4, end: 6, query: '7' }],
    ['bare # at index 0', '#', 1, { start: 0, end: 1, query: '' }],
    ['# at index 0 with query', '#abc', 4, { start: 0, end: 4, query: 'abc' }],
    ['caret mid-token cuts the query', 'x #abcd', 5, { start: 2, end: 5, query: 'ab' }],
    ['# after newline', 'a\n#fix', 6, { start: 2, end: 6, query: 'fix' }],
    ['heading "# Head" is not a token', '# Head', 6, null],
    ['space typed after #', 'see # ', 6, null],
    ['no whitespace before #', 'a#b', 3, null],
    ['caret before the #', 'see #7', 3, null],
    ['caret after whitespace following query', 'see #7 ', 7, null],
    ['no # at all', 'hello world', 5, null],
    ['empty text', '', 0, null],
    ['non-string text', null, 0, null],
    ['caret out of range', 'see #7', 99, null],
  ];
  for (const [name, text, caret, expected] of cases) {
    test(`findHashToken: ${name}`, () => {
      assert.deepEqual(findHashToken(text, caret), expected);
    });
  }

  test('hash-token stripToken removes only # + query and keeps surrounding text', () => {
    const text = 'fix #12 now';
    const tok = findHashToken(text, 7);
    assert.deepEqual(stripToken(text, tok), { text: 'fix  now', caret: 4 });
  });

  test('stripToken at end of text', () => {
    const text = 'see #7';
    assert.deepEqual(stripToken(text, findHashToken(text, 6)), { text: 'see ', caret: 4 });
  });

  test('stripToken keeps text after the caret intact', () => {
    const text = 'a #ab cd';
    const tok = findHashToken(text, 4);
    assert.deepEqual(tok, { start: 2, end: 4, query: 'a' });
    assert.deepEqual(stripToken(text, tok), { text: 'a b cd', caret: 2 });
  });
});

describe('hash-search', async () => {
  const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/' });
  after(() => window.close());
  const { attachHashSearch } = await import('../ui/public/requirements-attach/hash-search.mjs');
  const { createAttachStore } = await import('../ui/public/requirements-attach/store.mjs');

  const doc = window.document;
  const SCOPE = { scopeType: 'project', scopeKey: 'shop-1' };
  const feat = (seq, extra = {}) => ({ seq, id: `F-${seq}`, title: `Feature ${seq}`, criteriaCount: 2, startable: true, label: null, ...extra });
  const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

  const fetchCalls = [];
  globalThis.fetch = async (...a) => { fetchCalls.push(a); throw new Error('hash-search must never fetch'); };

  let textarea;
  let cycles;
  let searches;
  beforeEach(() => {
    doc.body.replaceChildren();
    textarea = doc.createElement('textarea');
    doc.body.append(textarea);
    fetchCalls.length = 0;
    cycles = 0;
    searches = [];
  });

  async function setup({ features = [feat(1), feat(2), feat(3)], scope = SCOPE, text = 'fix #', store } = {}) {
    store = store || createAttachStore({ storage: memStorage(), key: 'k' });
    const searchFn = async (args) => { searches.push(args); return { features }; };
    const hs = attachHashSearch({
      textarea, getScope: () => scope, store, searchFn, doc,
      onProjectCycle: () => { cycles += 1; },
      position: () => ({ top: 10, left: 20 }),
    });
    textarea.value = text;
    textarea.setSelectionRange(text.length, text.length);
    hs.onInput();
    await settle();
    return { hs, store };
  }
  const key = (k) => new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  const popup = () => doc.querySelector('.mention-popup');
  const rows = () => [...doc.querySelectorAll('[data-ui="attach-hash-row"]')];
  const selected = () => rows().findIndex((r) => r.classList.contains('sel'));

  test('typing # opens a .mention-popup of rows and searches the scope with the query', async () => {
    await setup({ text: 'fix #ab' });
    assert.ok(popup());
    assert.equal(rows().length, 3);
    assert.deepEqual(searches.at(-1), { scopeType: 'project', scopeKey: 'shop-1', q: 'ab', exclude: [] });
  });

  test('keys: ArrowDown/ArrowUp move the selection and are claimed', async () => {
    const { hs } = await setup();
    assert.equal(selected(), 0);
    const down = key('ArrowDown');
    assert.equal(hs.handleKey(down), true);
    assert.equal(down.defaultPrevented, true);
    assert.equal(selected(), 1);
    hs.handleKey(key('ArrowDown'));
    hs.handleKey(key('ArrowDown'));
    assert.equal(selected(), 2, 'clamps at the last row');
    hs.handleKey(key('ArrowUp'));
    assert.equal(selected(), 1);
  });

  test('keys: Enter attaches the highlighted item, strips the token, preventDefaults, never fetches', async () => {
    const { hs, store } = await setup({ text: 'fix #ab now'.slice(0, 7) });
    hs.handleKey(key('ArrowDown'));
    const enter = key('Enter');
    assert.equal(hs.handleKey(enter), true);
    assert.equal(enter.defaultPrevented, true);
    assert.deepEqual(store.get().items.map((i) => i.seq), [2]);
    assert.equal(textarea.value, 'fix ');
    assert.equal(textarea.selectionStart, 4);
    assert.equal(popup(), null);
    assert.equal(fetchCalls.length, 0);
  });

  test('keys: once the caret has left the token the popover closes and the key goes to the page', async () => {
    const { hs, store } = await setup({ text: 'fix #ab' });
    assert.ok(popup());
    textarea.setSelectionRange(2, 2);   // the caret moved with no input event
    const enter = key('Enter');
    assert.equal(hs.handleKey(enter), false);
    assert.equal(enter.defaultPrevented, false);
    assert.equal(popup(), null);
    assert.equal(store.get().items.length, 0);
  });

  test('keys: Esc closes and is claimed; Tab calls onProjectCycle and is claimed', async () => {
    const { hs } = await setup();
    const tab = key('Tab');
    assert.equal(hs.handleKey(tab), true);
    assert.equal(tab.defaultPrevented, true);
    assert.equal(cycles, 1);
    assert.ok(popup(), 'Tab does not close');
    const esc = key('Escape');
    assert.equal(hs.handleKey(esc), true);
    assert.equal(popup(), null);
  });

  test('keys: returns false and does nothing when the popover is closed', async () => {
    const { hs } = await setup({ text: 'plain' });
    assert.equal(popup(), null);
    for (const k of ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape']) {
      const e = key(k);
      assert.equal(hs.handleKey(e), false, k);
      assert.equal(e.defaultPrevented, false, k);
    }
    assert.equal(cycles, 0);
  });

  test('keys: unrelated keys are not claimed while open', async () => {
    const { hs } = await setup();
    assert.equal(hs.handleKey(key('a')), false);
  });

  test('a never-started row is aria-disabled with its label and cannot be attached', async () => {
    const { hs, store } = await setup({ features: [feat(1, { startable: false, label: 'Not started yet' }), feat(2)] });
    const [first] = rows();
    assert.equal(first.getAttribute('aria-disabled'), 'true');
    assert.match(first.textContent, /Not started yet/);
    const enter = key('Enter');
    assert.equal(hs.handleKey(enter), true, 'Enter is still claimed so it cannot send');
    assert.equal(enter.defaultPrevented, true);
    assert.equal(store.get().items.length, 0);
    first.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    assert.equal(store.get().items.length, 0);
    assert.ok(popup());
  });

  test('"# heading" (space after #) closes the popover immediately', async () => {
    const { hs } = await setup();
    assert.ok(popup());
    textarea.value = 'fix # ';
    textarea.setSelectionRange(6, 6);
    hs.onInput();
    assert.equal(popup(), null);
  });

  test('with no scope it shows the project message instead of results and does not search', async () => {
    const { hs, store } = await setup({ scope: null });
    assert.ok(popup());
    assert.equal(rows().length, 0);
    assert.match(popup().textContent, /project/i);
    assert.equal(searches.length, 0);
    const enter = key('Enter');
    assert.equal(hs.handleKey(enter), true);
    assert.equal(enter.defaultPrevented, true);
    assert.equal(store.get().items.length, 0);
    hs.handleKey(key('Tab'));
    assert.equal(cycles, 1);
  });

  test('an empty result shows a note; Enter is claimed and attaches nothing', async () => {
    const { hs, store } = await setup({ features: [] });
    assert.equal(rows().length, 0);
    assert.ok(popup().textContent.length > 0);
    const enter = key('Enter');
    assert.equal(hs.handleKey(enter), true);
    assert.equal(enter.defaultPrevented, true);
    assert.equal(store.get().items.length, 0);
  });

  test('a failed search shows a note and does not throw', async () => {
    const store = createAttachStore({ storage: memStorage(), key: 'k' });
    const hs = attachHashSearch({
      textarea, getScope: () => SCOPE, store, doc, onProjectCycle() {}, position: () => ({ top: 0, left: 0 }),
      searchFn: async () => { throw new Error('boom'); },
    });
    textarea.value = '#';
    textarea.setSelectionRange(1, 1);
    const warn = console.warn;
    console.warn = () => {};
    try {
      hs.onInput();
      await settle();
    } finally {
      console.warn = warn;
    }
    assert.ok(popup());
    assert.equal(rows().length, 0);
  });

  test('a stale search response does not overwrite a newer one', async () => {
    const store = createAttachStore({ storage: memStorage(), key: 'k' });
    const pending = [];
    const hs = attachHashSearch({
      textarea, getScope: () => SCOPE, store, doc, onProjectCycle() {}, position: () => ({ top: 0, left: 0 }),
      searchFn: (args) => new Promise((res) => pending.push({ args, res })),
    });
    textarea.value = '#a';
    textarea.setSelectionRange(2, 2);
    hs.onInput();
    textarea.value = '#ab';
    textarea.setSelectionRange(3, 3);
    hs.onInput();
    pending[1].res({ features: [feat(9)] });
    await settle();
    pending[0].res({ features: [feat(1), feat(2)] });
    await settle();
    assert.deepEqual(rows().map((r) => r.textContent.includes('Feature 9')), [true]);
  });

  test('attaching past the limit keeps the popover and the text, and shows the limit message', async () => {
    const store = createAttachStore({ storage: memStorage(), key: 'k' });
    store.add(Array.from({ length: 10 }, (_, i) => feat(100 + i)));
    const { hs } = await setup({ store });
    assert.equal(hs.handleKey(key('Enter')), true);
    assert.equal(store.get().items.length, 10);
    assert.equal(textarea.value, 'fix #');
    assert.ok(popup());
    assert.match(popup().textContent, /10/);
  });

  test('mousedown on a row attaches it', async () => {
    const { store } = await setup();
    rows()[2].dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    assert.deepEqual(store.get().items.map((i) => i.seq), [3]);
    assert.equal(textarea.value, 'fix ');
    assert.equal(popup(), null);
  });

  test('close() removes the popover and handleKey then returns false', async () => {
    const { hs } = await setup();
    hs.close();
    assert.equal(popup(), null);
    assert.equal(hs.handleKey(key('Enter')), false);
  });

  test('the popover is positioned through the injected position()', async () => {
    await setup();
    assert.equal(popup().style.top, '10px');
    assert.equal(popup().style.left, '20px');
  });
});
