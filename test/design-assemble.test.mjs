// test/design-assemble.test.mjs
// Plan Task 10: the Design assembler for build, run and dist (SPEC C-7), and its html-scan helpers.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync, symlinkSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { assembleDesign, BRIDGE_MARKER, readConfined } from '../src/core/design/assemble.mjs';
import { HTML_MAX_DEPTH, HTML_MAX_SCAN_LENGTH, scanShellSlots, stripActive } from '../src/core/design/html-scan.mjs';
import { DesignError } from '../src/core/design/ids.mjs';

const SHELL = '<!doctype html><html><head><meta charset="utf-8"><!--worca:head--></head><body><main><!--worca:sections--></main><!--worca:foot--></body></html>';
const SLOTTED = '<!doctype html><html><head><meta charset="utf-8"><!--worca:head--></head><body><div class="band"><div data-worca-slot="pricing"></div><div data-worca-slot="hero"></div></div><main><!--worca:sections--></main><!--worca:foot--></body></html>';
const bodied = (body) => `<!doctype html><html><head><!--worca:head--></head><body>${body}<!--worca:sections--><!--worca:foot--></body></html>`;
const BRIDGE = '<script data-worca-bridge>B</script>';
const BAD_SHELL = (e) => e instanceof DesignError && e.code === 'BAD_SHELL';
const s = (id, parts) => ({ id, job: id, brief: 'b', parts, estHeight: 100 });
const PLAN = { v: 1, kind: 'web', title: 'T', canvas: { w: 1440 }, notes: '', sections: [s('hero', ['html', 'css', 'js']), s('pricing', ['html', 'css']), s('footer', ['html'])] };
const BASE = { 'shell.html': SHELL, 'tokens.css': ':root{--a:1}', 'global.css': 'body{margin:0}', 'global.js': 'window.G=1;',
  'sections/hero/index.html': '<section data-section="hero"><h1>Ship</h1></section>',
  'sections/hero/style.css': '[data-section="hero"] h1{color:red}',
  'sections/hero/script.js': 'root.dataset.ok="1";',
  'sections/pricing/index.html': '<section data-section="pricing">P</section>',
  'sections/pricing/style.css': '[data-section="pricing"]{top:0}',
  '.crew.json': JSON.stringify([{ id: 'hero', status: 'done', summary: 's' }, { id: 'pricing', status: 'writing', summary: '' }]) };
const FOOTER = { 'sections/footer/index.html': '<footer data-section="footer">F</footer>' };
const dirs = []; after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
function world(files = BASE) {
  const d = mkdtempSync(join(tmpdir(), 'dasm-')); dirs.push(d);
  const work = join(d, 'work'); mkdirSync(work);
  for (const [rel, text] of Object.entries(files)) { mkdirSync(dirname(join(work, rel)), { recursive: true }); writeFileSync(join(work, rel), text); }
  return work;
}
const ordered = (html, parts) => parts.reduce((at, p) => { const i = html.indexOf(p, at); assert.ok(i >= 0, `after ${at}: ${p}`); return i + p.length; }, 0);
const count = (html, p) => html.split(p).length - 1;

test('run: bridge first in head, CSS in order, sections in plan order, JS last, one IIFE per section', () => {
  const r = assembleDesign({ workDir: world(), plan: PLAN, mode: 'run', bridge: BRIDGE });
  assert.ok(r.html.startsWith(`<!doctype html><html><head>${BRIDGE}`));
  ordered(r.html, [BRIDGE, '<meta charset', 'data-worca-css="tokens"', 'data-worca-css="global"', 'data-worca-css="hero"', 'data-worca-css="pricing"', '</head>', '<h1>Ship</h1>', '<section data-section="pricing">', '</main>', 'window.G=1;', 'root.dataset.ok="1";']);
  assert.ok(r.html.includes(`(function(root){\nroot.dataset.ok="1";\n})(document.querySelector('[data-section="hero"]'));`));
  assert.equal(count(r.html, '<script>'), 2, 'global.js and each section get their own element, so one syntax error stays local');
  assert.deepEqual(r.sections, [{ id: 'hero', state: 'included' }, { id: 'pricing', state: 'included' }, { id: 'footer', state: 'missing' }]);
  assert.equal(r.html.includes('worca:'), false);
  assert.equal(assembleDesign({ workDir: world(), plan: PLAN, mode: 'run' }).html.includes('data-worca-bridge'), false);
});

