// test/script-builtins.test.mjs
// The v1 built-in script cards (spec §12): their sidecars normalize, never
// collide with an agent key (D16), and each one runs for real through the
// runtime — js-inline via the node harness, git-diff on a temp repo, shell with
// a command param. Offline by construction.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadScriptRegistry, DEFAULT_SCRIPTS_DIR } from '../src/core/script-registry.mjs';
import { runScriptExecution } from '../src/core/graph/script-runner.mjs';
import { readConfigPorts, effectiveScriptParams } from '../src/shared/graph/script-meta.mjs';
import { probePython } from '../src/core/graph/python-probe.mjs';
import { listScriptNodes } from '../src/core/workflow-share.mjs';
import { realAgentMetas } from './helpers/graph-ports.mjs';
import { gitDir } from './helpers/git-dir.mjs';

const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });
const REG = loadScriptRegistry({ scriptsDir: DEFAULT_SCRIPTS_DIR, userScriptsDir: null, includePlugins: false, agentKeys: realAgentMetas().map((m) => m.key) });
const PROBE = await probePython();
const pySkip = PROBE.ok ? false : `no python on this host: ${PROBE.reason}`;

/** A runner ctx over a temp pipeline dir for a built-in with CONFIG ports (shell, js) or sidecar ports (gitDiff). */
function ctxFor(key, { params = {}, ports: configPorts, cwd = tmp('worca-bi-cwd-'), checkpointRef = null } = {}) {
  const meta = REG[key];
  const pipelineDir = tmp('worca-bi-pipe-');
  const declared = meta.ports === 'config' ? readConfigPorts(configPorts || meta.defaultPorts, { hasVerdict: !!meta.verdict }).ports : { inputs: meta.inputs, outputs: meta.outputs };
  const ports = { ...declared, verdict: meta.verdict };
  const outputs = {};
  for (const p of ports.outputs) if (p.filename) outputs[p.id] = { path: join(pipelineDir, p.filename.replace('{cycle}', '1')), store: 'run' };
  const verdict = meta.verdict ? { path: join(pipelineDir, meta.verdict.filename.replace('{cycle}', '1')) } : null;
  return {
    node: { id: `n_${key}`, kind: 'script', key }, executionId: `x:n_${key}:1`, ordinal: 1, pipelineDir, pipelineId: 'p1',
    projectDir: cwd, runCtx: { pipelineDir, projectDir: cwd, baseName: 'feature' }, checkpointRef, ports, outputs, verdict,
    bindings: {}, trigger: { wireIds: [], freshPorts: [] },
    script: { meta, runtime: meta.runtime, file: meta.scriptPath, command: meta.commandResolved, params: effectiveScriptParams(meta, { params }), timeoutMs: meta.timeoutMs, mock: null },
    claudeOpts: {}, onEvent: () => {},
  };
}

test('the built-in layer is exactly shell, js, py, gitDiff — normalized, ordered, and disjoint from the agent keys', () => {
  assert.deepEqual(Object.keys(REG), ['shell', 'js', 'py', 'gitDiff']);
  assert.equal(REG.shell.runtime, 'shell');
  assert.equal(REG.shell.ports, 'config');
  assert.deepEqual(REG.shell.params.map((p) => [p.id, p.type, p.required]), [['command', 'command', true]]);
  assert.deepEqual(REG.shell.defaultPorts.outputs.map((o) => [o.id, o.when, o.filename ?? null]),
    [['log', 'always', 'shell-cycle{cycle}.md'], ['fail', 'blocking', 'shell-cycle{cycle}.md'], ['pass', 'clean', null]]);
  assert.deepEqual(REG.shell.verdict, { filename: 'shell-cycle{cycle}.json' });
  assert.equal(REG.js.runtime, 'node');
  assert.equal(REG.js.ports, 'config');
  assert.equal(REG.js.scriptPath, join(DEFAULT_SCRIPTS_DIR, 'js-inline.mjs'));
  assert.deepEqual(REG.js.params.map((p) => [p.id, p.type, p.language, p.required]), [['source', 'code', 'js', true]]);
  assert.match(REG.js.params[0].default, /export default async function/);
  assert.equal(REG.py.runtime, 'python');
  assert.equal(REG.py.ports, 'config');
  assert.equal(REG.py.order, 25);
  assert.equal(REG.py.scriptPath, join(DEFAULT_SCRIPTS_DIR, 'py-inline.py'));
  assert.deepEqual(REG.py.params.map((p) => [p.id, p.type, p.language, p.required]), [['source', 'code', 'python', true]]);
  assert.match(REG.py.params[0].default, /^def main\(api\):/);
  assert.deepEqual(REG.py.verdict, { filename: 'py-cycle{cycle}.json' });
  assert.equal(REG.gitDiff.runtime, 'node');
  assert.equal(REG.gitDiff.scriptPath, join(DEFAULT_SCRIPTS_DIR, 'git-diff.mjs'));
  assert.deepEqual(REG.gitDiff.outputs.map((o) => [o.id, o.type, o.filename]), [['diff', 'md', 'diff-cycle{cycle}.md']]);
  assert.equal('verdict' in REG.gitDiff, false);
  assert.deepEqual(REG.gitDiff.params.map((p) => [p.id, p.type]), [['ref', 'string'], ['stat', 'boolean']]);
  for (const m of Object.values(REG)) {
    assert.match(m.description, /worca/, `${m.key}: the description names the trust level (D23)`);
    assert.ok(m.icon.length > 0 && m.displayName.length > 0);
  }
});

