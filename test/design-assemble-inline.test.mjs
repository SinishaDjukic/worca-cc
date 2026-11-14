// test/design-assemble-inline.test.mjs
// Plan Task 11: standalone export and inline assets (SPEC C-7), and the classifyRef / scanCssUrls helpers.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, rmSync, symlinkSync, truncateSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { assembleDesign, STANDALONE_MAX_FILE_BYTES, STANDALONE_MAX_TOTAL_BYTES } from '../src/core/design/assemble.mjs';
import { classifyRef, scanCssUrls } from '../src/core/design/html-scan.mjs';

// The world, SHELL, BASE and PLAN shapes of test/design-assemble.test.mjs (Task 10).
const SHELL = '<!doctype html><html><head><meta charset="utf-8"><!--worca:head--></head><body><main><!--worca:sections--></main><!--worca:foot--></body></html>';
const s = (id, parts) => ({ id, job: id, brief: 'b', parts, estHeight: 100 });
const PLAN = { v: 1, kind: 'web', title: 'T', canvas: { w: 1440 }, notes: '', sections: [s('hero', ['html', 'css', 'js']), s('pricing', ['html', 'css']), s('footer', ['html'])] };
const BASE = { 'shell.html': SHELL, 'tokens.css': ':root{--a:1}', 'global.css': 'body{margin:0}', 'global.js': 'window.G=1;',
  'sections/hero/index.html': '<section data-section="hero"><h1>Ship</h1></section>',
  'sections/hero/style.css': '[data-section="hero"] h1{color:red}',
  'sections/hero/script.js': 'root.dataset.ok="1";',
  'sections/pricing/index.html': '<section data-section="pricing">P</section>',
  'sections/pricing/style.css': '[data-section="pricing"]{top:0}',
  '.crew.json': JSON.stringify([{ id: 'hero', status: 'done', summary: 's' }, { id: 'pricing', status: 'writing', summary: '' }]) };
const dirs = []; after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
function world(files = BASE) {
  const d = mkdtempSync(join(tmpdir(), 'dasmi-')); dirs.push(d);
  const work = join(d, 'work'); mkdirSync(work);
  for (const [rel, text] of Object.entries(files)) { mkdirSync(dirname(join(work, rel)), { recursive: true }); writeFileSync(join(work, rel), text); }
  return work;
}

test('classifyRef', () => {
  for (const r of ['', '#x', 'data:image/png;base64,AA', 'blob:x', 'about:blank', 'mailto:a@b', 'tel:1']) assert.equal(classifyRef(r).type, 'skip', r);
  for (const r of ['https://x.dev/a.png', 'http://x/a', '//x.dev/a.png', 'HTTPS://X/a']) assert.equal(classifyRef(r).type, 'remote', r);
  for (const r of ['../secret', 'assets/../../secret', '/etc/passwd', '\\\\host\\x', '..\\..\\x', 'file:///etc/passwd', 'C:/x', 'javascript:alert(1)', '.kit/x.js', 'assets/.hidden/x.png', '%2e%2e/secret', '%zz', 'a\0b']) assert.equal(classifyRef(r).type, 'escaped', r);
  for (const [r, rel] of [['assets/x.png', 'assets/x.png'], ['./assets/x.png', 'assets/x.png'], ['assets/my%20logo.png?v=2#a', 'assets/my logo.png'], ['sections/hero/assets/a.svg#i', 'sections/hero/assets/a.svg'], ['assets\\x.png', 'assets/x.png'], ['assets/../assets/x.png', 'assets/x.png']]) assert.deepEqual(classifyRef(r), { type: 'local', rel }, r);
});

test('classifyRef: decoding comes before the escape checks, and a browser drops tabs and newlines from a URL', () => {
  for (const r of ['assets%2F..%2F..%2Fx', 'a%00b', '%2Fetc/passwd', '%43:/x', 'assets/%2ehidden/x', 'assets%5C..%5C..%5Cx', ' jav\tascript:alert(1)']) assert.equal(classifyRef(r).type, 'escaped', r);
  assert.equal(classifyRef('ht\ntps://x.dev/a.png').type, 'remote');
  assert.deepEqual(classifyRef('  assets/lo\tgo.png '), { type: 'local', rel: 'assets/logo.png' });
  // A URL parser also strips every leading and trailing C0 control, which String#trim keeps.
  for (const r of ['\x01https://x.dev/a.png', '\x1f//x.dev/a.png', 'https://x.dev/a.png\x08', '\x00\x0e https://x.dev/a.png']) assert.equal(classifyRef(r).type, 'remote', JSON.stringify(r));
  assert.deepEqual(classifyRef('\x02assets/x.png\x1f'), { type: 'local', rel: 'assets/x.png' });
  // A space is one of them: it can sit between two controls on either edge.
  assert.equal(classifyRef('\x01 \x01https://x.dev/a.png').type, 'remote');
  assert.deepEqual(classifyRef('assets/x.png\x1f \x1f'), { type: 'local', rel: 'assets/x.png' });
});