test('build: finished sections per .crew.json, slots for the rest, no model JS', () => {
  const r = assembleDesign({ workDir: world(), plan: PLAN, mode: 'build', bridge: BRIDGE });
  assert.equal(count(r.html, '<script'), 1, 'the bridge only');
  for (const yes of ['<h1>Ship</h1>', '<div data-worca-slot="pricing"></div>', '<div data-worca-slot="footer"></div>', 'data-worca-css="tokens"', 'data-worca-css="global"', 'data-worca-css="hero"']) assert.ok(r.html.includes(yes), yes);
  for (const no of ['root.dataset.ok', 'window.G', '<section data-section="pricing">', 'data-worca-css="pricing"']) assert.equal(r.html.includes(no), false, no);
  assert.deepEqual(r.sections.map((x) => x.state), ['included', 'slot', 'slot']);
  const active = world({ ...BASE, 'sections/hero/index.html': '<section data-section="hero"><script>alert(1)</script><iframe src="x"></iframe><object data="x"></object><embed src="x"><h1>K</h1></section>', 'shell.html': SHELL.replace('</body>', '<script>evil()</script></body>') });
  const b = assembleDesign({ workDir: active, plan: PLAN, mode: 'build', bridge: BRIDGE }).html;
  for (const no of ['alert(1)', '<iframe', '<object', '<embed', 'evil()']) assert.equal(b.includes(no), false, no);
  assert.ok(b.includes('<h1>K</h1>'));
  assert.ok(assembleDesign({ workDir: active, plan: PLAN, mode: 'run' }).html.includes('alert(1)'), 'run keeps them');
  const trap = world({ ...BASE, 'sections/hero/index.html': '<section data-section="hero"><h1>K</h1><object data="x"></section>' });
  assert.ok(assembleDesign({ workDir: trap, plan: PLAN, mode: 'build', bridge: BRIDGE }).html.includes('<section data-section="hero"><h1>K</h1></section>'), 'an implied close keeps the parent close tag');
});

test('shell slots: filled in place, in any order; the rest go to the marker in plan order; CSS and JS stay in plan order', () => {
  const r = assembleDesign({ workDir: world({ ...BASE, ...FOOTER, 'shell.html': SLOTTED }), plan: PLAN, mode: 'run' });
  assert.ok(r.html.includes('<div class="band"><section data-section="pricing">P</section><section data-section="hero"><h1>Ship</h1></section></div><main><footer data-section="footer">F</footer></main>'));
  ordered(r.html, ['data-worca-css="hero"', 'data-worca-css="pricing"', '</main>', 'window.G=1;', 'root.dataset.ok="1";']);
  assert.equal(r.html.includes('data-worca-slot'), false);
  assert.deepEqual(r.sections, [{ id: 'hero', state: 'included' }, { id: 'pricing', state: 'included' }, { id: 'footer', state: 'included' }]);
  const two = assembleDesign({ workDir: world({ ...BASE, ...FOOTER, 'shell.html': bodied('<div data-worca-slot="hero"></div>') }), plan: PLAN, mode: 'run' }).html;
  assert.ok(two.includes('<section data-section="pricing">P</section>\n<footer data-section="footer">F</footer>'), 'the marker takes them joined by a newline');
});

test('shell slots in build: the same include-or-placeholder rule, in place', () => {
  const r = assembleDesign({ workDir: world({ ...BASE, 'shell.html': SLOTTED }), plan: PLAN, mode: 'build', bridge: BRIDGE });
  assert.ok(r.html.includes('<div class="band"><div data-worca-slot="pricing"></div><section data-section="hero"><h1>Ship</h1></section></div><main><div data-worca-slot="footer"></div></main>'));
  assert.deepEqual(r.sections.map((x) => x.state), ['included', 'slot', 'slot']);
  const early = assembleDesign({ workDir: world({ 'shell.html': SLOTTED }), plan: null, mode: 'build', bridge: BRIDGE });
  assert.ok(early.html.includes('<div class="band"><div data-worca-slot="pricing"></div><div data-worca-slot="hero"></div></div>'), 'plan.json is written last: the layout already shows');
  assert.deepEqual(early.sections, []);
});

test('a slot-like string in a section, a comment or a script is never expanded', () => {
  const inner = '<section data-section="hero"><div data-worca-slot="pricing"></div><!--worca:sections--><div data-worca-slot="hero"></div></section>';
  const r = assembleDesign({ workDir: world({ ...BASE, 'shell.html': SLOTTED, 'sections/hero/index.html': inner }), plan: PLAN, mode: 'run' });
  assert.ok(r.html.includes(inner), 'copied verbatim');
  assert.equal(count(r.html, '<section data-section="pricing">'), 1);
  const note = '<!-- <div data-worca-slot="hero"></div> -->';
  const code = '<script>const t = \'<div data-worca-slot="hero"></div><!--worca:foot-->\';</script>';
  const c = assembleDesign({ workDir: world({ ...BASE, 'shell.html': SHELL.replace('<main>', `${note}${code}<main>`) }), plan: PLAN, mode: 'run' }).html;
  assert.ok(c.includes(note + code), 'both left as they are');
  assert.ok(c.includes('<main><section data-section="hero">'), 'hero has no slot, so it goes to the marker');
});

