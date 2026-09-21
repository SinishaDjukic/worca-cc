// test/graph-python-harness.test.mjs
// The `python` runtime harness (scripts-workbench spec §7): envelope on stdin ->
// main(api) -> ONE frame on stdout, exit 0. Every spawning test is guarded by the
// probe computed ONCE at the top, so a machine with no python still runs the
// suite green. CI (ubuntu, Node 22) ships python 3, so the spawning tests run
// there; nothing in CI covers Windows or macOS. The packaging pin is NOT skipped.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probePython } from '../src/core/graph/python-probe.mjs';
import { SCRIPT_TEMPLATES } from '../ui/public/scripts-view.mjs';

const HARNESS = fileURLToPath(new URL('../src/core/graph/worca_script.py', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));
const probe = await probePython();
const skip = probe.ok ? false : `no python on this host: ${probe.reason}`;

const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true, maxRetries: 3 }); });

/** Spawn the harness over `source` with `envelope` on stdin. Windows: PYTHONUTF8 +
 *  PYTHONIOENCODING are what keep a cp1252 console from mangling the streamed stderr. */
function runHarness(source, envelopeFor, { extraFiles = {}, programName = 'prog.py' } = {}) {
  const dir = tmp('worca-pyh-');
  const program = join(dir, programName);
  writeFileSync(program, source, 'utf8');
  for (const [name, text] of Object.entries(extraFiles)) writeFileSync(join(dir, name), text, 'utf8');
  const envelope = envelopeFor(dir);
  return new Promise((resolve, reject) => {
    const child = spawn(probe.command[0], [...probe.command.slice(1), '-u', HARNESS, program], {
      cwd: dir,
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (c) => { out += c; });
    child.stderr.setEncoding('utf8').on('data', (c) => { err += c; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err, dir, envelope }));
    child.stdin.end(JSON.stringify(envelope));
  });
}

/** A base spec §4.1 envelope with one bound md input and one md output. */
const envelopeFor = (params = {}) => (dir) => ({
  apiVersion: 1,
  node: { id: 'n_py', key: 'pyCard', displayName: 'Py card' },
  execution: { id: 'x:n_py:2', ordinal: 2 },
  inputs: { plan: { type: 'md', path: join(dir, 'plan.md'), fresh: true } },
  outputs: { out: { type: 'md', path: join(dir, 'out.md') }, done: { type: 'void', path: null } },
  verdictPath: join(dir, 'verdict.json'),
  params,
  ctx: { cwd: dir, pipelineDir: dir, projectDir: dir, runRoot: null, repos: null, checkpointRef: null, baseName: 'feature', runId: 'b4c2', platform: process.platform, mock: false },
});

test('a sync main(api) returns a frame: summary, outputs and verdict travel; exit 0', { skip }, async () => {
  const r = await runHarness(`
def main(api):
    with open(api.outputs.out.path, 'w', encoding='utf-8') as f:
        f.write('# out\\n')
    api.log('info', 'wrote ' + api.node['displayName'])
    return {'summary': 'ok ' + str(api.execution.ordinal), 'verdict': {'issues': []}}
`, envelopeFor({ mode: 'fast' }));
  assert.equal(r.code, 0, r.err);
  const frame = JSON.parse(r.out);
  assert.equal(frame.ok, true);
  assert.equal(frame.summary, 'ok 2');
  assert.deepEqual(frame.verdict, { issues: [] });
  assert.deepEqual(frame.logs, [{ level: 'info', msg: 'wrote Py card' }]);
  assert.equal(readFileSync(join(r.dir, 'out.md'), 'utf8'), '# out\n');
});

test('api is attributes AND keys, all the way down', { skip }, async () => {
  const r = await runHarness(`
def main(api):
    same = (api.params['mode'] == api['params'].mode
            and api.inputs.plan.path == api['inputs']['plan']['path']
            and api.ctx.platform == api['ctx'].platform
            and api.outputs['done']['type'] == 'void')
    return {'summary': 'same' if same else 'different', 'outputs': {'out': {'value': 'x'}}}
`, envelopeFor({ mode: 'fast' }));
  assert.equal(r.code, 0, r.err);
  const frame = JSON.parse(r.out);
  assert.equal(frame.summary, 'same');
  assert.deepEqual(frame.outputs, { out: { value: 'x' } });
});

