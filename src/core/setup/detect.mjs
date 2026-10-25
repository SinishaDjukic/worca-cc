// src/core/setup/detect.mjs — GET /api/setup/detect (D18): the setup assistant's "Check this machine"
// step. Each check answers ok | warn | no and one plain-words line; probes are injected so tests reach no
// network and spawn nothing. The Claude check is onboarding's detectClaude, so the Getting started tile
// never disagrees (D21).
import { detectClaude } from '../onboarding.mjs';
import { gitState } from '../git-available.mjs';
import { engineReadiness } from '../engines/readiness.mjs';
import { probeReachable, ANTHROPIC_API } from '../upstream-probe.mjs';
import { upstreamEnv } from '../proxy-credentials.mjs';
import { loadUndici } from '../env-proxy.mjs';
import { CLAUDE_SIGNED_OUT_HINT } from '../model-test.mjs';
import { userLine } from '../settings-errors.mjs';

export const DETECT_BUDGET_MS = 2500;
export const OLLAMA_URL = 'http://127.0.0.1:11434';
const TIMEOUT = Symbol('timeout');

/** One direct (no proxy) Agent, made on first use: the server's global dispatcher may route through the corporate proxy (env-proxy.mjs). */
let directAgent;
function directFetch(url, opts = {}) {
  const undici = loadUndici();
  if (!undici) return fetch(url, opts);       // no undici: Node's default dispatcher, as env-proxy.mjs falls back
  directAgent ??= new undici.Agent();
  return fetch(url, { ...opts, dispatcher: directAgent });
}

/** host:port only: a proxy URL may carry user:password, and a scheme-less value (proxy:8080) is common. */
function proxyHostOf(raw) {
  const s = String(raw).trim();
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`);
    return u.hostname ? (u.port ? `${u.hostname}:${u.port}` : u.hostname) : null;
  } catch { return null; }
}

/**
 * The default probes. `sourceEnv` is the env before the local proxy took HTTPS_PROXY (proxy-host.mjs); with
 * the egress proxy on it holds only the proxy variables, so non-proxy checks read `processEnv` instead.
 */
export function defaultProbes({ sourceEnv = () => upstreamEnv(process.env), recheck = false } = {}) {
  return {
    claude: () => detectClaude({ recheck }),
    git: () => gitState({ fresh: recheck }),
    sourceEnv,
    processEnv: () => process.env,
    direct: () => probeReachable(ANTHROPIC_API, { timeoutMs: DETECT_BUDGET_MS - 300, fetch: directFetch }),
    engines: () => engineReadiness({ force: recheck }),
    ollama: async () => {
      try {
        const res = await directFetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
        if (!res.ok) return null;
        const body = await res.json().catch(() => ({}));
        return { models: Array.isArray(body.models) ? body.models.length : 0 };
      } catch { return null; }   // nothing listening on 11434 is the normal "absent", not a failed check
    },
  };
}

const row = (id, label, state, line, facts) => ({ id, label, state, line, ...(facts ? { facts } : {}) });

/** One entry per D18 check, in display order. `run(p)` returns the probe's raw answer; `read(raw)` turns it into a row. */
export const DETECT_CHECKS = Object.freeze([
  { id: 'claude', label: 'Claude Code', run: (p) => p.claude(), read: (c) =>
    !c.ready ? ['no', c.hint ? userLine(c.hint, 'Claude Code') : 'Claude Code was not found on this machine.']
      : c.auth === 'signed-in' ? ['ok', 'Claude Code is installed and signed in.']
        : c.auth === 'signed-out' ? ['no', CLAUDE_SIGNED_OUT_HINT]
          : ['warn', "Claude Code is installed. Worca couldn't tell whether it is signed in."] },
  { id: 'git', label: 'Git', run: (p) => p.git(), read: (g) =>
    g.available ? ['ok', g.version ? `Git ${g.version} is installed.` : 'Git is installed.']
      : g.reason === 'probe-failed' ? ['warn', "Git didn't answer when Worca checked it."]
        : g.reason === 'forced-off' ? ['warn', 'Worca is set not to use Git here (WORCA_GIT=0).']
          : g.reason === 'not-probed' ? ['warn', "Git hasn't been checked yet."]
            : ['no', 'Git was not found on this machine.'] },
  { id: 'proxyEnv', label: 'Proxy in your environment', run: (p) => p.sourceEnv(), read: (env) => {
    const raw = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
    const host = raw ? proxyHostOf(raw) : null;
    const noProxy = env.NO_PROXY || env.no_proxy || '';
    return host ? ['ok', `Your environment sends traffic through ${host}.`, { host, noProxy }] : ['no', 'No proxy is set in your environment.'];
  } },
  { id: 'direct', label: 'Direct connection', run: (p) => p.direct(), read: (up) =>
    up ? ['ok', 'api.anthropic.com answers directly.']
      : ['no', "api.anthropic.com can't be reached directly. On a company network this usually means a proxy is needed."] },
  { id: 'harnesses', label: 'Coding agents', run: (p) => p.engines(), read: (list) => {
    const ready = list.filter((e) => e.ready);
    const not = list.filter((e) => !e.ready);
    const facts = { engines: list.map(({ name, label, ready: r, reason }) => ({ name, label, ready: r, reason })) };
    if (!ready.length) return ['no', 'No coding agent is ready on this machine.', facts];
    const head = `Ready: ${ready.map((e) => e.label).join(', ')}.`;
    // The row shows a short, guarded reason; the full one stays in facts.engines[].reason (ux-2-1).
    const why = (r) => { const t = userLine(r, 'Coding agents').replace(/\.$/, ''); return t.length > 80 ? `${t.slice(0, 79).trimEnd()}…` : t; };
    return not.length ? ['warn', `${head} Not ready: ${not.map((e) => `${e.label}${e.reason ? ` (${why(e.reason)})` : ''}`).join(', ')}.`, facts] : ['ok', head, facts];
  } },
  { id: 'ollama', label: 'Local Ollama', run: (p) => p.ollama(), read: (o) =>
    o ? ['ok', `Ollama is running here with ${o.models} model${o.models === 1 ? '' : 's'}.`, { models: o.models }]
      : ['no', 'No Ollama is running on port 11434.'] },
  { id: 'apiKey', label: 'Anthropic API key', run: (p) => p.processEnv(), read: (env) =>
    env.ANTHROPIC_API_KEY ? ['ok', 'ANTHROPIC_API_KEY is set in your environment.'] : ['no', 'ANTHROPIC_API_KEY is not set.'] },
]);

/**
 * Run every check in parallel, each under `budgetMs`. Never throws.
 * @returns {Promise<{checks: Array<{id,label,state:'ok'|'warn'|'no',line,facts?}>, ms:number}>}
 */
export async function detectSetup({ probes = defaultProbes(), budgetMs = DETECT_BUDGET_MS, now = Date.now } = {}) {
  const t0 = now();
  const checks = await Promise.all(DETECT_CHECKS.map(async ({ id, label, run, read }) => {
    let timer;
    try {
      const raw = await Promise.race([Promise.resolve().then(() => run(probes)),
        new Promise((r) => { timer = setTimeout(() => r(TIMEOUT), budgetMs); timer.unref?.(); })]);
      if (raw === TIMEOUT) return row(id, label, 'warn', "Couldn't check this in time.");
      const [state, line, facts] = read(raw ?? null);
      return row(id, label, state, line, facts);
    } catch {
      return row(id, label, 'warn', "Couldn't check this.");   // never echo err.message: it may hold a credentialed URL (A14)
    } finally { clearTimeout(timer); }
  }));
  return { checks, ms: now() - t0 };
}