test('every section has a slot: <!--worca:sections--> may be absent, or present and then empty; otherwise it is required', () => {
  const ALL = '<!doctype html><html><head><!--worca:head--></head><body><div data-worca-slot="footer"></div><div data-worca-slot="hero"></div><div data-worca-slot="pricing"></div>#<!--worca:foot--></body></html>';
  for (const shell of [ALL.replace('#', ''), ALL.replace('#', '<!--worca:sections-->')]) {
    const r = assembleDesign({ workDir: world({ ...BASE, ...FOOTER, 'shell.html': shell }), plan: PLAN, mode: 'run' });
    assert.equal(r.html.includes('worca:'), false);
    ordered(r.html, ['<footer data-section="footer">', '<section data-section="hero">', '<section data-section="pricing">', 'window.G=1;']);
  }
  const most = ALL.replace('#', '').replace('<div data-worca-slot="footer"></div>', '');
  for (const mode of ['run', 'dist', 'standalone']) assert.throws(() => assembleDesign({ workDir: world({ ...BASE, 'shell.html': most }), plan: PLAN, mode }), (e) => BAD_SHELL(e) && /footer/.test(e.message), mode);
  const fallback = assembleDesign({ workDir: world({ ...BASE, 'shell.html': most }), plan: PLAN, mode: 'build', bridge: BRIDGE });
  assert.ok(fallback.html.includes('<div data-worca-slot="footer"></div>'), 'build falls back to DEFAULT_SHELL and loses nothing');
  assert.throws(() => assembleDesign({ workDir: world({ ...BASE, 'shell.html': SHELL.replace('<!--worca:sections-->', '<!--worca:sections--><!--worca:sections-->') }), plan: PLAN, mode: 'run' }), BAD_SHELL, 'twice');
});

test('unknown, duplicate and failed slots', () => {
  const ghost = '<div data-worca-slot="ghost"></div>';
  const u = world({ ...BASE, 'shell.html': bodied(ghost) });
  assert.equal(assembleDesign({ workDir: u, plan: PLAN, mode: 'run' }).html.includes('ghost'), false, 'a stale slot leaves nothing in a finished page');
  assert.ok(assembleDesign({ workDir: u, plan: PLAN, mode: 'build', bridge: BRIDGE }).html.includes(ghost), 'build keeps it');
  const d = world({ ...BASE, 'shell.html': bodied('<div data-worca-slot="hero"></div><i>x</i><div data-worca-slot="hero"></div>') });
  for (const [mode, extra] of [['run', {}], ['build', { bridge: BRIDGE }]]) {
    const html = assembleDesign({ workDir: d, plan: PLAN, mode, ...extra }).html;
    assert.equal(count(html, '<h1>Ship</h1>'), 1, mode);
    assert.ok(html.includes('<h1>Ship</h1></section><i>x</i>'), `${mode}: the first slot wins`);
    assert.equal(count(html, 'data-worca-slot="hero"'), 0, mode);
  }
  const noHero = { ...BASE, 'shell.html': bodied('<i>a</i><div data-worca-slot="hero"></div><i>b</i>') };
  delete noHero['sections/hero/index.html'];
  const r = assembleDesign({ workDir: world(noHero), plan: PLAN, mode: 'run' });
  assert.equal(r.sections[0].state, 'missing');
  assert.ok(r.html.includes('<i>a</i><i>b</i>'), 'a failed section leaves no placeholder in a finished page');
  const b = assembleDesign({ workDir: world(noHero), plan: PLAN, mode: 'build', bridge: BRIDGE });
  assert.equal(b.sections[0].state, 'slot');
  assert.ok(b.html.includes('<i>a</i><div data-worca-slot="hero"></div><i>b</i>'));
});

