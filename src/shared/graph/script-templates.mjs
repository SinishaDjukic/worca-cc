// src/shared/graph/script-templates.mjs
// The program and the sidecar a NEW script starts from. ONE source for the three
// scaffolders — the Scripts page's create flow (spec §5.2), `worca script new`
// and `worca plugin new-script` (§6) — so a plugin author's file and the page's
// file can never drift. Pure: strings and plain objects, no fs, no node builtins.
// ui/public/scripts-view.mjs imports and re-exports the first four names.

import { CASES_VERSION } from './script-cases.mjs';
import { iconSvgOf } from './script-icons.mjs';

/** What a fresh script of each runtime looks like on the canvas (script-wizard plan S9). */
export const RUNTIME_DEFAULTS = Object.freeze({
  node: Object.freeze({ color: 'violet', icon: 'code' }),
  python: Object.freeze({ color: 'blue', icon: 'flask' }),
  shell: Object.freeze({ color: 'amber', icon: 'terminal' }),
});

/** The page's **Load example** (S14): one working gate per runtime, read by the
 *  inference exactly as the concept canvas shows it. `icon` is a SCRIPT_ICONS name. */
export const SCRIPT_EXAMPLES = Object.freeze({
  node: Object.freeze({
    name: 'Diff gate',
    description: 'Blocks the review when the diff touches more files than allowed.',
    color: 'violet',
    icon: 'funnel',
    source: [
      '// Reads the plan and the diff, writes a report, blocks when the diff is too wide.',
      'export default async function ({ inputs, outputs, params, ctx, log }) {',
      // The fs builtin is loaded dynamically, in BACKTICKS, on purpose: test/shared-graph-purity.test.mjs reads
      // this module's RAW source (comments and strings included) and would take the usual static form, or a
      // quoted specifier, as an import of THIS shared module. The program the user sees is ordinary ESM.
      '  const { readFileSync, writeFileSync } = await import(`node:fs`);',
      "  const plan = readFileSync(inputs.plan.path, 'utf8');",
      "  const diff = readFileSync(inputs.diff.path, 'utf8');",
      '  const limit = Number(params.maxFiles ?? 40);',
      '  const files = diff.match(/^\\+\\+\\+ b\\/(.+)$/gm) ?? [];',
      "  log('info', `${files.length} files changed`);",
      '',
      '  writeFileSync(outputs.report.path,',
      "    `# Diff report\\n\\nPlan: ${plan.split('\\n')[0]}\\n${files.length} files changed, limit ${limit}\\n`);",
      '',
      '  const issues = files.length > limit',
      "    ? [{ severity: 'major', title: `${files.length} files exceed the limit of ${limit}` }]",
      '    : [];',
      '  return { summary: `${files.length} files`, verdict: { issues } };',
      '}',
    ].join('\n') + '\n',
  }),
  python: Object.freeze({
    name: 'TODO gate',
    description: 'Counts the TODOs a diff adds and blocks when there are too many.',
    color: 'blue',
    icon: 'flask',
    source: [
      '# Counts the TODOs a diff adds and blocks when the count passes a limit.',
      'import re',
      '',
      'def main(api):',
      "    diff = open(api.inputs.diff.path, encoding='utf-8').read()",
      '    limit = int(api.params.limit or 5)',
      "    todos = re.findall(r'^\\+.*\\bTODO\\b', diff, re.M)",
      "    api.log('info', f'{len(todos)} new TODOs')",
      '',
      "    with open(api.outputs.report.path, 'w', encoding='utf-8') as f:",
      "        f.write(f'# TODO report\\n\\n{len(todos)} new TODOs, limit {limit}\\n')",
      '',
      "    issues = [{'severity': 'major', 'title': f'{len(todos)} TODOs over the limit of {limit}'}] if len(todos) > limit else []",
      "    return {'summary': f'{len(todos)} TODOs', 'verdict': {'issues': issues}}",
    ].join('\n') + '\n',
  }),
  shell: Object.freeze({
    name: 'Run tests',
    description: "Runs the project's test command in the checkout. Exit 0 passes, exit 1 fails.",
    color: 'amber',
    icon: 'terminal',
    source: [
      '#!/bin/sh',
      "# Runs the test command in the run's checkout. Exit 0 routes to pass, exit 1 to fail.",
      'cd "$WORCA_CWD"',
      'CMD="${WORCA_PARAM_COMMAND:-npm test}"',
      'echo "running: $CMD"',
      'sh -c "$CMD" > "$WORCA_OUT_LOG" 2>&1',
    ].join('\n') + '\n',
  }),
});


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

/** The create page's starting sidecar: the runtime's colour and icon, everything else empty. */
export function blankScriptMeta(runtime = 'node') {
  const d = RUNTIME_DEFAULTS[runtime] || RUNTIME_DEFAULTS.node;
  return {
    key: '', metaVersion: 2, displayName: '', description: '', domain: '', color: d.color,
    icon: iconSvgOf(d.icon), order: 50, runtime, timeoutMs: 600000, params: [], inputs: [], outputs: [],
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
