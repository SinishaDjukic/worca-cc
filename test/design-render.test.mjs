// test/design-render.test.mjs
// Design P6 Task 1: rendering with no model JS (L6.1, L6.2, L6.20). `staticDoc` is pure; `runChrome` and the queue run
// on fake children, so no real Chrome starts here (the PDF probe is `tools/design-pdf-probe.mjs`, run by hand, M14).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, getEventListeners } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { staticDoc, renderCsp, runChrome, createRenderQueue, designChrome } from '../src/core/design/render.mjs';
import { chromeNoSandbox, pdfArgs, screenshot } from '../assets/deck-preview/chrome.mjs';
import { previewCsp } from '../src/core/design/preview-doc.mjs';

const HOSTILE = '<!doctype html><!-- <head> --><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=https://x"><base href="https://x/"></head><body onload="evil()"><script>evil()</script><iframe src="x"></iframe><a href="javascript:evil()">a</a><p>Keep</p></body></html>';

test('staticDoc: the CSP is the first thing parsed, and nothing active survives', () => {
  const out = staticDoc(HOSTILE);
  assert.ok(out.startsWith(`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${renderCsp()}">`));
  for (const no of ['evil()', 'url=https://x', '<base', '<iframe', '<script']) assert.equal(out.includes(no), false, no);
  assert.ok(out.includes('<p>Keep</p>'));
  assert.equal(renderCsp(), "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'");
  assert.ok(staticDoc('<p>x</p>').startsWith('<meta charset="utf-8"><meta http-equiv="Content-Security-Policy"'));
  assert.ok(staticDoc(String.fromCharCode(0xa0) + '<!doctype html><p>x</p>').startsWith('<meta charset="utf-8"><meta http-equiv="Content-Security-Policy"'), 'NBSP is not HTML whitespace: a meta after that doctype would land in <body> and be ignored');
  assert.equal(renderCsp({ nonce: 'N' }), previewCsp({ mode: 'build', base: null, nonce: 'N' }).replace('sandbox allow-scripts; ', ''));
});
test('staticDoc reads the whole doc, and keeps no model script', () => {
  const big = staticDoc(`<!doctype html><img src="data:image/png;base64,${'A'.repeat(9 * 1024 * 1024)}"><p>Keep</p>`);
  assert.ok(big.endsWith('<p>Keep</p>'), 'past the 8 MiB scan bound');
  assert.equal(staticDoc('<script nonce="none">m()</script><script nonce="N1">m()</script>', { nonce: 'N1', kitScript: 'k()' }).includes('m()'), false);
  assert.equal(staticDoc('</x <script>m()</script>>').includes('<script'), false, 'an opener the strip pass read as text is escaped too');
});
test('staticDoc drops every link: a preconnect or prefetch opens a connection no CSP directive governs', () => {
  const out = staticDoc('<!doctype html><html><head><link rel="preconnect" href="http://127.0.0.1:9/"><LINK rel=dns-prefetch href=//x.example>'
    + '<link\trel="modulepreload" href="https://x.example/m.js"/><link rel="stylesheet" href="https://fonts.x/css"></head>'
    + '<body><p>Keep</p><svg><link href="x"/></svg><div title="<link rel=preconnect href=//y>">t</div></body></html>');
  assert.equal(/<link/i.test(out), false, out);
  assert.ok(out.includes('<p>Keep</p>'));
  assert.equal(out.includes('rel="preconnect" href="http://127.0.0.1:9/"'), false, 'the tag goes, never left as text');
  assert.ok(staticDoc('<p>a <linked> b</p>').includes('<linked>'), 'only the link element');
});
test('designChrome: none means none', () => assert.equal(designChrome({ WORCA_CHROME: 'none', PATH: '' }), null));
test('staticDoc with a kit: only the kit runs', () => {
  const out = staticDoc('<!doctype html><html><head></head><body><deck-stage><section>S</section></deck-stage><script>model()</script></body></html>', { nonce: 'N1', kitScript: 'define("</script>");' });
  assert.equal(out.includes('model()'), false);
  assert.ok(out.includes('<script nonce="N1">define("<\\/script>");</script>'));
  assert.ok(out.includes("script-src 'nonce-N1'"));
  assert.ok(out.includes('<deck-stage><section>S</section></deck-stage>'));
  assert.throws(() => staticDoc('<p>x</p>', { kitScript: 'k()' }), TypeError, 'a kit with no nonce could never run');
  assert.throws(() => staticDoc('<p>x</p>', { nonce: '"><script>x()</script>', kitScript: 'k()' }), TypeError, 'the nonce lands in an attribute');
});
test('pdfArgs is the deck recipe, with no fresh profile', () => {
  const a = pdfArgs({ htmlPath: '/p/a b.html', pdfPath: '/p/a.pdf' });
  for (const yes of ['--headless=new', '--no-pdf-header-footer', '--virtual-time-budget=10000', '--print-to-pdf=/p/a.pdf']) assert.ok(a.includes(yes), yes);
  assert.equal(a.at(-1), pathToFileURL('/p/a b.html').href);   // a drive letter on Windows
  assert.equal(a.some((x) => x.startsWith('--user-data-dir')), false);
  assert.ok(pdfArgs({ htmlPath: '/a', pdfPath: '/b', noSandbox: true }).includes('--no-sandbox'));
  assert.equal(chromeNoSandbox({ CHROME_NO_SANDBOX: '1' }), true);
  assert.equal(chromeNoSandbox({}), process.getuid?.() === 0, 'root always runs without the sandbox');
  const dir = mkdtempSync(join(tmpdir(), 'drc-shot-')); let argv = null;
  screenshot('c', { htmlPath: join(dir, 'a.html'), pngPath: join(dir, 'a.png'), width: 1, height: 1 }, { env: { CHROME_NO_SANDBOX: '1' }, run: (cmd, args) => { argv = args; return { status: 1 }; } });
  assert.ok(argv.includes('--no-sandbox'), 'screenshot reads its own env option');
  rmSync(dir, { recursive: true, force: true });
});
const child = (behave) => (file, args, opts) => { const c = new EventEmitter(); Object.assign(c, { pid: 7, exitCode: null, signalCode: null, opts }); queueMicrotask(() => behave(c)); return c; };
test('runChrome: judged by the file, killed on timeout and abort, never rejects', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drc-')); const out = join(dir, 'o.png'); const kills = [];
  const kill = (c, sig) => kills.push(sig);
  writeFileSync(out, 'stale');
  let opts = null;
  assert.deepEqual(await runChrome('c', [], { outFile: out, timeoutMs: 50, kill, spawnImpl: (f, a, o) => { opts = o; return child((c) => c.emit('close', 1))(f, a, o); } }), { ok: false, reason: 'no output (exit 1)' });
  assert.deepEqual(opts, { stdio: 'ignore', detached: process.platform !== 'win32', windowsHide: true }, 'its own process group, so the kill reaches its helpers');
  assert.deepEqual(await runChrome('c', [], { outFile: out, timeoutMs: 50, kill, spawnImpl: child((c) => { writeFileSync(out, 'x'); c.emit('close', 0); }) }), { ok: true });
  assert.deepEqual(await runChrome('c', [], { outFile: out, timeoutMs: 10, kill, spawnImpl: child((c) => writeFileSync(out, 'x')) }), { ok: true }, 'wrote, then never exited');
  assert.deepEqual(kills, ['SIGKILL']);
  rmSync(out);
  assert.deepEqual(await runChrome('c', [], { outFile: out, timeoutMs: 10, kill, spawnImpl: child(() => {}) }), { ok: false, reason: 'timed out' });
  assert.deepEqual(kills, ['SIGKILL', 'SIGKILL'], 'a timeout with nothing written kills it too');
  const ac = new AbortController(); queueMicrotask(() => ac.abort());
  assert.deepEqual(await runChrome('c', [], { outFile: out, timeoutMs: 1000, signal: ac.signal, kill, spawnImpl: child(() => {}) }), { ok: false, reason: 'aborted' });
  assert.deepEqual(kills, ['SIGKILL', 'SIGKILL', 'SIGKILL'], 'an abort kills Chrome');
  const wrote = new AbortController();
  const late = runChrome('c', [], { outFile: out, timeoutMs: 1000, signal: wrote.signal, kill, spawnImpl: child(() => writeFileSync(out, 'x')) });
  queueMicrotask(() => wrote.abort());
  assert.deepEqual(await late, { ok: false, reason: 'aborted' }, 'an abort answers aborted even when the file is there');
  assert.equal(kills.length, 4);
  const kept = new AbortController();
  assert.deepEqual(await runChrome('c', [], { outFile: out, timeoutMs: 50, signal: kept.signal, kill, spawnImpl: child((c) => { writeFileSync(out, 'x'); c.emit('close', 0); }) }), { ok: true });
  assert.equal(getEventListeners(kept.signal, 'abort').length, 0, 'a settled run leaves no listener on the request\'s signal');
  kept.abort();
  assert.equal(kills.length, 4, 'and a later abort kills nothing');
  let spawned = 0;
  assert.deepEqual(await runChrome('c', [], { outFile: out, timeoutMs: 10, signal: AbortSignal.abort(), kill, spawnImpl: (...a) => { spawned += 1; return child(() => {})(...a); } }), { ok: false, reason: 'aborted' });
  assert.equal(spawned, 0, 'an aborted request starts no Chrome');
  assert.deepEqual(await runChrome('c', [], { outFile: out, timeoutMs: 50, kill, spawnImpl: child((c) => c.emit('error', new Error('ENOENT'))) }), { ok: false, reason: 'ENOENT' });
  rmSync(dir, { recursive: true, force: true });
});
test('runChrome: Chrome resolves no host name, so a page it renders looks up nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drc-dns-')); const out = join(dir, 'o.png'); let argv = null;
  await runChrome('c', ['--a', 'file:///x'], { outFile: out, timeoutMs: 50, kill: () => {}, spawnImpl: (f, a, o) => { argv = a; return child((c) => c.emit('close', 1))(f, a, o); } });
  assert.deepEqual(argv, ['--host-resolver-rules=MAP * ~NOTFOUND', '--a', 'file:///x']);
  rmSync(dir, { recursive: true, force: true });
});
test('the queue runs one at a time; front goes first', async () => {
  const q = createRenderQueue(); const order = []; let open;
  const a = q.run(() => new Promise((r) => { open = r; order.push('a'); }));
  const b = q.run(async () => order.push('b')); const c = q.run(async () => order.push('c'), { front: true });
  open(); await Promise.all([a, b, c]);
  assert.deepEqual(order, ['a', 'c', 'b']);
});