test('what counts as a slot', () => {
  for (const good of ["<div data-worca-slot='hero'></div>", '<div data-worca-slot=hero></div>', '<div data-worca-slot="hero">\n  </div>', '<div class="x" data-worca-slot="hero"></div>', '<DIV DATA-WORCA-SLOT="hero"></DIV>']) {
    const html = assembleDesign({ workDir: world({ ...BASE, 'shell.html': bodied(`<i>a</i>${good}<i>b</i>`) }), plan: PLAN, mode: 'run' }).html;
    assert.ok(html.includes('<i>a</i><section data-section="hero"><h1>Ship</h1></section><i>b</i>'), good);
  }
  for (const bad of ['<div data-worca-slot="hero">x</div>', '<div data-worca-slot="hero"><b></b></div>', '<div data-worca-slot="hero"><!-- x --></div>', '<div data-worca-slot="hero"/>', '<div data-worca-slot="hero">', '<section data-worca-slot="hero"></section>', '<div data-worca-slot=""></div>', '<div data-worca-slot></div>', '<b><div data-worca-slot="hero"></b>']) {
    const w = world({ ...BASE, 'shell.html': bodied(bad) });
    assert.throws(() => assembleDesign({ workDir: w, plan: PLAN, mode: 'run' }), BAD_SHELL, bad);
    assert.equal(assembleDesign({ workDir: w, plan: PLAN, mode: 'build', bridge: BRIDGE }).html.includes(bad), false, `${bad}: build falls back to DEFAULT_SHELL`);
  }
  const scan = scanShellSlots('<div data-worca-slot="a"></div><div class="x" data-worca-slot="b"></div><p data-worca-slot="c"></p>');
  assert.deepEqual(scan.map((x) => [x.id, x.ok, x.extraAttrs]), [['a', true, false], ['b', true, true], ['c', false, false]]);
  assert.deepEqual([scan[0].start, scan[0].end], [0, '<div data-worca-slot="a"></div>'.length]);
});

test('build tolerates the first seconds: no plan, no shell, or a shell without markers', () => {
  const empty = world({});
  const r = assembleDesign({ workDir: empty, plan: null, mode: 'build', bridge: BRIDGE });
  assert.ok(r.html.includes(BRIDGE)); assert.deepEqual(r.sections, []);
  assert.equal(assembleDesign({ workDir: world({ 'shell.html': '<p>draft' }), plan: PLAN, mode: 'build', bridge: BRIDGE }).sections.length, 3);
});

test('the strict modes refuse a bad shell', () => {
  for (const mode of ['run', 'dist', 'standalone']) {
    assert.throws(() => assembleDesign({ workDir: world({}), plan: PLAN, mode }), BAD_SHELL, `${mode} no shell`);
    assert.throws(() => assembleDesign({ workDir: world({ 'shell.html': SHELL.replace('<!--worca:foot-->', '') }), plan: PLAN, mode }), BAD_SHELL, `${mode} no foot`);
    assert.throws(() => assembleDesign({ workDir: world({ 'shell.html': SHELL.replace('<!--worca:head-->', '<!--worca:head--><!--worca:head-->') }), plan: PLAN, mode }), BAD_SHELL, `${mode} twice`);
    assert.throws(() => assembleDesign({ workDir: world({ 'shell.html': SHELL.replace('<!--worca:sections-->', '') }), plan: PLAN, mode }), BAD_SHELL, `${mode} no marker and no slots`);
  }
  assert.throws(() => assembleDesign({ workDir: world(), plan: PLAN, mode: 'film' }), (e) => e.code === 'BAD_REQUEST');
  const noHead = { ...BASE, 'shell.html': '<body><!--worca:head--><!--worca:sections--><!--worca:foot--></body>', 'sections/hero/index.html': '<section data-section="hero"><head></head></section>' };
  assert.throws(() => assembleDesign({ workDir: world(noHead), plan: PLAN, mode: 'run', bridge: BRIDGE }), BAD_SHELL, 'a <head> in filled text never counts');
  const late = { ...BASE, 'shell.html': '<!doctype html><html><!--worca:head--><head></head><body><!--worca:sections--><!--worca:foot--></body></html>' };
  assert.throws(() => assembleDesign({ workDir: world(late), plan: PLAN, mode: 'run', bridge: BRIDGE }), BAD_SHELL, 'a head after a marker');
  assert.equal(assembleDesign({ workDir: world(late), plan: PLAN, mode: 'run' }).sections[0].state, 'included', 'without a bridge the head rule does not apply');
});

test('the bridge: must carry its marker; dist and standalone refuse it and never contain it (C-7)', () => {
  assert.throws(() => assembleDesign({ workDir: world(), plan: PLAN, mode: 'run', bridge: '<script>B</script>' }), (e) => e.code === 'BAD_REQUEST');
  for (const b of ['<div data-worca-bridge></div>', '<script>"data-worca-bridge"</script>', `${BRIDGE}<p>x</p>`]) assert.throws(() => assembleDesign({ workDir: world(), plan: PLAN, mode: 'run', bridge: b }), (e) => e.code === 'BAD_REQUEST', b);
  for (const mode of ['dist', 'standalone']) {
    assert.throws(() => assembleDesign({ workDir: world(), plan: PLAN, mode, bridge: BRIDGE }), (e) => e.code === 'BAD_REQUEST', mode);
    for (const shell of [SHELL, SLOTTED, bodied('<div data-worca-slot="ghost"></div>')]) {
      const html = assembleDesign({ workDir: world({ ...BASE, 'shell.html': shell }), plan: PLAN, mode }).html;
      assert.equal(html.includes(BRIDGE_MARKER), false, mode);
      assert.equal(html.includes('data-worca-'), false, `${mode}: no worca attribute at all`);
      assert.ok(html.includes('data-section="hero"'), 'data-section stays (L16)');
    }
  }
});