test('scanCssUrls: url() and @import targets only, quotes excluded; comments and other strings are skipped', () => {
  const css = '@import "a.css"; @IMPORT url( \'b.css\' ); x{background:url(c.png) , URL("d e.png")} /* url(no.png) */ y{content:"\\"url(no2.png)";mask:xurl(no3.png)} z{src:url( f.woff2 ) format("woff2")} q{b:url("g\\".png")}';
  const got = scanCssUrls(css);
  assert.deepEqual(got.map((u) => u.value), ['a.css', 'b.css', 'c.png', 'd e.png', 'f.woff2', 'g\\".png']);
  for (const u of got) assert.equal(css.slice(u.start, u.end), u.value);
  assert.deepEqual(scanCssUrls('/* url(a.png)'), [], 'an unclosed comment runs to the end');
  assert.deepEqual(scanCssUrls('a{b:url(x y.png)}c{d:url(z.png'), [{ value: 'z.png', start: 25, end: 30 }], 'a bad url() is no URL; one cut off by the end still is');
  assert.deepEqual(scanCssUrls(''), []);
});

const PNG = Buffer.from([1, 2, 3]); const B64 = PNG.toString('base64');
const withRefs = (html, css = '', extra = {}) => { const w = world({ ...BASE, 'sections/hero/index.html': `<section data-section="hero">${html}</section>`, 'sections/hero/style.css': css, ...extra }); mkdirSync(join(w, 'assets'), { recursive: true }); writeFileSync(join(w, 'assets', 'logo.png'), PNG); return w; };

test('standalone: every local reference becomes data:, in attributes, srcset and CSS; the page needs nothing beside it', () => {
  const work = withRefs('<img src="assets/logo.png" srcset="assets/logo.png 1x, assets/logo.png 2x"><div style="background:url(assets/logo.png)"></div><svg><image href="assets/logo.png"/></svg><video poster="assets/logo.png"></video><a href="assets/logo.png">keep</a>',
    '[data-section="hero"]{background:url("assets/logo.png")}');
  const r = assembleDesign({ workDir: work, plan: PLAN, mode: 'standalone' });
  const uri = `data:image/png;base64,${B64}`;
  assert.equal(r.html.includes('src="assets/logo.png"'), false);
  assert.equal(r.html.includes('url("assets/logo.png")'), false);
  assert.ok(r.html.includes(`src="${uri}"`));
  assert.ok(r.html.includes(`${uri} 1x, ${uri} 2x`));
  assert.ok(r.html.includes(`url("${uri}")`));
  assert.ok(r.html.includes('poster="data:'));
  assert.ok(r.html.includes(`style="background:url(${uri})"`), 'a style= value; an unquoted url stays unquoted');
  assert.ok(r.html.includes(`<image href="${uri}"/>`));
  assert.equal(r.html.split('assets/logo.png').length - 1, 1, 'only the plain link keeps the path');
  assert.ok(r.html.includes('href="assets/logo.png">keep'), 'a plain link is not a resource');
  assert.deepEqual(r.problems, []);
});

test('inlining edits the raw markup by span: entities, quote styles, srcset descriptors, CSS comments and strings stay as written', () => {
  const work = withRefs('<img alt=\'a "b"\' src=\'assets/l&#111;go.png\' title=x><img src=assets/logo.png data-x="1"><img srcset="assets/l&#111;go.png 1x,assets/logo.png  2x" sizes="1px"><img srcset="assets/logo.png,, assets/logo.png 2x"><a href="assets/logo.png" style="background:url(assets/l&#111;go.png)">k</a><svg><style/></svg><p>url(assets/logo.png)</p><img src="assets/a&amp;b.png" alt="z"><video src = "assets/logo.png"></video><link rel="stylesheet" href="assets/x.css"><script src="assets/x.js"></script>',
    '/* url(assets/logo.png) */ [data-section="hero"]::after{content:"url(assets/logo.png)";background:url( assets/logo.png )}', { 'assets/a&b.png': 'AB', 'assets/x.css': 'C', 'assets/x.js': 'J' });
  const r = assembleDesign({ workDir: work, plan: PLAN, mode: 'standalone' });
  const uri = `data:image/png;base64,${B64}`;
  const b64 = (t) => Buffer.from(t).toString('base64');
  for (const yes of [`<img alt='a "b"' src='${uri}' title=x>`, `<img src=${uri} data-x="1">`, `srcset="${uri} 1x,${uri}  2x" sizes="1px"`, `srcset="${uri},, ${uri} 2x"`, `<video src = "${uri}"></video>`,
    `href="data:text/css;base64,${b64('C')}"`, `<script src="data:text/javascript;base64,${b64('J')}"></script>`,
    `<a href="assets/logo.png" style="background:url(${uri})">k</a>`, '<svg><style/></svg><p>url(assets/logo.png)</p>', `src="data:image/png;base64,${Buffer.from('AB').toString('base64')}" alt="z">`,
    '/* url(assets/logo.png) */', 'content:"url(assets/logo.png)"', `background:url( ${uri} )`]) assert.ok(r.html.includes(yes), yes);
  assert.deepEqual(r.problems, []);
});

