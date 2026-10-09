// test/ui-sidebar-compact.test.mjs — the compact sidebar (plan P1, docs/superpowers/plans/2026-10-08-compact-sidebar.md):
// three bands, the 220px column and the 60px rail, the row rhythm, the counts and the Nodes flyout, read
// straight from index.html and style.css. jsdom has no layout, so sizes are pinned in the stylesheet; the
// behaviour lives in ui-sidebar-collapse, ui-nodes-flyout, ui-mobile-nav and side-flyout tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = (p) => readFileSync(new URL(`../ui/public/${p}`, import.meta.url), 'utf8');
const html = read('index.html');
const css = read('style.css');
const doc = new JSDOM(html).window.document;

/** The body of the FIRST rule written exactly as `selector {…}` (house rule: no comment inside a rule body). */
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}'));
  return m ? m[1].replace(/\s+/g, ' ') : null;
}

test('three bands: the logo row and the foot stay put, the pages scroll between them', () => {
  const aside = doc.querySelector('aside.sidebar#side-rail');
  assert.deepEqual([...aside.children].slice(0, 3).map((el) => el.id || el.className), ['brand', 'side-scroll', 'side-foot']);
  assert.equal(doc.querySelector('nav.nav').parentElement.id, 'side-scroll', 'the nav is the scroll band');
  assert.ok(doc.querySelector('#side-scroll').classList.contains('side-scroll'));
  assert.ok(doc.querySelector('#side-foot').classList.contains('side-foot'));
  for (const id of ['side-who', 'side-away', 'side-actions', 'side-spend']) {
    assert.equal(doc.getElementById(id).parentElement.id, 'side-foot', `#${id} sits in the fixed foot`);
  }
});

test('the column is 220px and never scrolls itself; #side-scroll is the one scroller; the rail is 60px', () => {
  const side = ruleBody('.sidebar');
  assert.match(side, /width:220px;flex:0 0 220px;/);
  assert.match(side, /display:flex;flex-direction:column;/);
  assert.match(side, /overflow:hidden;/);
  assert.doesNotMatch(side, /overflow-y|padding/, 'the bands own the padding and the scrolling');
  assert.match(ruleBody('.brand'), /flex:none;/);
  assert.match(ruleBody('.brand'), /padding:12px 10px 0 20px;/);
  assert.match(ruleBody('.brand .logo'), /height:32px;/);
  assert.match(ruleBody('.side-scroll'), /flex:1 1 auto;min-height:0;/);
  assert.match(ruleBody('.side-scroll'), /overflow-y:auto;/);
  assert.match(ruleBody('.side-scroll'), /padding:11px 10px 10px;/);
  assert.match(ruleBody('.side-foot'), /flex:none;/);
  assert.match(ruleBody('.side-foot'), /padding:8px 10px 10px;/);
  assert.match(ruleBody('.sidebar.collapsed'), /width:60px;flex:0 0 60px;/);
  assert.match(ruleBody('.sidebar.collapsed .brand'), /padding:16px 0 10px;/);
  assert.match(ruleBody('.brand .logo-mark'), /width:26px;height:26px;/);
});

