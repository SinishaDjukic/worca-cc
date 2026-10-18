// test/ui-chat-name-copy.test.mjs — the assistant's page is "Chat" wherever a user reads its name: the Settings
// tab, notifications, hints, errors, the extension and the assistant's own prompt. Identifiers stay `ask`
// (data-tab="ask", askMaxTurns, the routes); only the words a person sees changed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const walk = (dir) => readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })
  .flatMap((e) => e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.(m?js)$/.test(e.name) ? [`${dir}/${e.name}`] : []);

test('the Settings tab and the assistant\'s prompt say Chat', () => {
  const doc = new JSDOM(read('ui/public/index.html')).window.document;
  assert.equal(doc.querySelector('[data-tab="ask"]').textContent.trim(), 'Chat');
  assert.ok(read('src/core/ask/prompt.mjs').includes("'You are worca\\'s Chat assistant, built into worca-cc ("));
  assert.ok(read('extension/src/background.mjs').includes("title: 'Ask Chat about selection'"));
});

test('no user-visible "Ask Worca" is left in the UI, the server, src or the extension (comments aside)', () => {
  const files = ['ui/public/index.html', 'ui/server.mjs', ...walk('ui/public'), ...walk('src'), ...walk('extension/src')];
  assert.ok(files.length > 100, `${files.length} files`);
  // Same comment stripper as test/ui-new-run-copy.test.mjs (a comment starts a line or follows code and a space),
  // plus the SQL ` -- ` comments in db.mjs's schema text.
  const bare = (src) => src.replace(/(^|[\s;,(){}[\]])\/\*[\s\S]*?\*\//g, '$1').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^\s*|[;,(){}[\]]\s+)\/\/.*$/gm, '$1').replace(/\s--\s.*$/gm, '');
  const left = files.flatMap((f) => [...bare(read(f)).matchAll(/.{0,40}\bAsk Worca\b.{0,20}/gi)].map((m) => `${f}: ${m[0].trim()}`));
  assert.deepEqual(left, []);
});