test('dist: writes index.html and assets only, no dot folders, replaces what was there', () => {
  const work = world({ ...BASE, 'assets/logo.png': 'L', 'sections/hero/assets/a.svg': 'A', '.kit/k.js': 'K', '.asks/a_1.json': '{}', 'assets/.hidden': 'H' });
  const dist = join(dirname(work), 'dist');
  mkdirSync(dist); writeFileSync(join(dist, 'stale.html'), 'x');
  const r = assembleDesign({ workDir: work, plan: PLAN, mode: 'dist' });
  assert.equal(r.distDir, dist);
  assert.deepEqual(r.files, ['assets/logo.png', 'index.html', 'sections/hero/assets/a.svg']);
  assert.equal(existsSync(join(dist, 'stale.html')), false);
  assert.equal(readFileSync(join(dist, 'index.html'), 'utf8'), r.html);
  assert.deepEqual(readdirSync(dirname(work)).sort(), ['dist', 'work'], 'no temp folder left');
});

test('confinement: what links out of work never reaches the page or dist', { skip: process.platform === 'win32' ? 'POSIX' : false }, () => {
  const work = world({ ...BASE, 'assets/logo.png': 'L' });
  const secret = join(dirname(work), 'secret.txt'); writeFileSync(secret, 'TOKEN-abc');
  symlinkSync(secret, join(work, 'assets', 'link.png'));
  mkdirSync(join(work, 'sections', 'footer')); symlinkSync(secret, join(work, 'sections', 'footer', 'index.html'));
  assert.equal(readConfined(work, '../secret.txt'), null);
  assert.equal(readConfined(work, 'sections/footer/index.html'), null, 'a section file linked outside');
  assert.equal(readConfined(work, 'sections'), null, 'a folder is not a file');
  const r = assembleDesign({ workDir: work, plan: PLAN, mode: 'dist' });
  assert.deepEqual([r.files, r.sections[2].state, r.html.includes('TOKEN-abc')], [['assets/logo.png', 'index.html'], 'missing', false]);
});

test('section text survives assembly verbatim', () => {
  const nasty = "<section data-section=\"hero\"><p>$& $' $` $1 $$ <!--worca:foot--></p></section>";
  const r = assembleDesign({ workDir: world({ ...BASE, 'sections/hero/index.html': nasty, 'sections/hero/script.js': 'const a = "</script>"; const b = "<!--"; // trailing',
    'sections/hero/style.css': '[data-section="hero"] a::after{content:"</STYLE>"}' }), plan: PLAN, mode: 'run' });
  assert.ok(r.html.includes(nasty));
  assert.ok(r.html.indexOf('</main>') < r.html.indexOf('window.G=1;'), 'the real foot marker was filled, not the one in the text');
  assert.ok(r.html.includes('"<\\/script>"'));
  assert.ok(r.html.includes('// trailing\n})('));
  assert.ok(r.html.includes('content:"<\\/STYLE>"'), 'case-insensitive, letters kept');
  assert.ok(r.html.includes('"<\\!--"'));
});

test('a missing section, a corrupt crew file', () => {
  const noHero = { ...BASE }; delete noHero['sections/hero/index.html'];
  const r = assembleDesign({ workDir: world(noHero), plan: PLAN, mode: 'run' });
  assert.deepEqual(r.sections.map((x) => x.state), ['missing', 'included', 'missing']);
  assert.ok(r.html.includes('<section data-section="pricing">'));
  assert.equal(r.html.includes('root.dataset.ok'), false, 'no script without its section');
  const b = assembleDesign({ workDir: world({ ...BASE, '.crew.json': '{not json' }), plan: PLAN, mode: 'build', bridge: BRIDGE });
  assert.deepEqual(b.sections.map((x) => x.state), ['slot', 'slot', 'slot']);
  for (const c of ['null', '{}', '7', '[null]']) assert.deepEqual(assembleDesign({ workDir: world({ ...BASE, '.crew.json': c }), plan: PLAN, mode: 'build', bridge: BRIDGE }).sections.map((x) => x.state), ['slot', 'slot', 'slot'], c);
  const gone = { ...BASE }; delete gone['sections/hero/index.html'];
  assert.equal(assembleDesign({ workDir: world(gone), plan: PLAN, mode: 'build', bridge: BRIDGE }).sections[0].state, 'slot', 'done, but the file is gone');
});

