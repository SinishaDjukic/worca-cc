// test/live/profiles/codex.mjs
// The Codex CLI harness profile. Same shape as profiles/claude.mjs; scenarios
// that need a capability Codex declares false (engines/codex.mjs) skip on it.
// Wire parsing follows `codex exec --json` (thread.started / item.* / turn.*).
// Not yet exercised live by the suite — run with `--engine codex` to validate it.
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

function which(bin) {
  const r = spawnSync('/bin/sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

export default {
  engine: 'codex',
  binEnv: 'WORCA_CODEX_BIN',
  realBin: () => process.env.LIVE_CODEX_REAL || which('codex'),
  realHome: () => process.env.LIVE_REAL_HOME || homedir(),
  models: {
    cheap: 'gpt-5.6-luna',
    mid: 'gpt-5.6-terra',
    top: 'gpt-5.6-sol',
    matrix: ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-astra', 'gpt-5.5'],
  },
  expectInitModel: () => /.*/,   // codex does not echo the model on the wire

  preflight() {
    const bin = this.realBin();
    if (!bin) return { ok: false, reason: 'codex not on PATH' };
    const r = spawnSync(bin, ['login', 'status'], { encoding: 'utf8', env: { ...process.env, HOME: this.realHome() } });
    if (r.status !== 0) return { ok: false, reason: `codex login status: ${(r.stdout || '') + (r.stderr || '')}`.slice(0, 300) };
    const v = spawnSync(bin, ['--version'], { encoding: 'utf8' }).stdout.trim();
    return { ok: true, version: v, auth: (r.stdout || r.stderr).trim().slice(0, 80), bin };
  },

  parseWire(text) {
    const w = { lines: 0, bad: 0, inits: [], sessionIds: [], results: [], tools: [], subagentSpawns: 0, hookEvents: [], apiRetries: 0, rateLimits: [], childInits: 0 };
    let usage = null; let failed = null;
    for (const line of String(text || '').split('\n')) {
      if (!line.trim()) continue;
      w.lines++;
      let e;
      try { e = JSON.parse(line); } catch { w.bad++; continue; }
      if (e.type === 'thread.started') { w.sessionIds.push(e.thread_id); w.inits.push({ model: null, sessionId: e.thread_id, parent: null }); }
      else if (e.type === 'item.completed' && e.item) {
        if (e.item.type && e.item.type !== 'agent_message' && e.item.type !== 'reasoning') w.tools.push({ name: e.item.type, input: e.item, parent: null });
      } else if (e.type === 'turn.completed') usage = e.usage || usage;
      else if (e.type === 'turn.failed' || e.type === 'error') failed = e;
    }
    w.result = { subtype: failed ? 'error' : 'success', isError: !!failed, costUsd: null, usage, text: failed ? JSON.stringify(failed).slice(0, 400) : null };
    w.results = [w.result];
    w.mainInit = w.inits[0] || null;
    return w;
  },

  isProbe(rec) { const a = rec.args; return a[0] === '--version' || a[0] === 'login' || a[0] === '--help' || a.length === 0; },
  callSite(rec) {
    if (this.isProbe(rec)) return `probe:${rec.args.slice(0, 2).join(' ')}`;
    const p = rec.stdin || rec.args[rec.args.length - 1] || '';
    return `codex | ${(String(p).split('\n').find((l) => l.trim()) || '').trim().replace(/\d+/g, 'N').slice(0, 60)}`;
  },
  argvShape(rec, mask) { return rec.args.map((x) => (x.length > 200 ? `<TEXT ${x.length}ch>` : mask(x))); },
};
