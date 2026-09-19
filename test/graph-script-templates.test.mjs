// test/graph-script-templates.test.mjs
// The scaffold templates (spec §5.2, §6): ONE source for the Scripts page's
// create flow, `worca script new` and `worca plugin new-script`. Pure module —
// no WORCA_HOME, no fs beyond reading scripts-view.mjs as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  SCRIPT_TEMPLATES, SCRIPT_WIN32_TEMPLATE, SHELL_COMMAND_TEMPLATE, blankScriptMeta,
  scriptSourceTemplate, scriptMetaTemplate, sampleCasesTemplate,
} from '../src/shared/graph/script-templates.mjs';
import * as scriptsView from '../ui/public/scripts-view.mjs';
import { normalizeCases } from '../src/shared/graph/script-cases.mjs';
import { SCRIPT_RUNTIMES, validateScriptMetaV2, normalizeScriptMeta } from '../src/shared/graph/script-meta.mjs';

test('the moved constants keep their landed bodies, LF-only', () => {
  assert.match(SCRIPT_TEMPLATES.node, /^export default async function \(\{ inputs, outputs, params, ctx, log \}\) \{/m);
  assert.match(SCRIPT_TEMPLATES.node, /return \{ summary: 'ok' \};/);
  assert.match(SCRIPT_TEMPLATES.shell, /^#!\/bin\/sh$/m);
  assert.match(SCRIPT_TEMPLATES.python, /^def main\(api\):$/m);
  assert.equal(SHELL_COMMAND_TEMPLATE, 'npm test');
  // Byte-identical to the landed P1c constant (test/ui-script-detail.test.mjs pins
  // it too): LF in memory, and the WRITER (script-store programText) makes it CRLF.
  assert.equal(SCRIPT_WIN32_TEMPLATE, '@echo off\necho hello from a worca script\n');
  assert.equal(SCRIPT_TEMPLATES.shell.includes('\r'), false);
  assert.equal(SCRIPT_TEMPLATES.node.includes('\r'), false);
  assert.equal(SCRIPT_TEMPLATES.python.includes('\r'), false);
});

test('scripts-view.mjs re-exports the four moved names BY IDENTITY', () => {
  assert.equal(scriptsView.SCRIPT_TEMPLATES, SCRIPT_TEMPLATES);
  assert.equal(scriptsView.SCRIPT_WIN32_TEMPLATE, SCRIPT_WIN32_TEMPLATE);
  assert.equal(scriptsView.SHELL_COMMAND_TEMPLATE, SHELL_COMMAND_TEMPLATE);
  assert.equal(scriptsView.blankScriptMeta, blankScriptMeta);
  const src = readFileSync(fileURLToPath(new URL('../ui/public/scripts-view.mjs', import.meta.url)), 'utf8');
  assert.match(src, /from '\.\.\/\.\.\/src\/shared\/graph\/script-templates\.mjs'/,
    'depth 2 from ui/public/ — the shared module, never a copy');
  assert.doesNotMatch(src, /export const SCRIPT_TEMPLATES =/, 'the bodies live in the shared module alone');
});

test('scriptSourceTemplate picks the runtime body, or the win32 half', () => {
  assert.equal(scriptSourceTemplate('node'), SCRIPT_TEMPLATES.node);
  assert.equal(scriptSourceTemplate('python'), SCRIPT_TEMPLATES.python);
  assert.equal(scriptSourceTemplate('shell'), SCRIPT_TEMPLATES.shell);
  assert.equal(scriptSourceTemplate('shell', { win32: true }), SCRIPT_WIN32_TEMPLATE);
  assert.equal(scriptSourceTemplate('perl'), SCRIPT_TEMPLATES.node, 'an unknown runtime falls back to node');
});

test('scriptMetaTemplate validates as meta v2 for every runtime this host knows, with no ports', () => {
  for (const runtime of SCRIPT_RUNTIMES) {
    const meta = scriptMetaTemplate('runTests', runtime);
    assert.deepEqual(validateScriptMetaV2(meta).errors, [], `${runtime}: ${JSON.stringify(validateScriptMetaV2(meta).errors)}`);
    assert.equal(meta.key, 'runTests');
    assert.equal(meta.metaVersion, 2);
    assert.equal(meta.runtime, runtime);
    assert.deepEqual(meta.outputs, [], 'the templates write no output, so none may be declared');
  }
  assert.equal(scriptMetaTemplate('runTests', 'node').file, 'runTests.mjs');
  assert.deepEqual(scriptMetaTemplate('runTests', 'shell').file, { default: 'runTests.sh', win32: 'runTests.cmd' });
});

test('sampleCasesTemplate: one scratch case that normalizes clean as a SHIPPED case', () => {
  const meta = normalizeScriptMeta(scriptMetaTemplate('runTests', 'node')).meta;
  const raw = sampleCasesTemplate(meta);
  assert.equal(raw.version, 1);
  const { cases, errors } = normalizeCases(raw, meta, { shipped: true });
  assert.deepEqual(errors, []);
  assert.equal(cases.length, 1);
  assert.equal(cases[0].id, 'sample');
  assert.deepEqual(cases[0].cwd, { kind: 'scratch' });
  assert.deepEqual(cases[0].inputs, {});
  assert.deepEqual(cases[0].expect, { verdict: 'clean', fired: [] });
});

test('sampleCasesTemplate: void inputs fire, json inputs parse, required params get a value', () => {
  const meta = normalizeScriptMeta({
    key: 'k', metaVersion: 2, displayName: 'k', runtime: 'node', file: 'k.mjs',
    params: [
      { id: 'command', type: 'command', required: true },
      { id: 'depth', type: 'number', default: 3 },
      { id: 'mode', type: 'enum', options: ['fast', 'slow'], required: true },
    ],
    inputs: [{ id: 'done', type: 'void', required: false }, { id: 'data', type: 'json', required: false }],
    outputs: [
      { id: 'log', type: 'md', when: 'always', filename: 'k-cycle{cycle}.md' },
      { id: 'pass', type: 'void', when: 'clean' },
      { id: 'fail', type: 'md', when: 'blocking', filename: 'k-cycle{cycle}.md' },
    ],
    verdict: { filename: 'k-cycle{cycle}.json' },
  }).meta;
  const kase = sampleCasesTemplate(meta).cases[0];
  assert.deepEqual(kase.inputs, { done: { fired: true }, data: { text: '{}\n' } });
  assert.deepEqual(kase.params, { command: '', depth: 3, mode: 'fast' });
  assert.deepEqual(kase.expect.fired, ['log', 'pass'], 'a clean run does not fire a blocking output');
  assert.deepEqual(normalizeCases(sampleCasesTemplate(meta), meta, { shipped: true }).errors, []);
});