test('js: an inline snippet runs through the node harness with the same api as a file script', async () => {
  const source = `export default async function ({ outputs, params, ctx, log }) {
  const fs = await import('node:fs');
  fs.writeFileSync(outputs.out.path, '# from inline\\n' + ctx.cwd + '\\n');
  log('info', 'inline ran');
  return { summary: 'inline ok', verdict: { issues: [] } };
}\n`;
  const ctx = ctxFor('js', { params: { source } });
  const events = [];
  ctx.onEvent = (e) => events.push(e);
  const r = await runScriptExecution(ctx);
  assert.equal(r.summary, 'inline ok');
  assert.equal(readFileSync(ctx.outputs.out.path, 'utf8'), `# from inline\n${ctx.projectDir}\n`);
  assert.deepEqual(r.verdict, { issues: [], summary: '' });
  assert.ok(events.some((e) => e.type === 'text' && e.text === '[info] inline ran'));
  await assert.rejects(runScriptExecution(ctxFor('js', { params: { source: 'export const nope = 1;\n' } })), /must `export default async function/);
  const dflt = await runScriptExecution(ctxFor('js', { params: { source: REG.js.params[0].default } }));
  assert.equal(dflt.summary, 'ok', 'the default snippet is a working card');
});

test('gitDiff: a fenced diff against the checkpoint ref (or the ref param), --stat on request, no verdict', async () => {
  const repo = gitDir('bi-diff');
  const ref = execSync('git rev-parse HEAD', { cwd: repo, encoding: 'utf8' }).trim();
  writeFileSync(join(repo, 'a.txt'), 'hello\n');
  execSync('git add a.txt && git -c user.email=t@t -c user.name=t commit -q -m add', { cwd: repo });
  writeFileSync(join(repo, 'a.txt'), 'hello world\n');
  const ctx = ctxFor('gitDiff', { cwd: repo, checkpointRef: ref });
  const r = await runScriptExecution(ctx);
  const md = readFileSync(ctx.outputs.diff.path, 'utf8');
  assert.match(md, /^# Diff against [0-9a-f]{7,}\n/);
  assert.match(md, /```diff\n[\s\S]*\+hello world[\s\S]*\n```\n/);
  assert.match(md, /new file mode|\+hello\n/, 'a.txt was created after the checkpoint, so the diff shows it');
  assert.equal(r.verdict, null);
  assert.deepEqual(r.warnings, []);
  const stat = await runScriptExecution(ctxFor('gitDiff', { cwd: repo, checkpointRef: ref, params: { stat: true } }));
  assert.match(readFileSync(stat.outputs.diff.path, 'utf8'), /```text\n[\s\S]*a\.txt \|[\s\S]*```/);
  const head = await runScriptExecution(ctxFor('gitDiff', { cwd: repo, checkpointRef: ref, params: { ref: 'HEAD' } }));
  assert.match(readFileSync(head.outputs.diff.path, 'utf8'), /-hello\n\+hello world/, 'the ref param wins over the checkpoint');
});

test('shell: the command param runs in the cwd with the WORCA_* env; exit 1 fires the synthesized blocking verdict', async () => {
  const cwd = tmp('worca-bi-cwd-');
  // Compare REAL paths (v2, measured on macOS 2026-09-18): os.tmpdir() is /var/folders/… there, a symlink to
  // /private/var/…, and a child's process.cwd() reports the resolved side — a plain === prints CWD_BAD on every Mac.
  // v3 S2: the exit switch must not be a substring of the command ITSELF. v2 tested `.includes('exit 1')` — but that
  // literal is part of this very text, so WORCA_PARAM_COMMAND always contained it and BOTH runs exited 1. `endsWith('#fail')`
  // is true only for the second command: `#fail` is a comment to sh, and an ignored extra argv to node under cmd.exe.
  const cmd = `${JSON.stringify(process.execPath)} -e "const f=require('fs');console.log(f.realpathSync(process.cwd())===f.realpathSync(process.env.WORCA_CWD)?'CWD_OK':'CWD_BAD');process.exit(Number(process.env.WORCA_PARAM_COMMAND.endsWith('#fail')))"`;
  const ok = await runScriptExecution(ctxFor('shell', { cwd, params: { command: cmd } }));
  assert.equal(ok.exitCode, 0);
  assert.match(readFileSync(ok.outputs.log.path, 'utf8'), /CWD_OK/);
  assert.deepEqual(ok.verdict.issues, []);
  const bad = await runScriptExecution(ctxFor('shell', { cwd, params: { command: `${cmd} #fail` } }));
  assert.equal(bad.exitCode, 1);
  assert.equal(bad.verdict.issues[0].severity, 'major');
  assert.equal(bad.verdict.issues[0].title, 'Shell failed (exit 1)');
});

test('py: an inline def main(api) runs through the python harness with the file-script api', { skip: pySkip }, async () => {
  const source = `def main(api):
    with open(api.outputs.out.path, 'w', encoding='utf-8') as f:
        f.write('# from inline\\n' + api.ctx.cwd + '\\n')
    api.log('info', 'inline ran')
    return {'summary': 'inline ok', 'verdict': {'issues': []}}
`;
  const ctx = ctxFor('py', { params: { source } });
  const events = [];
  ctx.onEvent = (e) => events.push(e);
  const r = await runScriptExecution(ctx);
  assert.equal(r.runtime, 'python');
  assert.equal(r.summary, 'inline ok');
  assert.equal(readFileSync(ctx.outputs.out.path, 'utf8'), `# from inline\n${ctx.projectDir}\n`);
  assert.deepEqual(r.verdict, { issues: [], summary: '' });
  assert.ok(events.some((e) => e.type === 'text' && e.text === '[info] inline ran'));
  const dflt = await runScriptExecution(ctxFor('py', { params: { source: REG.py.params[0].default } }));
  assert.equal(dflt.summary, 'ok', 'the default snippet is a working card');
});

test('py: an empty source and a source with no main are both named', { skip: pySkip }, async () => {
  await assert.rejects(runScriptExecution(ctxFor('py', { params: { source: '   ' } })),
    /^Error: script "py": the py card has no source$/);
  await assert.rejects(runScriptExecution(ctxFor('py', { params: { source: 'value = 1\n' } })),
    /^Error: script "py": the source must define `def main\(api\): …`$/);
});

test('py: an async def main is awaited, and a raise inside the snippet is the execution error', { skip: pySkip }, async () => {
  const r = await runScriptExecution(ctxFor('py', { params: { source: `import asyncio

async def main(api):
    await asyncio.sleep(0)
    with open(api.outputs.out.path, 'w', encoding='utf-8') as f:
        f.write('# async\\n')
    return {'summary': 'awaited'}
` } }));
  assert.equal(r.summary, 'awaited');
  await assert.rejects(runScriptExecution(ctxFor('py', { params: { source: 'def main(api):\n    raise RuntimeError("boom")\n' } })),
    /^Error: script "py": boom$/);
});

test('py: the snippet is a REAL module — a dataclass under postponed annotations works inline as it does in a file', { skip: pySkip }, async () => {
  const r = await runScriptExecution(ctxFor('py', { params: { source: `from __future__ import annotations
from dataclasses import dataclass
import typing

@dataclass
class Row:
    name: str
    seen: typing.ClassVar[int] = 0

def main(api):
    with open(api.outputs.out.path, 'w', encoding='utf-8') as f:
        f.write('# ' + Row('row').name + '\\n')
    return {'summary': Row('dataclass ok').name}
` } }));
  assert.equal(r.summary, 'dataclass ok');
});

test('py: the card program parses under the python 3.8 grammar, whatever interpreter runs the suite', { skip: pySkip }, () => {
  const r = spawnSync(PROBE.command[0], [...PROBE.command.slice(1), '-c',
    'import ast,sys\nast.parse(open(sys.argv[1], encoding="utf-8").read(), sys.argv[1], feature_version=(3, 8))', REG.py.scriptPath], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('py: a shared workflow placing the py card shows its source in the D18 import receipt', () => {
  // The gate is keyed on the PARAM TYPE (command / code), not on a list of card keys — pinned here so a new
  // inline card can never become a way around "these commands run on this machine with worca's privileges".
  const source = 'def main(api):\n    return {}\n';
  const graph = { nodes: [{ id: 'n_py', kind: 'script', key: 'py', config: { params: { source } } }] };
  assert.deepEqual(listScriptNodes(graph, REG),
    [{ nodeId: 'n_py', key: 'py', displayName: 'Python', runtime: 'python', params: { source } }]);
});
