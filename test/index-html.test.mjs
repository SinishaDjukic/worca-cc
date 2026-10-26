// test/index-html.test.mjs — the shell carries the flags from the first paint (D5): <html data-flags>
// lists what is on, #flag-gates hides what is off, and omitting flags is today's output byte for byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkRows } from './helpers/rows.mjs';
import { renderIndexHtml, INDEX_THEME_ANCHOR, FLAG_GATES_ANCHOR } from '../src/core/index-html.mjs';

const shell = readFileSync(new URL('../ui/public/index.html', import.meta.url), 'utf8');
const mini = `<!DOCTYPE html>\n${INDEX_THEME_ANCHOR}<head>${FLAG_GATES_ANCHOR}</head><body>x</body></html>`;

test('renderIndexHtml with flags', async () => {
  await checkRows([
    { name: 'the real shell has both anchors, the gates after the stylesheet', run: () => {
      assert.ok(shell.includes(INDEX_THEME_ANCHOR));
      assert.ok(shell.indexOf(FLAG_GATES_ANCHOR) > shell.indexOf('href="/style.css"'));
    } },
    { name: 'on: data-flags lists it, no gate rule for it', run: () => {
      const out = renderIndexHtml(mini, 'dark', 'simple', { flagsDemo: true, keepAwake: true, shapeFirst: true, runTags: true, runPresets: true, commandSummaries: true, runLabels: true, smartRunNaming: true, requirements: true, workflowTests: true, runTelemetry: true });
      assert.match(out, /<html lang="en" data-theme="dark" data-level="simple" data-flags="flagsDemo keepAwake shapeFirst runTags runPresets commandSummaries runLabels smartRunNaming requirements workflowTests runTelemetry">/);
      assert.match(out, /<style id="flag-gates"><\/style>/);
    } },
    { name: 'off: empty data-flags and one rule per off flag', run: () => {
      const out = renderIndexHtml(mini, 'light', undefined, { flagsDemo: false, keepAwake: false, shapeFirst: false, runTags: false, runPresets: false, commandSummaries: false, runLabels: false, smartRunNaming: false, requirements: false, workflowTests: false, runTelemetry: false });
      assert.match(out, /<html lang="en" data-theme="light" data-flags="">/);
      assert.match(out, /<style id="flag-gates">\[data-flag~="flagsDemo"\]\{display:none!important\}\n\[data-flag~="keepAwake"\]\{display:none!important\}\n\[data-flag~="shapeFirst"\]\{display:none!important\}\n\[data-flag~="runTags"\]\{display:none!important\}\n\[data-flag~="runPresets"\]\{display:none!important\}\n\[data-flag~="commandSummaries"\]\{display:none!important\}\n\[data-flag~="runLabels"\]\{display:none!important\}\n\[data-flag~="smartRunNaming"\]\{display:none!important\}\n\[data-flag~="requirements"\]\{display:none!important\}\n\[data-flag~="workflowTests"\]\{display:none!important\}\n\[data-flag~="runTelemetry"\]\{display:none!important\}<\/style>/);
    } },
    { name: 'flags omitted ⇒ byte-for-byte what it rendered before', run: () => {
      assert.equal(renderIndexHtml(mini, 'system'), mini);
      assert.equal(renderIndexHtml(mini, 'dark', 'expert'), mini.replace(INDEX_THEME_ANCHOR, '<html lang="en" data-theme="dark" data-level="expert">'));
    } },
    { name: 'flags given but the gates anchor is gone: throws', run: () => {
      assert.throws(() => renderIndexHtml(`${INDEX_THEME_ANCHOR}<head></head>`, 'dark', 'simple', {}), /flag-gates anchor missing/);
    } },
    { name: 'git: data-git after data-level / data-flags; omitted ⇒ no attribute', run: () => {
      assert.match(renderIndexHtml(mini, 'dark', 'simple', undefined, { git: false }), /<html lang="en" data-theme="dark" data-level="simple" data-git="off">/);
      assert.match(renderIndexHtml(mini, 'light', 'expert', { flagsDemo: true, keepAwake: false, shapeFirst: false, runTags: false }, { git: true }),
        /<html lang="en" data-theme="light" data-level="expert" data-flags="flagsDemo" data-git="on">/);
      assert.equal(renderIndexHtml(mini, 'dark', 'expert'), mini.replace(INDEX_THEME_ANCHOR, '<html lang="en" data-theme="dark" data-level="expert">'));
    } },
  ]);
});