test('deterministic; BOM stripped; another kind assembles by the same rules', () => {
  const work = world();
  assert.equal(assembleDesign({ workDir: work, plan: PLAN, mode: 'run' }).html, assembleDesign({ workDir: work, plan: PLAN, mode: 'run' }).html);
  assert.equal(assembleDesign({ workDir: world({ ...BASE, 'sections/hero/index.html': '\uFEFF<section data-section="hero">x</section>' }), plan: PLAN, mode: 'run' }).html.includes('\uFEFF'), false);
  assert.equal(assembleDesign({ workDir: world(), plan: { ...PLAN, kind: 'pitch', canvas: { w: 1920, h: 1080 } }, mode: 'run' }).sections[0].state, 'included');
});

test('spans come from the markup: a close tag with a space before its > shifts nothing, and EOF ends an open element', () => {
  const shell = '<!doctype html><html><head><!--worca:head--></head><body><i></i ><div data-worca-slot="hero"></div ><main></main ><!--worca:sections--><!--worca:foot--></body></html>';
  const r = assembleDesign({ workDir: world({ ...BASE, 'shell.html': shell }), plan: PLAN, mode: 'run', bridge: BRIDGE });
  assert.ok(r.html.includes('<i></i ><section data-section="hero"><h1>Ship</h1></section><main></main ><section data-section="pricing">P</section><script>window.G=1;</script>'));
  assert.equal(stripActive('<b></b ><script>x</script><i>k</i>'), '<b></b ><i>k</i>');
  assert.equal(stripActive('<section><object data="x"></span ></section>'), '<section></section>');
  assert.equal(stripActive('<p>a<script src="x'), '<p>a');
  assert.equal(stripActive('<p>a<embed src="x'), '<p>a');
  assert.equal(stripActive('a<embed src="x'), 'a');
  assert.equal(stripActive('<object><embed src="x"><p>k</p></object>i'), 'i', 'a nested span goes with its parent');
  assert.equal(scanShellSlots('<div data-worca-slot="a"><!doctype html></div>')[0].ok, false);
  for (const x of ['<p><![CDATA[><script>alert(1)</script>]]></p>', '<noscript><p title="</noscript><SCRIPT>alert(3)</script>"></p></noscript>', '<svg><p><style><!--</style><script>alert(1)</script>--></style></p></svg>']) {
    assert.equal(/<(script|iframe|object|embed)/i.test(stripActive(x)), false, `a browser parses it otherwise: ${x}`);
  }
  const slot = '<div data-worca-slot="a"></div >';
  assert.deepEqual(scanShellSlots(`<b></b >${slot}<i></i>`).map((x) => [x.start, x.end, x.ok]), [[8, 8 + slot.length, true]]);
});

test('confinement: a section folder linked outside work gives dist nothing; a FIFO is not a file', { skip: process.platform === 'win32' ? 'POSIX' : false }, () => {
  const work = world();
  assert.equal(spawnSync('mkfifo', [join(work, 'pipe.txt')]).status, 0);
  assert.equal(readConfined(work, 'pipe.txt'), null, 'never read, never blocks');
  const outside = join(dirname(work), 'outside');
  mkdirSync(join(outside, 'assets'), { recursive: true });
  writeFileSync(join(outside, 'assets', 'k.png'), 'TOKEN-abc');
  writeFileSync(join(outside, 'index.html'), '<footer data-section="footer">TOKEN-abc</footer>');
  symlinkSync(outside, join(work, 'sections', 'footer'));
  const r = assembleDesign({ workDir: work, plan: PLAN, mode: 'dist' });
  assert.deepEqual([r.files, r.sections[2].state, r.html.includes('TOKEN-abc')], [['index.html'], 'missing', false]);
});

test('edges the plan rows leave open: bridges, markers inside a comment, a second foot, and plan: null keeps slots in run', () => {
  const nested = assembleDesign({ workDir: world({ ...BASE, 'shell.html': SHELL.replace('<!--worca:head-->', '<!-- note <!--worca:head--><!--worca:head-->') }), plan: PLAN, mode: 'run' }).html;
  assert.ok(nested.includes('<!-- note <!--worca:head--><style data-worca-css="tokens">'), 'only a whole comment is a marker');
  assert.throws(() => assembleDesign({ workDir: world({ ...BASE, 'shell.html': SHELL.replace('<!--worca:foot-->', '<!--worca:foot--><!--worca:foot-->') }), plan: PLAN, mode: 'run' }), BAD_SHELL, 'foot twice');
  for (const b of ['<script data-worca-bridge>B', '<script data-worca-bridge>B\n', `<!--x-->${BRIDGE}`, `${BRIDGE}${BRIDGE}`, `x${BRIDGE}`, `${BRIDGE}</div>`, `</head>${BRIDGE}`]) assert.throws(() => assembleDesign({ workDir: world(), plan: PLAN, mode: 'run', bridge: b }), (e) => e.code === 'BAD_REQUEST', b);
  assert.ok(assembleDesign({ workDir: world({ 'shell.html': SLOTTED }), plan: null, mode: 'run' }).html.includes('<div data-worca-slot="pricing"></div><div data-worca-slot="hero"></div>'));
});

