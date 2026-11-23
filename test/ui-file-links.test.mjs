// test/ui-file-links.test.mjs — file paths in chat answers (issue 1064 §2): each form, code span vs fence, link text,
// ambiguous and unknown paths, streaming, the setting, the batch and the cache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createFileLinks } from '../ui/public/ask-file-links.mjs';

const TID = 'ask_0000f11e';
const tick = () => new Promise((r) => setTimeout(r, 0));
function setup(answers = {}, opts = {}) {
  const dom = new JSDOM('<div id="t"></div>');
  const doc = dom.window.document;
  const posts = [];
  const opened = [];
  let t = 0;
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    posts.push({ url, body });
    return { ok: true, json: async () => ({ root: opts.root ?? null, paths: Object.fromEntries(body.paths.map((p) => [p, answers[p] || { ok: false }])) }) };
  };
  const host = doc.getElementById('t');
  const fl = createFileLinks({ doc, fetch, threadId: () => TID, root: () => host, onOpen: (x) => opened.push(x), now: () => t,
    enabled: opts.enabled || (() => true) });
  return { doc, host, fl, posts, opened, advance: (ms) => { t += ms; } };
}
const A = { 'src/a.js': { ok: true, path: 'src/a.js', type: 'file', lines: 50 }, 'src/': { ok: true, path: 'src', type: 'dir' },
  'uniq.md': { ok: true, path: 'uniq.md', type: 'file', lines: 3 } };

test('confirmed paths become buttons (line clamped past the end); unknown and ambiguous stay text', async () => {
  const s = setup(A);
  s.host.innerHTML = '<p>see src/a.js:120, the folder src/ and app.js, uniq.md or nope/x.js</p>';
  s.fl.decorate(s.host); await tick(); await tick();
  const btns = [...s.host.querySelectorAll('button.ask-file-link')];
  assert.deepEqual(btns.map((b) => b.textContent), ['src/a.js:120', 'src/', 'uniq.md']);
  assert.equal(s.host.querySelectorAll('.ask-file-cand').length, 0);
  assert.match(s.host.textContent, /app\.js, uniq\.md or nope\/x\.js/);
  assert.match(btns[0].getAttribute('aria-label'), /^File src\/a\.js, line 50, opens in the panel$/);
  assert.ok(btns[1].classList.contains('is-dir'));
  btns[0].click();
  assert.deepEqual(s.opened, [{ threadId: TID, path: 'src/a.js', type: 'file', line: 50, endLine: null, root: null, member: null }]);
  assert.deepEqual(s.posts.map((p) => [p.url, p.body.threadId, p.body.paths.sort()]),
    [['/api/ask/files/resolve', TID, ['app.js', 'nope/x.js', 'src/', 'src/a.js', 'uniq.md']]]);
});

test('an inline code span links; a fenced block and a link\'s own words never', async () => {
  const s = setup(A);
  s.host.innerHTML = '<p>open <code>src/a.js:3</code></p><pre><code>src/a.js:4</code></pre><p><a href="https://x.example/src/a.js">src/a.js</a> and <code><a href="https://x.example/">src/a.js</a></code></p>';
  s.fl.decorate(s.host); await tick(); await tick();
  const btns = [...s.host.querySelectorAll('button.ask-file-link')];
  assert.equal(btns.length, 1);
  assert.equal(btns[0].parentNode.nodeName, 'CODE');
  assert.equal(btns[0].closest('p').textContent, 'open src/a.js:3');
  assert.equal(s.host.querySelector('pre code').textContent, 'src/a.js:4');
  assert.equal(s.host.querySelectorAll('a').length, 2);
});

test('the run root comes back on the link; a multi-word code span is not a path', async () => {
  const s = setup(A, { root: 'run:abcd1234' });
  s.host.innerHTML = '<p><code>npm run src/a.js</code> src/a.js</p>';
  s.fl.decorate(s.host); await tick(); await tick();
  const b = s.host.querySelector('button.ask-file-link');
  b.click();
  assert.equal(s.opened[0].root, 'run:abcd1234');
  assert.equal(s.host.querySelector('code').textContent, 'npm run src/a.js');
  assert.equal(s.host.querySelectorAll('button.ask-file-link').length, 1, 'the words inside the code span stay plain (M37)');
});

