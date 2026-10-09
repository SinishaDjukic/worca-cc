// test/live/profiles/copilot.mjs
// The GitHub Copilot CLI harness profile. Same shape as profiles/claude.mjs.
// Not yet exercised live (no copilot binary on the machine that built the suite):
// run with `--engine copilot` and adjust parseWire to the real stream first.
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import claude from './claude.mjs';

function which(bin) {
  const r = spawnSync('/bin/sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

export default {
  engine: 'copilot',
  binEnv: 'WORCA_COPILOT_BIN',
  realBin: () => process.env.LIVE_COPILOT_REAL || which('copilot'),
  realHome: () => process.env.LIVE_REAL_HOME || homedir(),
  models: {
    cheap: 'copilot-claude-haiku-4.5',
    mid: 'copilot-claude-sonnet-5.5',
    top: 'copilot-claude-opus-5.5',
    matrix: ['copilot-claude-haiku-4.5', 'copilot-claude-sonnet-5.5', 'copilot-claude-opus-5.5'],
  },
  expectInitModel: () => /.*/,

  preflight() {
    const bin = this.realBin();
    if (!bin) return { ok: false, reason: 'copilot not on PATH' };
    const v = spawnSync(bin, ['--version'], { encoding: 'utf8', env: { ...process.env, HOME: this.realHome() } });
    if (v.status !== 0) return { ok: false, reason: `copilot --version failed: ${v.stderr}`.slice(0, 300) };
    return { ok: true, version: v.stdout.trim(), auth: 'unchecked', bin };
  },

  // Copilot's JSON stream is close to Claude's stream-json; start from Claude's parser.
  parseWire: (text) => claude.parseWire(text),
  isProbe(rec) { const a = rec.args; return a[0] === '--version' || a[0] === '--help' || a.length === 0; },
  callSite(rec) {
    if (this.isProbe(rec)) return `probe:${rec.args.slice(0, 2).join(' ')}`;
    const i = rec.args.indexOf('-p');
    const p = i >= 0 ? rec.args[i + 1] : rec.stdin;
    return `copilot | ${(String(p || '').split('\n').find((l) => l.trim()) || '').trim().replace(/\d+/g, 'N').slice(0, 60)}`;
  },
  argvShape(rec, mask) { return rec.args.map((x) => (x.length > 200 ? `<TEXT ${x.length}ch>` : mask(x))); },
};