test('inlining reaches a section filled through a shell slot; an export keeps no slot', () => {
  const shell = '<!doctype html><html><head><!--worca:head--></head><body><div data-worca-slot="hero"></div><div data-worca-slot="footer"></div><!--worca:sections--><!--worca:foot--></body></html>';
  const r = assembleDesign({ workDir: withRefs('<img src="assets/logo.png">', '', { 'shell.html': shell }), plan: PLAN, mode: 'standalone' });
  assert.ok(r.html.includes(`src="data:image/png;base64,${B64}"`));
  assert.equal(r.html.includes('data-worca-'), false, 'footer failed, so its slot is gone too');
  assert.deepEqual(r.problems, []);
});

test('standalone reports what it could not embed, once each, and leaves the reference', () => {
  const r = assembleDesign({ workDir: withRefs('<img src="https://x.dev/a.png"><img src="assets/gone.png"><img src="../../secret.png"><img src="assets/gone.png">'), plan: PLAN, mode: 'standalone' });
  assert.deepEqual(r.problems.sort((a, b) => a.ref.localeCompare(b.ref)), [
    { ref: '../../secret.png', why: 'escaped' }, { ref: 'assets/gone.png', why: 'missing' }, { ref: 'https://x.dev/a.png', why: 'remote' }]);
  assert.ok(r.html.includes('src="https://x.dev/a.png"'));
});

test('standalone never embeds what escapes work', { skip: process.platform === 'win32' ? 'POSIX' : false }, () => {
  const work = withRefs('<img src="assets/secret.png"><img src="assets/dir/secret.txt"><img src="assets/dir/x.png"><img src="assets/dir/no/such/x.png">');
  const secret = join(dirname(work), 'secret.txt');
  writeFileSync(secret, 'TOKEN-abc');
  symlinkSync(secret, join(work, 'assets', 'secret.png'));
  symlinkSync(dirname(work), join(work, 'assets', 'dir'));
  const r = assembleDesign({ workDir: work, plan: PLAN, mode: 'standalone' });
  assert.equal(r.html.includes(Buffer.from('TOKEN-abc').toString('base64')), false);
  assert.deepEqual(r.problems.map((p) => p.why).sort(), ['escaped', 'escaped', 'escaped', 'escaped'], 'a missing file behind an outward link is escaped, not missing, however deep the missing rest');
});

const cpuMs = (fn) => { const t = process.cpuUsage(); fn(); const u = process.cpuUsage(t); return (u.user + u.system) / 1000; };

test('a long local reference costs CPU linear in its length, and one past any OS path limit is missing (cpu)', () => {
  for (const chars of [64_000, 256_000]) {
    const ref = `${'a/'.repeat(chars / 2)}x.png`;
    const work = withRefs(`<img src="${ref}">`);
    let r;
    const ms = cpuMs(() => { r = assembleDesign({ workDir: work, plan: PLAN, mode: 'standalone' }); });
    assert.ok(ms < 1000, `${chars} chars: ${ms} ms of CPU`);
    assert.deepEqual(r.problems, [{ ref, why: 'missing' }], `${chars} chars`);
  }
  // Under the bound, each missing reference costs a few realpaths, not one per folder in it.
  const refs = Array.from({ length: 200 }, (_, i) => `${'a/'.repeat(1500)}x${i}.png`);
  const work = withRefs(refs.map((ref) => `<img src="${ref}">`).join(''));
  let r;
  const ms = cpuMs(() => { r = assembleDesign({ workDir: work, plan: PLAN, mode: 'standalone' }); });
  assert.ok(ms < 1000, `200 distinct 3000-char references: ${ms} ms of CPU`);
  assert.deepEqual(r.problems, refs.map((ref) => ({ ref, why: 'missing' })));
});

