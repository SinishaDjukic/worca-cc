// test/helpers/relay-sandbox.mjs
// A started E2B env on the loopback fake for one engine (test/exec-env-engine-relay.test.mjs sandboxFor, generalised):
// its model calls go through worca's real relay to `upstream` (test/helpers/engine-upstream.mjs). The engine's CLI
// command either prints canned lines (its fixture stream), or, with `fake`, runs test/fixtures/fake-engine.mjs through
// real bash: a shim named after the CLI, first on PATH, with the FAKE_* knobs written into it (the sandbox env carries
// no FAKE_* and no PATH). Real bash means an abort reaches it, and its FAKE_CALL reaches the relay on host loopback.
import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeE2b } from '../../src/core/exec-env/e2b-fake.mjs';
import { E2bExecEnv } from '../../src/core/exec-env/e2b-env.mjs';
import { fixture, makeEnvOpts } from './e2b-fixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FAKE_ENGINE = join(HERE, '..', 'fixtures', 'fake-engine.mjs');
/** The CLI each engine's adapter runs in a sandbox. */
export const ENGINE_CLI = Object.freeze({ claude: 'claude', codex: 'codex', copilot: 'copilot', cursor: 'cursor-agent', gemini: 'gemini', qwen: 'qwen',
  goose: 'goose', opencode: 'opencode' });
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * @param {import('node:test').TestContext} t
 * @param {{engine:string, tmp:(p:string)=>string, upstream?:{relayUpstreams:object}|null, serverEnv?:object,
 *   fake?:Record<string,string>|null, lines?:string[]|null, holdPipes?:boolean}} o
 *   fake: FAKE_* knobs (setFake replaces them per case); lines: canned stdout (default: the engine's stream fixture);
 *   holdPipes: a command ends only when its stdout's last holder closes it (e2b-fake.mjs, design §9)
 * @returns {Promise<{env:E2bExecEnv, f:object, seen:object[], setFake:(knobs:object)=>void, close:()=>Promise<void>}>}
 */
export async function relaySandbox(t, { engine, tmp, upstream = null, serverEnv = {}, fake = null, lines = null, holdPipes = false }) {
  const cli = ENGINE_CLI[engine];
  const seen = [];
  const canned = lines || readFileSync(join(HERE, '..', 'fixtures', 'engines', engine, 'stream.jsonl'), 'utf8').split('\n').filter(Boolean);
  let bin = null;
  const setFake = (knobs) => {
    bin ||= mkdtempSync(join(tmpdir(), 'worca-relay-shim-'));
    const exports = Object.entries(knobs || {}).filter(([, v]) => v != null).map(([k, v]) => `export ${k}=${shq(v)}`).join('\n');
    writeFileSync(join(bin, cli), `#!/bin/sh\n${exports}\nexec ${shq(process.execPath)} ${shq(FAKE_ENGINE)} "$@"\n`);
    chmodSync(join(bin, cli), 0o755);
  };
  if (fake) {
    setFake(fake);
    const prev = process.env.PATH;
    process.env.PATH = `${bin}${delimiter}${prev}`;
    t.after(() => { process.env.PATH = prev; });
  }
  const sdk = createFakeE2b({ root: tmp('worca-relay-sandbox-root-'), holdPipes, onCommand: (cmd, o) => {
    const probe = cmd.match(/^command -v '([^']+)'/)?.[1];
    if (probe) return { lines: [`/usr/local/bin/${probe}`] };
    if (!cmd.startsWith(`'${cli}'`)) return null;
    seen.push({ cmd, envs: o.envs, sandbox: o.sandbox });
    return fake ? null : { lines: canned, exitCode: 0 };
  } });
  const f = fixture(tmp);
  const env = new E2bExecEnv(makeEnvOpts(tmp, sdk, f, { env: serverEnv, ...(upstream ? { relayUpstreams: upstream.relayUpstreams } : {}) }));
  await env.start();
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await env.close('test'); } };
  t.after(close);
  return { env, f, seen, setFake, close };
}