test('streaming asks nothing; the finished render asks once; within the TTL nothing is asked again', async () => {
  const s = setup(A);
  s.host.innerHTML = '<p>src/a.js</p>';
  s.fl.decorate(s.host, { live: true }); await tick();
  assert.equal(s.posts.length, 0);
  assert.ok(s.host.querySelector('.ask-file-cand'));
  s.host.innerHTML = '<p>src/a.js</p>';
  s.fl.decorate(s.host); await tick(); await tick();
  assert.equal(s.posts.length, 1);
  s.host.innerHTML = '<p>src/a.js again</p>';
  s.fl.decorate(s.host); await tick();
  assert.equal(s.posts.length, 1);
  assert.ok(s.host.querySelector('button.ask-file-link'), 'painted from the cache');
  s.advance(61_000);
  s.host.innerHTML = '<p>src/a.js</p>';
  s.fl.decorate(s.host); await tick(); await tick();
  assert.equal(s.posts.length, 2);
});

test('the setting off: nothing changes and nothing is asked', async () => {
  const s = setup(A, { enabled: () => false });
  s.host.innerHTML = '<p>src/a.js <code>src/a.js</code></p>';
  s.fl.decorate(s.host); await tick();
  assert.equal(s.host.innerHTML, '<p>src/a.js <code>src/a.js</code></p>');
  assert.equal(s.posts.length, 0);
});

test('at most 50 paths per request, one request in flight per chat (review minor 8)', async () => {
  const dom = new JSDOM('<div id="t"></div>');
  const doc = dom.window.document;
  const host = doc.getElementById('t');
  const sizes = [];
  let live = 0, peak = 0;
  const fetch = async (url, init) => {
    live += 1; peak = Math.max(peak, live);
    const body = JSON.parse(init.body);
    sizes.push(body.paths.length);
    await new Promise((r) => setTimeout(r, 5));
    live -= 1;
    return { ok: true, json: async () => ({ root: null, paths: {} }) };
  };
  const fl = createFileLinks({ doc, fetch, threadId: () => TID, root: () => host });
  host.innerHTML = `<p>${Array.from({ length: 120 }, (_, i) => `d/f${i}.js`).join(' ')}</p>`;
  fl.decorate(host);
  await new Promise((r) => setTimeout(r, 0));          // the first chunk is in flight now
  host.insertAdjacentHTML('beforeend', '<p>d/f1.js e/g1.js</p>');
  fl.decorate(host.lastElementChild);                 // a second pass meanwhile: d/f1.js is not asked twice, e/g1.js waits
  for (let i = 0; i < 50 && sizes.length < 4; i += 1) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(sizes, [50, 50, 20, 1]);
  assert.equal(peak, 1);
});

test('web links are announced: panel, new tab, untouched when the hint has nothing; none with the setting off', async () => {
  const hints = { 'https://docs.example.org/x': 'panel', 'https://github.com/a': 'tab', 'http://localhost:4317/#runs': null };
  const make = (enabled) => {
    const dom = new JSDOM('<div id="t"></div>');
    const doc = dom.window.document;
    const host = doc.getElementById('t');
    const fl = createFileLinks({ doc, fetch: async () => ({ ok: false }), threadId: () => TID, root: () => host,
      enabled: () => enabled, webHint: (h) => hints[h] ?? null });
    host.innerHTML = '<p><a href="https://docs.example.org/x">the <code>docs</code></a> <a href="https://github.com/a">repo</a> <a href="http://localhost:4317/#runs">home</a> <a href="mailto:a@b.c">mail</a></p>';
    fl.decorate(host);
    return [...host.querySelectorAll('a')].map((a) => a.getAttribute('aria-label'));
  };
  assert.deepEqual(make(true), ['the docs, opens in the panel', 'repo, opens in a new tab', null, null]);
  assert.deepEqual(make(false), [null, null, null, null]);
});

test('a failed request leaves plain text', async () => {
  const dom = new JSDOM('<div id="t"></div>');
  const doc = dom.window.document;
  const host = doc.getElementById('t');
  const fl = createFileLinks({ doc, fetch: async () => { throw new Error('offline'); }, threadId: () => TID, root: () => host });
  host.innerHTML = '<p>src/a.js</p>';
  fl.decorate(host); await tick(); await tick();
  assert.equal(host.querySelector('button'), null);
  assert.equal(host.textContent, 'src/a.js');
});
