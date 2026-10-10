// test/live/profiles/claude.mjs
// The Claude Code harness profile: everything the live suite needs to know that
// is specific to one harness. Scenarios never read the wire format themselves;
// they get `wire` summaries from parseWire() and call sites from callSite().
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

function which(bin) {
  const r = spawnSync('/bin/sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

const PREAMBLE_END = /^## Host process protection[\s\S]*?\n\n/;

export default {
  engine: 'claude',
  binEnv: 'WORCA_CLAUDE_BIN',
  realBin: () => process.env.LIVE_CLAUDE_REAL || which('claude'),
  realHome: () => process.env.LIVE_REAL_HOME || homedir(),

  // Model tiers. `cheap` drives every scenario; `matrix` drives the model-sensitive ones.
  models: {
    cheap: 'claude-haiku-4-5',
    mid: 'claude-sonnet-5-5',
    top: 'claude-opus-5-5',
    matrix: ['claude-haiku-4-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'opus', 'sonnet', 'claude-opus-4-8[1m]', 'claude-haiku-5-5'],
  },
  // What an alias / id resolves to on the wire (system/init `model`), as a matcher.
  expectInitModel(requested) {
    const alias = { opus: /^claude-opus-/, sonnet: /^claude-sonnet-/, haiku: /^claude-haiku-/ };
    if (alias[requested]) return alias[requested];
    const base = requested.replace(/\[1m\]$/i, '');
    return new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\[1m\\])?(-\\d{8})?$`, 'i');
  },

  /** Is the harness installed and signed in on this machine? */
  preflight() {
    const bin = this.realBin();
    if (!bin) return { ok: false, reason: 'claude not on PATH' };
    const r = spawnSync(bin, ['auth', 'status'], { encoding: 'utf8', env: { ...process.env, HOME: this.realHome() } });
    let st = null;
    try { st = JSON.parse(r.stdout); } catch { /* not json */ }
    if (!st || !st.loggedIn) return { ok: false, reason: `claude auth status: ${r.stdout || r.stderr}`.slice(0, 300) };
    const v = spawnSync(bin, ['--version'], { encoding: 'utf8' }).stdout.trim();
    return { ok: true, version: v, auth: st.authMethod, bin };
  },

  /** One spawn's stdout → an engine-neutral summary. */
  parseWire(text) {
    const w = { lines: 0, bad: 0, inits: [], sessionIds: new Set(), results: [], tools: [], subagentSpawns: 0, hookEvents: [], apiRetries: 0, rateLimits: [], childInits: 0 };
    for (const line of String(text || '').split('\n')) {
      if (!line.trim()) continue;
      w.lines++;
      let e;
      try { e = JSON.parse(line); } catch { w.bad++; continue; }
      if (e.session_id) w.sessionIds.add(e.session_id);
      if (e.type === 'system' && e.subtype === 'init') {
        w.inits.push({ model: e.model, sessionId: e.session_id, parent: e.parent_tool_use_id || null, tools: e.tools, mcp: e.mcp_servers });
        if (e.parent_tool_use_id) w.childInits++;
      } else if (e.type === 'system' && /^hook_/.test(e.subtype || '')) {
        w.hookEvents.push({ subtype: e.subtype, name: e.hook_name, outcome: e.outcome });
      } else if (e.type === 'system' && e.subtype === 'api_retry') {
        w.apiRetries++;
      } else if (e.type === 'rate_limit_event') {
        w.rateLimits.push(e.rate_limit_info || e);
      } else if (e.type === 'assistant' && e.message && Array.isArray(e.message.content)) {
        for (const b of e.message.content) {
          if (b.type === 'tool_use') {
            w.tools.push({ name: b.name, input: b.input, parent: e.parent_tool_use_id || null });
            if (b.name === 'Task' || b.name === 'Agent') w.subagentSpawns++;
          }
        }
      } else if (e.type === 'result') {
        w.results.push({ subtype: e.subtype, isError: !!e.is_error, costUsd: e.total_cost_usd, turns: e.num_turns, text: typeof e.result === 'string' ? e.result.slice(0, 400) : null, terminal: e.terminal_reason || null, denials: e.permission_denials || [] });
      }
    }
    w.sessionIds = [...w.sessionIds];
    w.result = w.results[w.results.length - 1] || null;
    w.mainInit = w.inits.find((i) => !i.parent) || null;
    return w;
  },

  /** Probe / auxiliary invocations that are not agent work. */
  isProbe(rec) {
    const a = rec.args;
    return a[0] === '--version' || a[0] === '--help' || a[0] === 'auth' || a[0] === 'mcp' || a.length === 0;
  },

  /** A stable label for "which worca call site spawned this": the system
   *  prompt's first heading after the host-guard preamble, plus the prompt's
   *  first line. Pairs spawns across two builds. */
  callSite(rec) {
    const a = rec.args;
    if (this.isProbe(rec)) return `probe:${a.slice(0, 2).join(' ')}`;
    const flag = (f) => { const i = a.indexOf(f); return i >= 0 && a[i + 1] != null && !String(a[i + 1]).startsWith('--') ? a[i + 1] : null; };
    let sys = flag('--append-system-prompt') ?? rec.files['--append-system-prompt-file'] ?? flag('--system-prompt') ?? '';
    sys = sys.replace(PREAMBLE_END, '');
    // A staged invocation passes a bare -p and the prompt on stdin.
    const prompt = String(flag('-p') ?? rec.stdin ?? '');
    const task = /^# Task: (.+)$/m.exec(prompt);
    const first = (s) => (s.split('\n').find((l) => l.trim()) || '').replace(/[`*#]/g, '').trim();
    const what = task ? `task: ${task[1].trim()}` : `${first(sys).slice(0, 50)} / ${first(prompt).replace(/\d+/g, 'N').slice(0, 40)}`;
    const mode = flag('--permission-mode') || '-';
    const agent = flag('--agent') ? ` agent=${flag('--agent')}` : '';
    return `${mode}${agent} | ${what}`;
  },

  /** Argv with run-specific values masked, for build-vs-build diffs. */
  argvShape(rec, mask) {
    const out = [];
    const a = rec.args;
    for (let i = 0; i < a.length; i++) {
      const f = a[i];
      if (f === '-p') { if (a[i + 1] != null && !String(a[i + 1]).startsWith('--')) { out.push(f, '<PROMPT>'); i++; } else out.push(f, '<PROMPT-ON-STDIN>'); continue; }
      if (f === '--resume' || f === '--session-id') { out.push(f, '<SESSION>'); i++; continue; }
      if (f === '--append-system-prompt' || f === '--system-prompt') { out.push(f, `<SYS ${mask(a[i + 1]).length}ch>`); i++; continue; }
      out.push(mask(f));
    }
    return out;
  },
};