test('an async main(api) is awaited with asyncio.run', { skip }, async () => {
  const r = await runHarness(`
import asyncio

async def main(api):
    await asyncio.sleep(0)
    return {'summary': 'awaited'}
`, envelopeFor());
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(r.out).summary, 'awaited');
});

test('an exception is a frame, not a crash: ok:false with the message and the traceback', { skip }, async () => {
  const r = await runHarness(`
def main(api):
    api.log('warn', 'about to fail')
    raise ValueError('no package.json in cwd')
`, envelopeFor());
  assert.equal(r.code, 0, 'the harness always exits 0 after a frame');
  const frame = JSON.parse(r.out);
  assert.equal(frame.ok, false);
  assert.equal(frame.error.message, 'no package.json in cwd');
  assert.match(frame.error.stack, /ValueError: no package\.json in cwd/);
  assert.deepEqual(frame.logs, [{ level: 'warn', msg: 'about to fail' }]);
});

test('a module with no callable main is refused by name', { skip }, async () => {
  const r = await runHarness(`
main = 7
`, envelopeFor());
  assert.equal(r.code, 0);
  const frame = JSON.parse(r.out);
  assert.equal(frame.ok, false);
  assert.match(frame.error.message, /^script module has no callable main\(api\): .*prog\.py$/);
});

test('print() goes to stderr; stdout stays exactly one frame', { skip }, async () => {
  const r = await runHarness(`
import sys

def main(api):
    print('a line on stdout')
    print('a line on stderr', file=sys.stderr)
    return {'summary': 'quiet'}
`, envelopeFor());
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), { ok: true, logs: [], summary: 'quiet' }, 'stdout is the frame and nothing else');
  assert.match(r.err, /a line on stdout/);
  assert.match(r.err, /a line on stderr/);
});

test('a child process the program starts writes into the run log, never into the frame', { skip }, async () => {
  // THE python idiom: subprocess.run([...]) with no capture inherits the OS-level fd 1. Rebinding sys.stdout
  // does not cover it — the harness points the DESCRIPTOR at stderr and keeps a private duplicate for the frame.
  const r = await runHarness(`
import os
import subprocess
import sys

def main(api):
    subprocess.run([sys.executable, '-c', 'print("from a child")'], check=True)
    os.system('echo from os.system')
    return {'summary': 'ran a child'}
`, envelopeFor());
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), { ok: true, logs: [], summary: 'ran a child' }, 'stdout is the frame and nothing else');
  assert.match(r.err, /from a child/);
  assert.match(r.err, /from os\.system/);
});

test('nothing printed AFTER main() returns can reach the frame: an atexit hook, a thread that outlives main', { skip }, async () => {
  // The harness used to point sys.stdout back at the frame handle once main() returned. User code is not over
  // then: the frame arrived as `{…}bye` and a card that SUCCEEDED failed with "stdout is not JSON".
  const hook = await runHarness(`
import atexit

atexit.register(lambda: print('bye from atexit'))

def main(api):
    return {'summary': 'hooked'}
`, envelopeFor());
  assert.equal(hook.code, 0, hook.err);
  assert.deepEqual(JSON.parse(hook.out), { ok: true, logs: [], summary: 'hooked' }, 'stdout is the frame and nothing else');
  assert.match(hook.err, /bye from atexit/);
  const late = await runHarness(`
import threading
import time

def worker():
    time.sleep(0.2)
    print('a late line')

def main(api):
    threading.Thread(target=worker).start()
    return {'summary': 'returned first'}
`, envelopeFor());
  assert.equal(late.code, 0, late.err);
  assert.deepEqual(JSON.parse(late.out), { ok: true, logs: [], summary: 'returned first' });
  assert.match(late.err, /a late line/, 'the exit waits for a non-daemon thread (P2-D20) and its print is in the run log');
});

test('a program file with no .py suffix still loads: the sidecar only asks for a plain basename', { skip }, async () => {
  const r = await runHarness(`
def main(api):
    return {'summary': 'loaded'}
`, envelopeFor(), { programName: 'card' });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), { ok: true, logs: [], summary: 'loaded' });
  assert.deepEqual(readdirSync(r.dir), ['card'], 'and still no __pycache__');
});

