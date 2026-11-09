// test/rail-parts-scope.test.mjs — Stillhet's CSS cannot touch today's pages while its flag is off: every rule in the seven
// Rail parts scopes on :root[data-rail] (or html[data-rail]), inside at-rules too, or names a class only the library draws
// (D10, D11). The fixtures prove each bad kind fails, so the real parts passing means something.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUB = join(ROOT, 'ui/public');
const PARTS = ['design-system/rail-look.css', 'design-system/rail-controls.css', 'design-system/rail-rows.css', 'design-system/rail-feedback.css',
  'runs/rail-run-card.css', 'runs/rail-run-tabs.css', 'runs/rail-create-pr.css'];
const read = (f) => readFileSync(join(PUB, f), 'utf8');
const NESTS = new Set(['media', 'container', 'supports', 'starting-style']);

/** Rules of a stylesheet: [{ selector, body, at: ['media', …] }], plus at-rules seen. Comments and strings are skipped. */
function parse(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
  const rules = []; const ats = [];
  const close = (i) => { for (let d = 0; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) return i + 1; } throw new Error('unclosed block'); };
  const walk = (from, to, at) => {
    let i = from;
    for (;;) {
      while (i < to && /\s/.test(src[i])) i++;
      if (i >= to || src[i] === '}') return;
      const semi = src.indexOf(';', i); const open = src.indexOf('{', i);
      if (src[i] === '@' && semi !== -1 && (open === -1 || semi < open)) { ats.push({ name: /@([\w-]+)/.exec(src.slice(i))[1], nested: at.length > 0 }); i = semi + 1; continue; }
      const prelude = src.slice(i, open).trim(); const end = close(open);
      if (prelude.startsWith('@')) {
        const name = /@([\w-]+)/.exec(prelude)[1];
        ats.push({ name, prelude, nested: at.length > 0 });
        if (NESTS.has(name)) walk(open + 1, end - 1, [...at, name]);
      } else rules.push({ selector: prelude, body: src.slice(open + 1, end - 1), at });
      i = end;
    }
  };
  walk(0, src.length, []);
  return { rules, ats };
}
const items = (sel) => { const out = []; let d = 0, cur = ''; for (const c of sel) { if (c === '(' || c === '[') d++; if (c === ')' || c === ']') d--; if (c === ',' && !d) { out.push(cur.trim()); cur = ''; } else cur += c; } out.push(cur.trim()); return out; };
const classes = (item) => [...item.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
const scoped = (item) => /^(:root\[data-rail\]|html\[data-rail\])/.test(item);

function walkFiles(dir, out = []) {
  for (const e of readdirSync(dir)) { const p = join(dir, e); if (statSync(p).isDirectory()) walkFiles(p, out); else if (/\.(css|mjs|js|html)$/.test(e)) out.push(p); }
  return out;
}
// Where a class may appear and still be "library-only": the library's components and the Rail parts themselves.
const OUTSIDE = walkFiles(PUB).filter((p) => { const r = relative(PUB, p); return !r.startsWith('design-system/components/') && !PARTS.includes(r); })
  .map((p) => readFileSync(p, 'utf8')).join('\n');
const used = new Map();
const libraryOnly = (c, text = OUTSIDE) => { if (!used.has(c)) used.set(c, new RegExp(`(^|[^\\w-])${c.replace(/[-]/g, '\\-')}(?![\\w-])`).test(text)); return !used.get(c); };

/** Problems of one part ([] = scoped). `onlyLib(c)` says whether class c is drawn by the library alone. */
function scopeProblems(css, onlyLib = (c) => libraryOnly(c)) {
  const out = []; const { rules, ats } = parse(css);
  for (const a of ats) if (a.name === 'font-face' || a.name === 'import') out.push(`@${a.name} in a part`);
  for (const r of rules) for (const it of items(r.selector)) {
    if (scoped(it)) continue;
    const cs = classes(it);
    if (!cs.some(onlyLib)) out.push(`unscoped${r.at.length ? ` (in @${r.at.join(' @')})` : ''}: ${it}`);
  }
  return out;
}

// With rail on, today's pages change colour only (R-qa-8's pass B): the CDP proof's notion of a colour property.
const COLOUR = /color|background|shadow|fill|stroke|caret|outline|filter/;
/** Scoped items whose rule sets a non-colour property and names no library-only class: they would move today's pages. */
function layoutProblems(css, onlyLib = (c) => libraryOnly(c)) {
  const out = [];
  for (const r of parse(css).rules) {
    const props = r.body.split(';').map((d) => d.split(':')[0].trim()).filter(Boolean);
    if (props.every((p) => p.startsWith('--') || COLOUR.test(p))) continue;
    for (const it of items(r.selector)) if (scoped(it) && !classes(it).some(onlyLib)) out.push(`${it} sets ${props.filter((p) => !p.startsWith('--') && !COLOUR.test(p)).join(',')}`);
  }
  return out;
}

test('the seven Rail parts are the last seven entries of parts.json css, in table order (D9)', () => {
  assert.deepEqual(JSON.parse(read('parts.json')).css.slice(-PARTS.length), PARTS);
});

test('every rule in the seven Rail parts is scoped on :root[data-rail], or names a class only the library draws (D10, D11)', () => {
  for (const f of PARTS) assert.deepEqual(scopeProblems(read(f)), [], f);
});

test('the bad kinds fail: an unscoped shared class, a class-less rule, a rule inside @media, @font-face, a mixed comma list', () => {
  const lib = (c) => c === 'rc-confirm';
  assert.deepEqual(scopeProblems('.btn{color:red}', lib), ['unscoped: .btn']);
  for (const s of ['body', 'a', '[data-x]']) assert.deepEqual(scopeProblems(`${s}{color:red}`, lib), [`unscoped: ${s}`]);
  assert.deepEqual(scopeProblems('@media (max-width: 400px){.x{color:red}}', lib), ['unscoped (in @media): .x']);
  assert.deepEqual(scopeProblems('@container (max-width: 400px){ :root[data-rail] .x{color:red} }', lib), []);
  assert.deepEqual(scopeProblems('@font-face{font-family:X;src:url(x.woff2)}', lib), ['@font-face in a part']);
  assert.deepEqual(scopeProblems('@import url(x.css);', lib), ['@import in a part']);
  assert.deepEqual(scopeProblems('.rc-confirm, .btn{color:red}', lib), ['unscoped: .btn'], 'one passing item does not carry the other');
  assert.deepEqual(scopeProblems(':root[data-rail] .btn, html[data-rail] body{color:red}', lib), []);
});

test('rail on changes only colours on today\'s pages: a scoped rule setting more than colour names a class only the library draws (R-qa-8)', () => {
  for (const f of PARTS) assert.deepEqual(layoutProblems(read(f)), [], f);
  const lib = (c) => c === 'rc-pop';
  assert.deepEqual(layoutProblems(':root[data-rail] .menu{max-width:1px}', lib), [':root[data-rail] .menu sets max-width']);
  assert.deepEqual(layoutProblems('@media (max-width: 400px){:root[data-rail] #route-chat{display:flex}}', lib), [':root[data-rail] #route-chat sets display']);
  assert.deepEqual(layoutProblems(':root[data-rail] .menu{color:red;border-color:red;--x:1}', lib), []);
  assert.deepEqual(layoutProblems(':root[data-rail] .rc-pop > .menu{max-width:1px}', lib), []);
});

test('set-row, list-row and side-menu are scoped (dev draws look-alikes: lbl-set-row, mk-list-row); the strip\'s rules stay unscoped, with the 44 px buttons', () => {
  const all = PARTS.map((f) => parse(read(f)).rules.flatMap((r) => items(r.selector).map((it) => ({ it, r, f })))).flat();
  for (const c of ['set-row', 'list-row', 'side-menu']) {
    const hits = all.filter(({ it }) => classes(it).includes(c));
    assert.ok(hits.length, `${c} has rules`);
    for (const { it } of hits) assert.ok(scoped(it), `${c}: ${it}`);
  }
  for (const c of ['rc-confirm', 'rc-confirm-t', 'rc-confirm-why', 'rc-confirm-acts', 'dc-out']) assert.ok(libraryOnly(c), `${c} is library-only`);
  const strip = all.filter(({ it }) => /^\.rc-confirm(\.is-form)?$/.test(it));
  assert.ok(strip.length >= 2 && strip.every(({ f }) => f === 'design-system/rail-feedback.css'), 'the strip\'s rules are unscoped, in rail-feedback.css');
  const tall = all.find(({ it, f }) => f === 'design-system/rail-feedback.css' && it === '.rc-confirm.is-form .rc-confirm-acts .btn');
  assert.ok(tall && tall.r.at.length === 0 && /min-height:44px/.test(tall.r.body), 'the 44 px rule, outside any @media');
});

test('@keyframes and @property names exist nowhere else in ui/public CSS', () => {
  const others = walkFiles(PUB).filter((p) => p.endsWith('.css') && !PARTS.includes(relative(PUB, p))).map((p) => readFileSync(p, 'utf8')).join('\n');
  for (const f of PARTS) for (const a of parse(read(f)).ats.filter((x) => x.name === 'keyframes' || x.name === 'property')) {
    const name = a.prelude.replace(/^@[\w-]+\s+/, '').trim();
    assert.ok(!new RegExp(`@(keyframes|property)\\s+${name.replace(/[-]/g, '\\-')}(?![\\w-])`).test(others), `${f}: ${a.prelude} is defined elsewhere too`);
  }
});

test('no part sets --sans; the bridge sets only colours, light-dark() or var()', () => {
  for (const f of PARTS) assert.doesNotMatch(read(f).replace(/\/\*[\s\S]*?\*\//g, ''), /--sans\s*:/, f);
  const motion = /^--(motion-[\w-]+|ease)$/;
  const props = parse(read('design-system/rail-look.css')).rules.filter((r) => r.selector === ':root[data-rail]')
    .flatMap((r) => r.body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => d.split(/:(.*)/s)));
  assert.ok(props.length > 20, 'the scan sees the bridge');
  for (const [k, v] of props) {
    if (motion.test(k.trim())) continue;
    assert.match(v.trim(), /^(light-dark\(|var\(|#[0-9a-fA-F]{3,8}$|transparent$)/, `${k}: ${v}`);
  }
});

test('every var() in an unscoped rule is defined in shell/self-hosted.css or has a fallback', () => {
  const defined = new Set([...read('shell/self-hosted.css').matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  for (const f of PARTS) for (const r of parse(read(f)).rules) {
    if (items(r.selector).every(scoped)) continue;
    for (const m of r.body.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) assert.ok(m[2] || defined.has(m[1]), `${f}: ${r.selector} uses ${m[1]}`);
  }
});

// The prototype's own layers load after the app's CSS, as the page's next layer: unscoped, the parts' prefix outranks them
// (the avatar's usage rings, the Chats column), so they take the same prefix and win by order again, as before the parts.
const PROTO = join(ROOT, 'plans/rail/prototype');
const LAYERS = ['design-system/rail-shell.css', 'pulse/pulse.css', 'shell/shell.css'];
const PAGES = readdirSync(PROTO).filter((f) => f.endsWith('.html'));
const inlineStyles = (html) => [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
// Attributes the pages set on <html> itself: `:root[data-rail] [data-bg]` looks for them below the root and never matches.
const ROOT_ATTRS = ['data-theme', 'data-bg', 'data-bg-breathe', 'data-flags'];
const rootAttrBelow = (css) => parse(css).rules.flatMap((r) => items(r.selector))
  .filter((it) => ROOT_ATTRS.some((a) => it.includes(`:root[data-rail] [${a}`) || it.includes(`html[data-rail] [${a}`)));

test('the prototype\'s own layers and inline styles are scoped like the parts, so they still win by order', () => {
  const none = () => false;
  for (const f of LAYERS) assert.deepEqual(scopeProblems(readFileSync(join(PROTO, f), 'utf8'), none), [], f);
  assert.ok(PAGES.length >= 4, 'the scan sees the pages');
  for (const f of PAGES) assert.deepEqual(scopeProblems(inlineStyles(readFileSync(join(PROTO, f), 'utf8')), none).filter((p) => p !== '@font-face in a part'), [], f);
  assert.deepEqual(scopeProblems('.pz-ava-wrap .usage-ring{position:absolute}', none), ['unscoped: .pz-ava-wrap .usage-ring']);
});

test('a root attribute is matched on the root, not below it', () => {
  for (const f of PARTS) assert.deepEqual(rootAttrBelow(read(f)), [], f);
  for (const f of LAYERS) assert.deepEqual(rootAttrBelow(readFileSync(join(PROTO, f), 'utf8')), [], f);
  assert.deepEqual(rootAttrBelow(':root[data-rail] [data-bg="dots"] .chat-home-bg{color:red}'), [':root[data-rail] [data-bg="dots"] .chat-home-bg']);
  assert.deepEqual(rootAttrBelow(':root[data-rail][data-bg="dots"] .chat-home-bg{color:red}'), []);
});
