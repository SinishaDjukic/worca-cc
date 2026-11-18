// test/models-providers-tab.test.mjs — the Models page's Providers tab (models/providers-tab.mjs): two headed cards of
// fold rows; each head is a button (caret, mark, name, one summary line, state word) over today's row body; open state,
// the credential broker's note and class, an empty payload, and the narrow layout in the CSS bundle.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { cssRules } from './helpers/css-rules.mjs';
import { ICONS } from '../ui/public/icons.mjs';
import { renderProvidersTab, toggleProviderRow } from '../ui/public/models/providers-tab.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';

const doms = [];
afterEach(() => { for (const d of doms.splice(0)) d.window.close(); });
const docOf = () => { const d = new JSDOM('<!doctype html><body></body>'); doms.push(d); return d.window.document; };

/** GET /api/providers with all eight blocks: Copilot signed in (business), images on OpenAI, the broker off. */
const P = Object.freeze({
  copilot: { connected: true, login: 'octo', accountType: 'business', maxConcurrent: 4, tokenSource: 'stored', tokenRef: null, quota: { used: 12, entitlement: 300, unlimited: false, resetDate: '2026-10-01' } },
  openrouter: { keySet: true, keySource: 'stored', keyRef: null, keyMasked: '••••••1234', legacyKey: false, maxConcurrent: 8, order: ['anthropic'], sort: 'price', allowFallbacks: true },
  openai: { configured: true, keyOptional: false, keySet: true, keySource: 'stored', keyRef: null, keyMasked: '••••••abcd', baseUrl: 'https://gw.example/v1', maxConcurrent: 8 },
  anthropic: { configured: false, keyOptional: false, keySet: true, keySource: 'env', keyRef: '${ANT}', keyMasked: null, baseUrl: 'https://api.anthropic.com', maxConcurrent: 8 },
  speech: {
    stt: { engine: 'server', baseUrl: 'http://127.0.0.1:8080/v1', model: 'whisper-1', language: 'bg', configured: true, keySet: true, keySource: 'stored', keyMasked: '••••••abcd', keyRef: null, keyMissing: false },
    tts: { engine: 'browser', baseUrl: '', model: 'tts-1', voice: 'af_heart', speed: 1, configured: false, keySet: false, keySource: null, keyMasked: null, keyRef: null, keyMissing: false },
    cacheBytes: 480e6,
  },
  images: { service: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-2.6-flare', price: 0.04, configured: true, keySet: true, keySource: 'stored', keyRef: null, keyMasked: '••••••efgh', keyMissing: false },
  sound: { keySet: true, keySource: 'stored', keyRef: null, keyMasked: '••••••cdef', keyMissing: false, configured: true },
  broker: { enabled: false },
});
const KEY_PAGE = 'https://keys.example/';
const BROKER = Object.freeze({ ...P, broker: { enabled: true, keyPage: KEY_PAGE, providers: {} } });

const CARD_ROWS = [['copilot', 'openrouter', 'openai', 'anthropic'], ['speech', 'images', 'sound']];
const NAMES = ['GitHub Copilot', 'OpenRouter', 'OpenAI-compatible', 'Anthropic-compatible', 'Speech', 'Image generation', 'Sound'];
const GLYPHS = { speech: 'mic', images: 'image', sound: 'wave' };

const cardsOf = (root) => [...root.querySelectorAll(':scope > section.card.drows.mv-providers.mv-providers-split')];
const rowOf = (root, name) => [...root.querySelectorAll('.mv-pv-card[data-row]')].find((r) => r.dataset.row === name);
/** Whether row `name` is unfolded; the head's aria-expanded and the body's hidden always agree. */
const isOpen = (root, name) => {
  const row = rowOf(root, name);
  const open = row.querySelector(':scope > .mdl-fold').getAttribute('aria-expanded') === 'true';
  assert.equal(row.querySelector(':scope > .mdl-fold-body').hidden, !open, `${name}: the head and the body agree`);
  return open;
};

test('two headed cards hold the seven rows, each a folded button head over its row body', () => {
  const doc = docOf();
  const root = renderProvidersTab(P, { doc, counts: { copilot: 3 } });
  assert.ok(root.matches('div.mdl-prov'));
  assert.deepEqual([...root.children].map((c) => c.tagName), ['H2', 'SECTION', 'H2', 'SECTION']);
  const heads = [...root.querySelectorAll(':scope > h2.mdl-sect')];
  assert.deepEqual(heads.map((x) => x.textContent), ['Model providers', 'Voice, pictures and sound']);
  assert.deepEqual(heads.map((x) => x.id), ['mdl-sect-providers', 'mdl-sect-media']);
  const cards = cardsOf(root);
  assert.equal(cards.length, 2);
  cards.forEach((card, i) => assert.equal(card.getAttribute('aria-labelledby'), heads[i].id));
  assert.deepEqual(cards.map((card) => [...card.querySelectorAll(':scope > .mv-pv-card')].map((r) => r.dataset.row)), CARD_ROWS);
  const rows = [...root.querySelectorAll('.mv-pv-card')];
  assert.deepEqual(rows.map((r) => r.querySelector('.mdl-fold-name').textContent), NAMES);
  for (const row of rows) {
    const name = row.dataset.row;
    assert.ok(row.matches('section.drow.drow-stack') && !row.classList.contains('card'), name);
    const head = row.querySelector(':scope > button.mdl-fold.row-btn');
    const body = row.querySelector(':scope > div.mdl-fold-body');
    assert.equal(head.getAttribute('type'), 'button', name);
    assert.equal(head.getAttribute('aria-expanded'), 'false', name);
    assert.equal(body.hidden, true, name);
    assert.equal(body.id, `mdl-pv-${name}`);
    assert.equal(head.getAttribute('aria-controls'), body.id, name);
    assert.deepEqual([...head.children].map((c) => c.classList[0]), ['mdl-fold-caret', 'mdl-mark', 'mdl-fold-txt', 'mdl-st'], name);
    assert.equal(head.querySelector(':scope > .mdl-fold-caret .ic svg').innerHTML, ICONS.chevron, name);
    assert.ok(head.querySelector(':scope > .mdl-mark.lg :is(img, svg path, svg rect, svg circle)'), name);
    assert.ok(head.querySelector(':scope > .mdl-fold-txt > .mdl-fold-name + .mdl-fold-sum'), name);
    assert.ok(head.querySelector(':scope > .mdl-st'), name);
    assert.ok(body.querySelector(`:scope > .mv-pv-row[data-provider="${name}"]`), name);
    assert.equal(head.querySelector('a, input, button'), null, `${name}: nothing interactive inside the head button`);
  }
  // The first four wear their brand mark (the name is in the head, so no alt text); the last three a neutral glyph.
  for (const name of CARD_ROWS[0]) assert.equal(rowOf(root, name).querySelector('.mdl-fold > .mdl-mark.lg > img').getAttribute('alt'), '', name);
  for (const [name, key] of Object.entries(GLYPHS)) {
    assert.equal(rowOf(root, name).querySelector('.mdl-fold > .mdl-mark.lg.blank .ic svg').innerHTML, ICONS[key], name);
  }
});

test('the head reads the name, one summary line and the state word; counts decide hasModels', () => {
  const doc = docOf();
  const head = rowOf(renderProvidersTab(P, { doc, counts: { copilot: 3 } }), 'copilot').querySelector('.mdl-fold');
  assert.equal(head.querySelector('.mdl-fold-name').textContent, 'GitHub Copilot');
  assert.equal(head.querySelector('.mdl-fold-sum').textContent, 'Business · 4 requests at a time · 3 models');
  const st = head.querySelector(':scope > .mdl-st');
  assert.deepEqual([...st.classList], ['mdl-st', 'ok']);
  assert.equal(st.textContent, 'Connected');
  // OpenRouter with no key: "Needs key" once models use it, else "No key".
  const word = (counts) => {
    const s = rowOf(renderProvidersTab({}, { doc, counts }), 'openrouter').querySelector('.mdl-fold > .mdl-st');
    return [s.className, s.textContent];
  };
  assert.deepEqual(word({ openrouter: 2 }), ['mdl-st need', 'Needs key']);
  assert.deepEqual(word({ openai: 2 }), ['mdl-st off', 'No key']);
  assert.deepEqual(word({}), ['mdl-st off', 'No key']);
});

test('open, toggleProviderRow and an active sign-in decide which rows are unfolded', () => {
  const doc = docOf();
  const root = renderProvidersTab(P, { doc, open: { openrouter: true } });
  assert.equal(isOpen(root, 'openrouter'), true);
  for (const name of ['copilot', 'openai', 'images']) assert.equal(isOpen(root, name), false, name);
  assert.equal(toggleProviderRow(root, 'openrouter'), false);
  assert.equal(isOpen(root, 'openrouter'), false);
  assert.equal(toggleProviderRow(root, 'openrouter', true), true);
  assert.equal(toggleProviderRow(root, 'openrouter', true), true);
  assert.equal(isOpen(root, 'openrouter'), true);
  assert.equal(toggleProviderRow(root, 'openrouter', false), false);
  assert.equal(toggleProviderRow(root, 'openrouter', false), false);
  assert.equal(isOpen(root, 'openrouter'), false);
  assert.equal(toggleProviderRow(root, 'sound'), true);
  assert.equal(isOpen(root, 'sound'), true);
  assert.equal(toggleProviderRow(root, 'nope'), false);
  // The Copilot device flow in flight keeps its row open, so the code stays in sight.
  const signedOut = { ...P, copilot: { connected: false, accountType: 'individual', maxConcurrent: 4 } };
  const signIn = { userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', status: 'pending', error: null };
  const flowing = renderProvidersTab(signedOut, { doc, signIn });
  assert.equal(isOpen(flowing, 'copilot'), true);
  assert.ok(rowOf(flowing, 'copilot').querySelector('.mdl-fold-body .mv-cp-flow'));
  assert.equal(isOpen(flowing, 'openrouter'), false);
  assert.equal(isOpen(renderProvidersTab(signedOut, { doc }), 'copilot'), false);
});

test('broker mode: both cards carry the broker class and the first opens with the key-page note', () => {
  const doc = docOf();
  const root = renderProvidersTab(BROKER, { doc });
  const cards = cardsOf(root);
  for (const card of cards) assert.ok(card.classList.contains('mv-providers--broker'), card.id);
  const note = cards[0].firstElementChild;
  assert.ok(note.matches('p.hint.mv-broker-note'));
  assert.match(note.textContent, /held by the credential broker/);
  const link = note.querySelector('a.mv-broker-link');
  assert.equal(link.textContent, 'Open the key page');
  assert.equal(link.getAttribute('href'), KEY_PAGE);
  assert.equal(link.getAttribute('target'), '_blank');
  assert.equal(link.getAttribute('rel'), 'noopener');
  assert.equal(cards[1].querySelector('.mv-broker-note'), null);
  const openai = rowOf(root, 'openai');
  const st = openai.querySelector('.mdl-fold > .mdl-st');
  assert.ok(st.classList.contains('need'));
  assert.equal(st.textContent, 'Add your key on the key page');
  assert.ok(openai.querySelector('.mdl-fold-body .mv-pv-broker a.mv-broker-pill'));
  // No key page yet: the note stays, without a link.
  const bare = cardsOf(renderProvidersTab({ ...P, broker: { enabled: true, providers: {} } }, { doc }))[0].firstElementChild;
  assert.ok(bare.matches('p.mv-broker-note'));
  assert.equal(bare.querySelector('a'), null);
  // The broker off: no class, no note.
  for (const card of cardsOf(renderProvidersTab(P, { doc }))) {
    assert.equal(card.classList.contains('mv-providers--broker'), false);
    assert.equal(card.querySelector('.mv-broker-note'), null);
  }
});

test('an empty or missing payload still draws the seven folded rows', () => {
  const doc = docOf();
  for (const input of [{}, null, undefined]) {
    const root = renderProvidersTab(input, { doc });
    assert.deepEqual([...root.querySelectorAll('.mv-pv-card')].map((r) => r.dataset.row), CARD_ROWS.flat(), String(input));
    for (const r of root.querySelectorAll('.mv-pv-card')) assert.equal(isOpen(root, r.dataset.row), false);
  }
});

test('the CSS: narrow heads wrap and bodies lose their indent; the summary ellipsizes; the chevrons turn', () => {
  const rules = cssRules(readStyleCss());
  const narrow = rules.filter((r) => /@container drows \(max-width:560px\)/.test(r.media));
  assert.ok(narrow.some((r) => r.sel === '.mdl-fold' && /(?:^|;)\s*flex-wrap:wrap/.test(r.body)), 'the state drops under the text');
  assert.ok(narrow.some((r) => r.sel === '.mdl-fold-body' && /(?:^|;)\s*padding-left:0(?:;|$)/.test(r.body)), 'the body loses its indent');
  assert.ok(rules.some((r) => r.sel === '.mdl-fold-sum' && !r.media && /text-overflow:ellipsis/.test(r.body)));
  const turns = rules.filter((r) => !r.media && /rotate\(90deg\)/.test(r.body)).map((r) => r.sel).join(',');
  assert.match(turns, /\.mdl-fold\[aria-expanded="true"\]/);
  assert.match(turns, /\.mdl-disc\[aria-expanded="true"\]/);
  assert.ok(rules.some((r) => /prefers-reduced-motion/.test(r.media) && /\.mdl-fold-caret/.test(r.sel) && /transition:none/.test(r.body)), 'no turn under reduced motion');
});

// VIS-4: a long state word (`Token ${GITHUB_COPILOT_TOKEN} not set`) never widens a narrow card. Without one
// shrinkable column the grid's auto track took the head's min-content and pushed every row past the card's edge.
test('the CSS: a card keeps one shrinkable column, a narrow state wraps on its own line, the head and body keep their layout', () => {
  const rules = cssRules(readStyleCss());
  const wide = (sel) => rules.filter((r) => r.sel === sel && !r.media).map((r) => r.body).join('');
  const narrow = rules.filter((r) => /@container drows \(max-width:560px\)/.test(r.media) && r.sel === '.mdl-fold > .mdl-st').map((r) => r.body).join('');
  const has = (body, decl) => new RegExp(`(?:^|;)\\s*${decl.replace(/[()%]/g, '\\$&')}\\s*(?:;|$)`).test(body);
  const split = wide('.mdl-prov .mv-providers-split');
  assert.ok(has(split, 'grid-template-columns:minmax(0,1fr)'), 'one column that may shrink below its content');
  assert.ok(has(split, 'gap:0'), 'the rows meet at their dividers');
  assert.ok(has(narrow, 'flex-basis:100%'), 'the state takes a line of its own (flex:1 would have a basis of 0)');
  assert.ok(has(narrow, 'white-space:normal'), 'a narrow state wraps');
  assert.ok(has(narrow, 'overflow-wrap:anywhere'), 'even inside one long ${VAR}');
  assert.ok(has(wide('.mdl-fold > .mdl-st'), 'flex:none'), 'a wide state never shrinks');
  const row = wide('.mdl-prov .drow.mv-pv-card');
  assert.ok(has(row, 'padding-top:0') && has(row, 'padding-bottom:0'), 'the row\'s padding moves into its head');
  const fold = wide('.mdl-fold');
  assert.ok(has(fold, 'display:flex') && has(fold, 'min-height:48px'), 'the head is a 48px flex line');
  assert.match(wide('.mdl-fold-body'), /(?:^|;)\s*padding:\S+ \S+ \S+ 88px\s*(?:;|$)/, 'the body sits under the name');
  assert.ok(has(wide('.mdl-sect'), 'font-weight:600'), 'the section heads are styled');
  assert.equal(rules.some((r) => /mv-providers-hint/.test(r.sel)), false, 'no rule for a class nothing draws');
});