test('a return value json cannot carry is a frame, not a crash: a set, NaN, a nesting json gives up on', { skip }, async () => {
  const set = await runHarness(`
def main(api):
    api.log('info', 'before')
    return {'summary': 's', 'outputs': {'out': {'value': {1, 2}}}}
`, envelopeFor());
  assert.equal(set.code, 0, set.err);
  assert.deepEqual(JSON.parse(set.out), { ok: false, logs: [{ level: 'info', msg: 'before' }],
    error: { message: 'frame is not serializable: Object of type set is not JSON serializable' } });
  const nan = await runHarness(`
def main(api):
    return {'verdict': {'score': float('nan')}}
`, envelopeFor());
  assert.equal(nan.code, 0, nan.err);
  assert.match(JSON.parse(nan.out).error.message, /^frame is not serializable: /, 'json.dumps would print the non-JSON token NaN');
  const deep = await runHarness(`
def main(api):
    root = cur = {}
    for _ in range(100000):
        cur['x'] = {}
        cur = cur['x']
    return {'outputs': root}
`, envelopeFor());
  assert.equal(deep.code, 0, deep.err);
  assert.match(JSON.parse(deep.out).error.message, /^frame is not serializable: /, 'a RecursionError is not a ValueError');
});

test('the message names what str() leaves out: a missing api attribute, a KeyError, an empty message', { skip }, async () => {
  const attr = await runHarness(`
def main(api):
    return {'summary': api.inputs.nope.path}
`, envelopeFor());
  assert.equal(JSON.parse(attr.out).error.message, 'no "nope" here (has: plan)');
  const key = await runHarness(`
def main(api):
    return {'summary': api.params['mode']}
`, envelopeFor());
  assert.equal(JSON.parse(key.out).error.message, "KeyError: 'mode'");
  const bare = await runHarness(`
def main(api):
    assert api.params.get('mode') == 'fast'
`, envelopeFor());
  assert.equal(JSON.parse(bare.out).error.message, 'AssertionError', 'an empty str() falls back to the class name');
});

test('non-ASCII round-trips through the frame whatever the console encoding is', { skip }, async () => {
  const r = await runHarness(`
def main(api):
    return {'summary': 'ünïcødé — 中文 ✓', 'outputs': {'out': {'value': 'naïve café'}}}
`, envelopeFor());
  assert.equal(r.code, 0, r.err);
  const frame = JSON.parse(r.out);
  assert.equal(frame.summary, 'ünïcødé — 中文 ✓');
  assert.equal(frame.outputs.out.value, 'naïve café');
  assert.equal(/[^\x00-\x7F]/.test(r.out), false, 'the frame itself is pure ASCII (P2-D9)');
});

test('a sibling module beside the program imports', { skip }, async () => {
  const r = await runHarness(`
from helper import greet

def main(api):
    return {'summary': greet('worca')}
`, envelopeFor(), { extraFiles: { 'helper.py': 'def greet(name):\n    return "hello " + name\n' } });
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(r.out).summary, 'hello worca');
  assert.deepEqual(readdirSync(r.dir).sort(), ['helper.py', 'prog.py'], 'no __pycache__ is left beside the program');
});

test('the harness parses under the python 3.8 grammar, whatever interpreter runs the suite', { skip }, () => {
  // The floor is 3.8 and a developer machine runs 3.11+: a `match` or a parenthesized `with` would pass every
  // other test here. ast.parse(feature_version=…) refuses them without needing a 3.8 interpreter, and writes nothing.
  const r = spawnSync(probe.command[0], [...probe.command.slice(1), '-c',
    'import ast,sys\nast.parse(open(sys.argv[1], encoding="utf-8").read(), sys.argv[1], feature_version=(3, 8))', HARNESS], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('the harness ships in the npm package', () => {
  assert.ok(existsSync(HARNESS), 'src/core/graph/worca_script.py exists');
  const files = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).files;
  assert.ok(files.includes('src/'), 'package.json files carries src/, which carries the harness');
});

test('the page`s new-python-script template is a program THIS harness accepts', { skip }, async () => {
  // A new script starts with no ports, so the envelope carries none: the template
  // must be green on the first bench run before a character is typed (p1c-T09).
  const r = await runHarness(SCRIPT_TEMPLATES.python, (dir) => ({ ...envelopeFor()(dir), outputs: {}, verdictPath: null }));
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), { ok: true, logs: [{ level: 'info', msg: 'hello from a worca script' }], summary: 'ok' });
  assert.match(SCRIPT_TEMPLATES.python, /^def main\(api\):$/m, 'the entry point the harness requires');
});
