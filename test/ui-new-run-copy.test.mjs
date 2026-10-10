// test/ui-new-run-copy.test.mjs — the page that starts a run is "New run" wherever a user (or Ask
// Worca) reads its name: the project page's button, the Ask card's hand-off, the hints and empty
// states that point at it, the policy help and Ask's own prompt. "pipeline" as a noun stays
// ("New pipelines are blocked until …" is about runs, not the page).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('every string that names the page reads "New run"', () => {
  for (const [file, text] of [
    ['ui/public/ask-panel.mjs', "'↗ Open in New run'"],
    ['ui/public/app.js', "'Onboard at least two projects (in New run) to create a workspace.'"],
    ['ui/public/app.js', "emptyText: 'No runs yet. Start one from New run.'"],
    ['ui/public/engine-settings-view.mjs', "hint: 'New run starts on this engine. You can still switch per run.'"],
    ['ui/public/memory-view.mjs', ' — pick another project on the New run page.`'],
    ['ui/public/models-view.mjs', "'Drops the built-ins from every model picker — New run, the Workflows view, Ask Worca, title generation."],
    ['ui/public/schedules-view.mjs', "', then describe the task — or use Schedule… next to Start run on New run.'"],
    ['ui/public/stats-view.mjs', "'No pipelines yet — run one from New run.'"],
    ['ui/public/ui-level.mjs', "adds: 'Shows: New run, Runs, Projects, Workflows (agents and scripts included), budget limits and Ask Worca.'"],
    ['src/core/ask/prompt.mjs', "The team\\'s default guardrail set only preselects the New run picker."],
    ['src/core/policy/registry.mjs', "help: 'What the New run picker starts on."],
  ]) assert.ok(read(file).includes(text), `${file}: ${text}`);
  const doc = new JSDOM(read('ui/public/index.html')).window.document;
  const find = (sel) => [doc, ...[...doc.querySelectorAll('template')].map((t) => t.content)].map((r) => r.querySelector(sel)).find(Boolean);
  assert.equal(find('.pd-new').textContent.trim(), 'New run', 'the project page\'s button');
  assert.match(find('#getting-started-card .gs-settings-text').textContent, /^The Getting started checklist walks through the first nine things/);
});

test('no user-visible "New pipeline" is left in the UI, Ask\'s prompt or the policy help (comments aside)', () => {
  const files = [
    'ui/public/index.html',
    ...readdirSync(new URL('../ui/public/', import.meta.url)).filter((f) => /\.(m?js)$/.test(f)).map((f) => `ui/public/${f}`),
    ...readdirSync(new URL('../src/core/ask/', import.meta.url)).filter((f) => f.endsWith('.mjs')).map((f) => `src/core/ask/${f}`),
    'src/core/policy/registry.mjs',
  ];
  assert.ok(files.length > 40, `${files.length} files`);
  // A comment starts a line or follows code and a space (`f(); // …`); `//` or `/*` inside a string (a URL,
  // `origin/*`) does not, so the strings around it are still read.
  const bare = (src) => src.replace(/(^|[\s;,(){}[\]])\/\*[\s\S]*?\*\//g, '$1').replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^\s*|[;,(){}[\]]\s+)\/\/.*$/gm, '$1');
  const left = files.flatMap((f) => [...bare(read(f)).matchAll(/.{0,40}\bNew[ -][Pp]ipeline(?!s)\b.{0,20}/g)].map((m) => `${f}: ${m[0].trim()}`));
  assert.deepEqual(left, []);
});