test('build: markup that becomes an active element only where a fill meets the shell or another fill is stripped too', () => {
  const crew = (...ids) => JSON.stringify(ids.map((id) => ({ id, status: 'done', summary: '' })));
  const pricing = (head) => `${head}<section data-section="pricing">P</section>`;
  const cases = [
    // the shell alone: build fills the foot with ''
    { 'shell.html': '<!doctype html><html><head><!--worca:head--></head><body><!--worca:sections-->a<<!--worca:foot-->script>alert(1)</script></body></html>' },
    // a done section ending `<scr` in a slot, the shell going on `ipt>`
    { 'shell.html': bodied('<div data-worca-slot="hero"></div>ipt>alert(2)</script>'), 'sections/hero/index.html': '<section data-section="hero">x</section><scr', '.crew.json': crew('hero') },
    // two adjacent slots
    { 'shell.html': bodied('<div data-worca-slot="hero"></div><div data-worca-slot="pricing"></div>'), 'sections/hero/index.html': '<section data-section="hero">x</section><scr',
      'sections/pricing/index.html': pricing('ipt>alert(3)</script>'), '.crew.json': crew('hero', 'pricing') },
    // a slot, then the marker
    { 'shell.html': bodied('<div data-worca-slot="hero"></div>'), 'sections/hero/index.html': '<section data-section="hero">x</section><ifr',
      'sections/pricing/index.html': pricing('ame src="https://x.dev/"></iframe>'), '.crew.json': crew('hero', 'pricing') },
    // an active open tag cut off by the end of the text
    { 'shell.html': `${SHELL}<script` },
  ];
  for (const files of cases) {
    const html = assembleDesign({ workDir: world(files), plan: PLAN, mode: 'build', bridge: BRIDGE }).html;
    assert.equal(html.match(/<script/gi).length, 1, `the bridge only: ${html}`);
    assert.equal(/<(iframe|object|embed)/i.test(html), false, html);
  }
});

test('nesting past HTML_MAX_DEPTH: build keeps what comes before it, the strict modes refuse such a shell, standalone reports it', () => {
  const deep = (n, inner = '') => `${'<div>'.repeat(n)}${inner}`;
  const hero = `<section data-section="hero"><h1>kept</h1>${deep(HTML_MAX_DEPTH + 5, '<p>gone</p><script>alert(1)</script>')}</section>`;
  const b = assembleDesign({ workDir: world({ ...BASE, 'sections/hero/index.html': hero }), plan: PLAN, mode: 'build', bridge: BRIDGE });
  assert.equal(b.sections[0].state, 'included');
  assert.ok(b.html.includes('<h1>kept</h1>'));
  assert.equal(b.html.includes('gone'), false, 'nothing past the cut reaches the page');
  assert.equal(count(b.html, '<script'), 1);
  const deepShell = `<!doctype html><html><head><!--worca:head--></head><body><!--worca:sections--><!--worca:foot-->${deep(HTML_MAX_DEPTH + 1)}</body></html>`;
  for (const mode of ['run', 'dist', 'standalone']) {
    assert.throws(() => assembleDesign({ workDir: world({ ...BASE, 'shell.html': deepShell }), plan: PLAN, mode }), (e) => BAD_SHELL(e) && /512/.test(e.message), mode);
  }
  assert.equal(count(assembleDesign({ workDir: world({ ...BASE, 'shell.html': deepShell }), plan: PLAN, mode: 'build', bridge: BRIDGE }).html, '<script'), 1);
  const atLimit = `<!doctype html><html><head><!--worca:head--></head><body><!--worca:sections--><!--worca:foot-->${deep(HTML_MAX_DEPTH - 2)}</body></html>`;
  assert.equal(assembleDesign({ workDir: world({ ...BASE, 'shell.html': atLimit }), plan: PLAN, mode: 'run' }).sections[0].state, 'included', 'html, body and 510 divs: exactly the limit is fine');
  const refs = `<section data-section="hero"><img src="assets/logo.png">${deep(HTML_MAX_DEPTH + 5, '<img src="assets/logo.png">')}</section>`;
  const s = assembleDesign({ workDir: world({ ...BASE, 'sections/hero/index.html': refs, 'assets/logo.png': 'L' }), plan: PLAN, mode: 'standalone' });
  assert.deepEqual(s.problems, [{ ref: 'index.html', why: 'too-large' }]);
  assert.deepEqual([count(s.html, 'src="data:'), count(s.html, 'src="assets/logo.png"')], [1, 1], 'embedded before the cut, left as written after it');
  const long = 'x'.repeat(HTML_MAX_SCAN_LENGTH);
  const longShell = `<!doctype html><html><head><!--worca:head--></head><body><!--worca:sections--><!--worca:foot-->${long}</body></html>`;
  assert.throws(() => assembleDesign({ workDir: world({ ...BASE, 'shell.html': longShell }), plan: PLAN, mode: 'run' }), (e) => BAD_SHELL(e) && /8 MiB/.test(e.message));
  const longPage = assembleDesign({ workDir: world({ ...BASE, 'sections/hero/index.html': `<section data-section="hero">${long}<img src="assets/logo.png"></section>`, 'assets/logo.png': 'L' }), plan: PLAN, mode: 'standalone' });
  assert.deepEqual(longPage.problems, [{ ref: 'index.html', why: 'too-large' }]);
  assert.equal(count(longPage.html, 'src="assets/logo.png"'), 1, 'past the length nothing is read, so nothing is embedded');
});