test('the Ask dock and the phone drawer follow the new widths; no 298 / 76px literal is left', () => {
  assert.match(ruleBody('.ask-dock'), /left:220px;/);
  assert.equal(ruleBody('body.rail-collapsed .ask-dock'), 'left:60px;');
  assert.match(css, /\.sidebar\{position:fixed;top:0;bottom:0;left:0;z-index:42;width:min\(220px,86vw\);/);
  // The Ask threads popover's right:76px sits on the right edge: it is not the rail.
  const rest = css.replace('.ask-pop-threads{top:46px;right:76px;', '');
  assert.doesNotMatch(rest, /\b298\b|\b76px\b/);
});

test('hairlines: transparent at rest, --line while the pages run under an edge', () => {
  assert.match(ruleBody('.brand'), /border-bottom:1px solid transparent;/);
  assert.equal(ruleBody('.sidebar.under-top .brand'), 'border-bottom-color:var(--line);');
  assert.match(ruleBody('.side-foot'), /border-top:1px solid transparent;/);
  assert.equal(ruleBody('.sidebar.under-bottom .side-foot'), 'border-top-color:var(--line);');
});

test('row rhythm: 29px rows a 1px gap apart, 12.5px labels, 16px icons at stroke 1.6, 11px section labels', () => {
  assert.match(ruleBody('.nav'), /gap:1px;/);
  const row = ruleBody('.nav button');
  for (const d of ['height:29px;', 'padding:0 8px 0 9px;', 'border-radius:8px;', 'gap:10px;', 'font-size:12.5px;', 'font-weight:400;']) {
    assert.ok(row.includes(d), `.nav button has ${d}`);
  }
  assert.match(ruleBody('.nav button svg'), /width:16px;height:16px;margin:0 2px;flex:0 0 auto;stroke-width:1\.6;/);
  assert.match(ruleBody('.nav button > span:not(.nav-count)'), /min-width:0;overflow:hidden;text-overflow:ellipsis;/);
  assert.match(ruleBody('.nav-sect'), /padding:15px 10px 6px;font-size:11px;font-weight:500;/);
});

test('the open page is a soft grey fill and hover the lighter field grey; nothing paints a row black', () => {
  assert.equal(ruleBody('.nav button.active'), 'background:var(--hover);color:var(--ink);font-weight:500;');
  assert.equal(ruleBody('.nav button:hover'), 'background:var(--field);color:var(--ink);');
  assert.equal(ruleBody('.nav button.active svg'), null, 'no --on-ink stroke: there is no dark fill to sit on');
  assert.equal(ruleBody('.nav button.active .nav-count'), null, 'no white-on-wash count: the fill is light now');
});

test('the first group has no label: "Activity" is gone, Build and Manage remain', () => {
  assert.deepEqual([...doc.querySelectorAll('.nav .nav-sect')].map((s) => s.textContent.trim()), ['Build', 'Manage']);
  assert.equal(doc.querySelector('.nav').firstElementChild.dataset.nav, 'new');
  assert.equal(doc.querySelector('.nav button[data-nav="new"]').nextElementSibling.dataset.nav, 'runs');
});

test('New pipeline is a normal row led by an 18px ink "+" tile; nav-cta is gone everywhere', () => {
  const row = doc.querySelector('.nav button[data-nav="new"]');
  assert.ok(row.classList.contains('nav-new'));
  const tile = row.firstElementChild;
  assert.equal(tile.tagName, 'I', 'an <i>: the rail visually hides a row\'s direct <span> children');
  assert.ok(tile.classList.contains('nav-tile'));
  assert.equal(tile.getAttribute('aria-hidden'), 'true');
  assert.equal(row.querySelector(':scope > span').textContent, 'New pipeline');
  assert.match(ruleBody('.nav-tile'), /width:18px;height:18px;margin:0 1px;/);
  assert.match(ruleBody('.nav-tile'), /background:var\(--ink\);color:var\(--on-ink\);/);
  assert.equal(ruleBody('.nav button.nav-new'), 'color:var(--ink);font-weight:500;');
  const themeTool = readFileSync(new URL('../tools/verify-theme-cdp.mjs', import.meta.url), 'utf8');
  for (const [name, src] of [['index.html', html], ['style.css', css], ['app.js', read('app.js')], ['tools/verify-theme-cdp.mjs', themeTool]]) {
    assert.doesNotMatch(src, /nav-cta/, `${name} still names nav-cta`);
  }
  assert.ok(themeTool.includes("'.sidebar.collapsed .nav > button.nav-new'"), 'verify:theme still hovers the rail\'s New pipeline square');
});

test('the Getting started pill keeps the 29px rhythm: a full violet outline and a count pill of its own', () => {
  const pill = ruleBody('.nav button.gs-pill');
  assert.match(pill, /border:1\.5px solid var\(--violet\);padding:0 6\.5px 0 7\.5px;/);
  assert.doesNotMatch(pill, /height|border-left/);
  assert.match(ruleBody('.nav button.gs-pill .gs-pill-count'), /height:18px;padding:0 6px;border-radius:999px;/);
});

test('counts: a plain grey mono number, the amber needs-you count is the one pill, a zero ships hidden, no green', () => {
  const count = ruleBody('.nav-count');
  assert.match(count, /font-family:var\(--mono\);font-size:11px;font-weight:500;/);
  assert.match(count, /color:var\(--ink-2\);/, 'a count carries information: --ink-2 (--ink-3 is for labels)');
  assert.doesNotMatch(count, /background|border-radius/, 'a number, not a badge');
  assert.equal(ruleBody('.nav-count.n-grey'), 'background:none;color:var(--ink-2);', 'the .n-grey disc utility must not paint a disc here, nor its --ink-3');
  assert.match(ruleBody('.nav-count.n-amber'), /height:18px;padding:0 6px;border-radius:999px;background:var\(--amber-bg\);color:var\(--amber-ink-strong\);/);
  assert.equal(ruleBody('.nav-count[hidden]'), 'display:none;');
  assert.match(ruleBody('.sidebar.collapsed .nav-count'), /position:absolute;top:3px;right:2px;margin:0;font-size:9\.5px;/);
  assert.equal(ruleBody('.sidebar.collapsed .nav-count.n-grey:has(~ .nav-count.n-amber:not([hidden]))'), 'display:none;',
    'on the rail the Schedules grey number steps aside for its unread pill (one corner, one badge)');
  for (const id of ['nav-needs-count', 'nav-running-count', 'nav-schedules-count', 'nav-schedules-unread']) {
    const el = doc.getElementById(id);
    assert.equal(el.hidden, true, `#${id} ships hidden (a zero)`);
    assert.equal(el.textContent, '0');
  }
  for (const [name, src] of [['index.html', html], ['style.css', css], ['app.js', read('app.js')]]) {
    assert.doesNotMatch(src, /\bn-run\b/, `${name} still names the green n-run`);
  }
});

test('the 60px rail: 40x34 squares 3px apart, section labels as 1px hairlines, child-combinator row rules only', () => {
  assert.equal(ruleBody('.sidebar.collapsed .nav'), 'align-items:center;gap:3px;');
  assert.match(css, /\.sidebar\.collapsed \.nav > button,\.sidebar\.collapsed \.gs-pill-host > button\{flex:0 0 auto;width:40px;height:34px;padding:0;gap:0;justify-content:center;\}/);
  assert.match(ruleBody('.sidebar.collapsed .nav-sect'), /align-self:stretch;height:1px;margin:10px 6px;padding:0;font-size:0;/);
  assert.match(ruleBody('.sidebar.collapsed .nav-sect'), /background:var\(--line\);/);
  assert.equal(ruleBody('.sidebar.collapsed .nav .gs-pill .gs-pill-count'), 'display:none;');
  // A descendant `.nav button` rule on the rail would square off the Nodes flyout's rows too.
  assert.doesNotMatch(css, /\.sidebar\.collapsed \.nav button/);
});

test('the MOCK pill sits in the logo row between the wordmark and the toggle; on the rail it stacks under the mark', () => {
  const order = [...doc.querySelector('.brand').children].map((el) => el.id || el.className);
  assert.ok(order.indexOf('logo') < order.indexOf('side-mock-pill'), 'after the wordmark');
  assert.ok(order.indexOf('side-mock-pill') < order.indexOf('side-toggle'), 'before the toggle');
  assert.equal(ruleBody('.brand .side-mock-pill'), 'margin-right:auto;padding:3px 7px;cursor:default;background:var(--amber-ink);color:var(--on-status);',
    'no comment inside the rule body (house rule)');
  assert.match(ruleBody('.sidebar.collapsed .brand'), /flex-direction:column;/);
  assert.match(ruleBody('.sidebar.collapsed .side-toggle'), /order:-1;/, 'the mark first, the pill under it');
});

test('npm run verify:theme forces :hover on the new hover-only rules (the Running actions rows and their Stop)', () => {
  const tool = readFileSync(new URL('../tools/verify-theme-cdp.mjs', import.meta.url), 'utf8');
  const list = tool.slice(tool.indexOf('const HOVER_SELECTORS = ['), tool.indexOf('];', tool.indexOf('const HOVER_SELECTORS = [')));
  for (const sel of ['.act-srow', '.act-stop', '.sidebar.collapsed .nav > button.nav-new']) assert.ok(list.includes(`'${sel}'`), sel);
});

test('the needs-you pill reads at 4.5:1 or better in both themes (--amber-ink-strong on --amber-bg)', () => {
  const root = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/(?:^|[\s,}]):root\s*\{([^}]*)\}/)[1];
  const tok = (name) => /light-dark\((#[0-9a-fA-F]{6}),\s*(#[0-9a-fA-F]{6})\)/
    .exec(root.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))[1]).slice(1);
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const [inkL, inkD] = tok('--amber-ink-strong');
  const [bgL, bgD] = tok('--amber-bg');
  assert.ok(ratio(inkL, bgL) >= 4.5, `light ${ratio(inkL, bgL).toFixed(2)}:1`);
  assert.ok(ratio(inkD, bgD) >= 4.5, `dark ${ratio(inkD, bgD).toFixed(2)}:1`);
  assert.match(ruleBody('.nav-count.n-amber'), /color:var\(--amber-ink-strong\);/);
});

