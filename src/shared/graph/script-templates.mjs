// src/shared/graph/script-templates.mjs
// The program and the sidecar a NEW script starts from. ONE source for the three
// scaffolders — the Scripts page's create flow (spec §5.2), `worca script new`
// and `worca plugin new-script` (§6) — so a plugin author's file and the page's
// file can never drift. Pure: strings and plain objects, no fs, no node builtins.
// ui/public/scripts-view.mjs imports and re-exports the first four names.

import { CASES_VERSION } from './script-cases.mjs';

// A new script must RUN before a character is typed: each template is the
// minimum its runtime's contract accepts (base spec §5.1, §5.2, §7), so the
// first bench run is green and the author edits from a working program.
export const SCRIPT_TEMPLATES = {
  node: "export default async function ({ inputs, outputs, params, ctx, log }) {\n  log('info', 'hello from a worca script');\n  return { summary: 'ok' };\n}\n",
  shell: '#!/bin/sh\nset -e\necho "hello from a worca script"\n',
  python: "def main(api):\n    api.log('info', 'hello from a worca script')\n    return { 'summary': 'ok' }\n",
};
// Held with LF, like every editor value (a <textarea> cannot hold a CR). cmd.exe
// wants CRLF in a .cmd (spec §10), and that ending belongs to the WRITER: every
// path that puts this text on disk goes through script-store.mjs `programText`.
export const SCRIPT_WIN32_TEMPLATE = '@echo off\necho hello from a worca script\n';
export const SHELL_COMMAND_TEMPLATE = 'npm test';

/** The create page's starting sidecar. */
export function blankScriptMeta(runtime = 'node') {
  return {
    key: '', metaVersion: 2, displayName: '', description: '', domain: '', color: 'amber',
    icon: '', order: 50, runtime, timeoutMs: 600000, params: [], inputs: [], outputs: [],
  };
}

/**
 * The source a fresh script of this runtime starts from.
 * @param {string} runtime  'node' | 'shell' | 'python' (anything else -> node)
 * @param {{win32?: boolean}} [opts] win32: the .cmd half of a shell pair (LF here —
 *   the writer applies `programText`, which gives a .cmd its CRLF).
 * @returns {string}
 */
export function scriptSourceTemplate(runtime, { win32 = false } = {}) {
  if (win32) return SCRIPT_WIN32_TEMPLATE;
  return SCRIPT_TEMPLATES[runtime] || SCRIPT_TEMPLATES.node;
}

/**
 * The sidecar a CLI-scaffolded script starts from: the create page's blank meta
 * with a key and the file(s) the runtime names. Ports and params stay empty —
 * the templates write no output, and a declared non-void output nothing writes
 * is an execution error (base spec §4.2 rule 2). The user layer's store
 * recomputes `file` from key+runtime (spec §3.3); it is filled here for
 * `worca plugin new-script`, which writes the files itself.
 * @param {string} key @param {string} runtime
 * @returns {object} a raw meta v2 object
 */
export function scriptMetaTemplate(key, runtime) {
  const k = String(key || 'script');
  const file = runtime === 'shell'
    ? { default: `${k}.sh`, win32: `${k}.cmd` }
    : `${k}.${runtime === 'python' ? 'py' : 'mjs'}`;
  return {
    ...blankScriptMeta(runtime),
    key: k,
    displayName: k,
    description: 'Scaffolded worca script — edit me',
    file,
  };
}

/** A typed empty value for a required param the sidecar gives no default for. */
function emptyParamValue(p) {
  if (p.type === 'number') return 0;
  if (p.type === 'boolean') return false;
  if (p.type === 'enum') return (Array.isArray(p.options) && p.options.length ? p.options[0] : '');
  return '';
}

/**
 * One runnable sample case for a scaffolded script (W5): scratch cwd, every
 * declared input bound, and the expectation a clean run satisfies — so
 * `worca plugin validate --run-cases` is green on a fresh scaffold.
 * @param {object} meta a NORMALIZED script meta
 * @returns {{version: number, cases: object[]}}
 */
export function sampleCasesTemplate(meta) {
  const config = meta && meta.ports === 'config';
  const ports = config
    ? (meta.defaultPorts || { inputs: [], outputs: [] })
    : { inputs: (meta && meta.inputs) || [], outputs: (meta && meta.outputs) || [] };

  const inputs = {};
  for (const p of ports.inputs || []) {
    if (!p || !p.id || p.id === 'await') continue;          // the gate is never bound (§4.1)
    if (p.type === 'void') inputs[p.id] = { fired: true };
    else if (p.type === 'json') inputs[p.id] = { text: '{}\n' };
    else inputs[p.id] = { text: `# ${p.id}\n\nSample input.\n` };
  }

  const params = {};
  for (const p of (meta && meta.params) || []) {
    if (!p || !p.id) continue;
    if (p.default !== undefined) params[p.id] = p.default;
    else if (p.required) params[p.id] = emptyParamValue(p);
  }

  // A clean run fires `always` and `clean` outputs; `blocking` ones must not appear.
  const fired = (ports.outputs || [])
    .filter((p) => p && p.id && (!p.when || p.when === 'always' || p.when === 'clean'))
    .map((p) => p.id);

  return {
    version: CASES_VERSION,
    cases: [{
      id: 'sample',
      name: 'sample',
      params,
      ports: config ? { inputs: ports.inputs || [], outputs: ports.outputs || [] } : null,
      inputs,
      cwd: { kind: 'scratch' },
      timeoutMs: null,
      expect: { verdict: 'clean', fired },
    }],
  };
}