test('a <![CDATA[ anywhere, or markup in a raw-text body a browser reads as markup, makes the shell unreadable', () => {
  const slot = '<div data-worca-slot="hero"></div>';
  for (const [hidden, why] of [
    [SHELL.replace('<main>', `<main><![CDATA[>${slot}]]>`), /CDATA/], [SHELL.replace('<main>', '<svg><text><![CDATA[a < b]]></text></svg><main>'), /CDATA/],
    [SHELL.replace('<main>', `<svg><desc/><style>${slot}</style></svg><main>`), /raw-text/], [SHELL.replace('<main>', `<noscript><!--</noscript>${slot}--><main>`), /raw-text/],
  ]) {
    for (const mode of ['run', 'dist', 'standalone']) assert.throws(() => assembleDesign({ workDir: world({ ...BASE, 'shell.html': hidden }), plan: PLAN, mode }), (e) => BAD_SHELL(e) && why.test(e.message), mode);
    assert.equal(assembleDesign({ workDir: world({ ...BASE, 'shell.html': hidden }), plan: PLAN, mode: 'build', bridge: BRIDGE }).html.includes('<main>'), false, 'build falls back to DEFAULT_SHELL');
  }
  const logo = SHELL.replace('<main>', '<svg><title>Logo</title><style>.a{fill:red}</style></svg><main>');
  assert.equal(assembleDesign({ workDir: world({ ...BASE, 'shell.html': logo }), plan: PLAN, mode: 'run' }).sections[0].state, 'included', 'a raw-text body without markup reads the same');
});

test('build: the pass over the spliced page only escapes, so pieces each within HTML_MAX_DEPTH are kept whole together (m1)', () => {
  const hero = `<section data-section="hero">${'<div>'.repeat(HTML_MAX_DEPTH - 3)}<p>TAIL-a</p></section>`;
  const crew = JSON.stringify([{ id: 'hero', status: 'done', summary: '' }, { id: 'pricing', status: 'done', summary: '' }]);
  const b = assembleDesign({ workDir: world({ ...BASE, 'sections/hero/index.html': hero, '.crew.json': crew }), plan: PLAN, mode: 'build', bridge: BRIDGE });
  assert.deepEqual(b.sections.map((x) => x.state), ['included', 'included', 'slot']);
  assert.ok(b.html.includes('<p>TAIL-a</p>'), 'the section is whole');
  assert.ok(b.html.includes('<section data-section="pricing">P</section>'), 'and so is the next one');
  assert.ok(b.html.endsWith('</body></html>'));
});

test('dist: a failed copy throws IO, leaves no temp folder and keeps the old dist',{ skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'POSIX, not root' : false }, () => {
  const work = world({ ...BASE, 'assets/locked/x.png': 'X' });
  const dist = join(dirname(work), 'dist');
  mkdirSync(dist); writeFileSync(join(dist, 'old.html'), 'x');
  chmodSync(join(work, 'assets', 'locked'), 0);
  try {
    assert.throws(() => assembleDesign({ workDir: work, plan: PLAN, mode: 'dist' }), (e) => e instanceof DesignError && e.code === 'IO');
  } finally {
    chmodSync(join(work, 'assets', 'locked'), 0o755);
  }
  assert.deepEqual(readdirSync(dirname(work)).sort(), ['dist', 'work']);
  assert.ok(existsSync(join(dist, 'old.html')));
});