test('a reference whose path no OS opens is missing, even where links would shorten it to a file', { skip: process.platform === 'win32' ? 'POSIX' : false }, () => {
  const work = withRefs('');
  symlinkSync('.', join(work, 'a'));
  symlinkSync('.', join(work, 'é'));
  // A reference to a real file whose path below the real work folder is exactly `bytes` long (PATH_MAX counts bytes).
  const sized = (bytes) => {
    const n = 20 + ((bytes - Buffer.byteLength(realpathSync(work))) & 1);
    const name = `${'f'.repeat(n - 4)}.png`;
    writeFileSync(join(work, 'assets', name), PNG);
    return `${'a/'.repeat((bytes - Buffer.byteLength(realpathSync(work)) - 8 - n) / 2)}assets/${name}`;
  };
  const short = `${'a/'.repeat(3)}assets/logo.png`;
  const long = `${'a/'.repeat(2100)}assets/logo.png`;
  const wide = `${'é/'.repeat(1400)}assets/logo.png`;
  const [fits, over] = [sized(4095), sized(4096)];
  const refs = [short, fits, long, wide, over];
  writeFileSync(join(work, 'sections/hero/index.html'), `<section data-section="hero">${refs.map((ref) => `<img src="${ref}">`).join('')}</section>`);
  const r = assembleDesign({ workDir: work, plan: PLAN, mode: 'standalone' });
  assert.equal(r.html.split(`<img src="data:image/png;base64,${B64}">`).length - 1, 2, 'through the links, the short path and the 4095-byte one are the file');
  assert.deepEqual(r.problems, [long, wide, over].map((ref) => ({ ref, why: 'missing' })), 'a browser cannot open the others either: the é path is under 4096 UTF-16 units, but over 4096 bytes');
  for (const ref of [long, wide, over]) assert.ok(r.html.includes(`<img src="${ref}">`));
});

test('a FIFO, a folder and a dangling link are missing: never read, never blocking', { skip: process.platform === 'win32' ? 'POSIX' : false }, () => {
  const work = withRefs('<img src="assets/pipe.png"><img src="assets"><img src="assets/dangling.png">');
  assert.equal(spawnSync('mkfifo', [join(work, 'assets', 'pipe.png')]).status, 0);
  symlinkSync(join(work, 'assets', 'nothing.png'), join(work, 'assets', 'dangling.png'));
  const r = assembleDesign({ workDir: work, plan: PLAN, mode: 'standalone' });
  assert.deepEqual(r.problems, [{ ref: 'assets/pipe.png', why: 'missing' }, { ref: 'assets', why: 'missing' }, { ref: 'assets/dangling.png', why: 'missing' }]);
  assert.equal(r.html.includes('src="data:'), false);
});

test('over the size limits: reported, not embedded', () => {
  const work = withRefs('<img src="assets/huge.png">');
  const huge = join(work, 'assets', 'huge.png');
  writeFileSync(huge, ''); truncateSync(huge, STANDALONE_MAX_FILE_BYTES + 1);
  assert.deepEqual(assembleDesign({ workDir: work, plan: PLAN, mode: 'standalone' }).problems, [{ ref: 'assets/huge.png', why: 'too-large' }]);
});

test('the total limit counts every embedded copy: a file referenced again and again cannot grow the page past it', () => {
  const work = withRefs('<img src="assets/a.png"><img src="assets/a.png"><img src="assets/a.png"><img src="assets/b.png"><img src="assets/c.png"><img src="assets/a.png">');
  for (const n of ['a', 'b', 'c']) { const f = join(work, 'assets', `${n}.png`); writeFileSync(f, ''); truncateSync(f, STANDALONE_MAX_FILE_BYTES); }
  assert.equal(4 * STANDALONE_MAX_FILE_BYTES, STANDALONE_MAX_TOTAL_BYTES, 'the fixture fills the total with four copies');
  const r = assembleDesign({ workDir: work, plan: PLAN, mode: 'standalone' });
  assert.deepEqual(r.problems, [{ ref: 'assets/c.png', why: 'too-large' }, { ref: 'assets/a.png', why: 'too-large' }], 'c, then the fourth a, are past the total');
  let copies = 0;
  for (let at = r.html.indexOf('src="data:'); at >= 0; at = r.html.indexOf('src="data:', at + 1)) copies += 1;
  assert.equal(copies, 4, 'a three times, then b');
  assert.ok(r.html.includes('<img src="assets/c.png"><img src="assets/a.png"></section>'), 'what is past the total stays as written');
});

test('inline:true embeds for build and run too; the bridge is added after, untouched', () => {
  const work = withRefs('<img src="assets/logo.png">');
  const B = '<script data-worca-bridge src="assets/logo.png"></script>';
  const r = assembleDesign({ workDir: work, plan: PLAN, mode: 'run', bridge: B, inline: true });
  assert.ok(r.html.includes(B));
  assert.ok(r.html.includes(`src="data:image/png;base64,${B64}"`));
  assert.equal(assembleDesign({ workDir: work, plan: PLAN, mode: 'run' }).html.includes('src="assets/logo.png"'), true, 'off by default');
});