/** The colour the top-level rules give `el` after the cascade (specificity, then source order), read from
 *  the CSSOM: jsdom has no layout and does not resolve var(). */
function cascadedColor(el) {
  const sheet = new JSDOM(`<style>${css}</style>`).window.document.styleSheets[0];
  const splitTop = (s) => {
    const out = []; let depth = 0, cur = '';
    for (const ch of s) {
      if (ch === '(' || ch === '[') depth++; else if (ch === ')' || ch === ']') depth--;
      if (depth === 0 && ch === ',') { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    return [...out, cur.trim()].filter(Boolean);
  };
  const cmp = (x, y) => { for (let j = 0; j < x.length; j++) if (x[j] !== y[j]) return x[j] - y[j]; return 0; };
  const spec = (sel) => {
    let a = 0, b = 0, c = 0;
    let s = sel.replace(/:(?:not|is|has)\(((?:[^()]|\([^()]*\))*)\)/g, (m, inner) => {
      const [x, y, z] = splitTop(inner).map(spec).sort(cmp).pop();
      a += x; b += y; c += z; return ' ';
    });
    s = s.replace(/#[\w-]+/g, () => { a++; return ' '; });
    s = s.replace(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g, () => { b++; return ' '; });
    for (const _ of s.matchAll(/(?:^|[\s>+~])[a-zA-Z][\w-]*/g)) c++;
    return [a, b, c];
  };
  let win = null;
  [...sheet.cssRules].forEach((r, i) => {
    if (typeof r.selectorText !== 'string' || !r.style.color) return;
    for (const sel of splitTop(r.selectorText)) {
      let hit = false;
      try { hit = el.matches(sel); } catch { /* a selector jsdom cannot parse */ }
      const k = [...spec(sel), i];
      if (hit && (!win || cmp(k, win.k) > 0)) win = { k, color: r.style.color };
    }
  });
  return win && win.color;
}

test('a grey count paints --ink-2 after the cascade, in the column and on the rail (the later .n-grey utility never wins)', () => {
  for (const id of ['nav-running-count', 'nav-schedules-count']) {
    assert.equal(cascadedColor(doc.getElementById(id)), 'var(--ink-2)', `#${id} in the column`);
  }
  const aside = doc.querySelector('aside.sidebar');
  aside.classList.add('collapsed');
  try {
    assert.equal(cascadedColor(doc.getElementById('nav-schedules-count')), 'var(--ink-2)', 'on the rail');
  } finally { aside.classList.remove('collapsed'); }
  assert.equal(cascadedColor(doc.getElementById('nav-needs-count')), 'var(--amber-ink-strong)', 'the pill keeps its own amber ink');
});

test('Ask Worca names the sidebar\'s Running actions as rows, not the old card', () => {
  for (const f of ['src/core/ask/tools.mjs', 'src/core/ask/prompt.mjs']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /Running actions card/, f);
    assert.match(src, /Running actions rows/, f);
  }
});

test('Running actions: the column shows four rows before they scroll inside the foot; the Stop square is --ink-2', () => {
  assert.equal(ruleBody('.side-actions-rows .act-rows'), 'max-height:107px;overflow-y:auto;scrollbar-width:thin');
  assert.match(ruleBody('.act-stop'), /color:var\(--ink-2\);/, 'a control\'s glyph needs 3:1; --ink-3 is 2.8:1');
});

test('Running actions rows keep 26px when they scroll and keep their focus ring inside; the rail card fits the window; labels keep their descenders', () => {
  assert.match(ruleBody('.act-srow'), /^display:flex;flex:none;/, 'never shrunk by the 107px cap (five rows were squashed to 22px)');
  assert.equal(ruleBody('.act-srow .act-stop:focus-visible,.act-srow .act-srow-name:focus-visible'), 'outline-offset:-2px',
    'the ring sits inside the control: the rows\' scroll box clips anything outside');
  assert.equal(ruleBody('.act-fly'), 'width:236px;max-height:calc(100vh - 16px);overflow-y:auto');
  assert.match(ruleBody('.nav button > span:not(.nav-count)'), /overflow:hidden;text-overflow:ellipsis;line-height:1\.4;/,
    'overflow:hidden at line-height:1 clipped g, p and y');
});
