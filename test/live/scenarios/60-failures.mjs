// test/live/scenarios/60-failures.mjs
// Failure paths on the Claude harness: what a user sees when the model id is
// wrong, the endpoint refuses the credential, the CLI is signed out, worca's MCP
// registry is damaged, or a Codex model id lands on a Claude run. Each must end
// fast and readably — never a hang, never a silent fallback.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SUBTRACT_TASK, checkCalcRun, checkRunDone } from '../lib/checks.mjs';
import { fakeGateway, flagOf, implementOnly, nodeTaps, retargetTapHome, waitTerminal, registerProject } from '../lib/scenario-kit.mjs';

const FAST_MS = 3 * 60 * 1000;
const NOOP_PROMPT = 'Reply with the single word OK. Do not use any tool and do not modify any file.';

/** Everything a user could read about why the run stopped. */
function why(res, run) {
  return [res?.stdout?.slice(-1500), res?.stderr?.slice(-800), run?.pauseReason, JSON.stringify(run?.pauseDetail ?? '')].filter(Boolean).join(' ‖ ');
}

function checkFailedFast(t, { res, run, ms }, { reason }) {
  t.check('ended fast (< 3 min, no hang)', ms < FAST_MS && !res.timedOut, `${Math.round(ms / 1000)}s`);
  t.check('run did not report success', !run || run.status !== 'done', `status=${run?.status}`);
  t.check('run is in a terminal state (or the CLI refused it)', !run || ['error', 'paused', 'stopped', 'failed'].includes(run.status), `status=${run?.status}`);
  const text = why(res, run);
  t.check(`the reason is readable (${reason})`, reason.test(text), text.slice(-700));
}

export default [
  {
    id: 'fail.unknown-model',
    title: '--model claude-nonexistent-9: a fast, readable failure, no retry storm',
    tier: 'core', models: ['claude-nonexistent-9'], diff: true,
    async run(t) {
      const r = await implementOnly(t, NOOP_PROMPT, { timeoutMs: 8 * 60 * 1000 });
      t.note(`cli exit=${r.res.code} status=${r.run?.status} pause=${r.run?.pauseReason} ${Math.round(r.ms / 1000)}s`);
      checkFailedFast(t, r, { reason: /claude-nonexistent-9|model/i });
      const taps = nodeTaps(t.sb);
      t.check('at most 3 agent spawns (no retry storm)', taps.length <= 3, `${taps.length} spawns`);
      t.check('no API retry storm on the wire', taps.every((tp) => tp.wire.apiRetries <= 2), taps.map((tp) => tp.wire.apiRetries).join(','));
    },
  },

  {
    id: 'fail.gateway-403',
    title: 'a custom model whose endpoint answers 403: auth error, one request, fast',
    tier: 'core', models: ['live-gw-403'], diff: true,
    async run(t) {
      const gw = await fakeGateway({ status: 403 });
      try {
        const srv = await t.sb.server();
        let add;
        try {
          add = await srv.api('POST', '/api/models', { id: 'live-gw-403', label: 'Live 403 gateway', env: { ANTHROPIC_BASE_URL: gw.url, ANTHROPIC_AUTH_TOKEN: 'live-suite-dummy-token' } });
        } finally { await srv.stop(); }
        t.check('custom model added', add.status === 200, add.text.slice(0, 300));
        const r = await implementOnly(t, NOOP_PROMPT, { timeoutMs: 8 * 60 * 1000 });
        t.note(`cli exit=${r.res.code} status=${r.run?.status} pause=${r.run?.pauseReason} ${Math.round(r.ms / 1000)}s; gateway hits=${gw.hits.length}`);
        checkFailedFast(t, r, { reason: /403|Failed to authenticate|credential refused/i });
        t.check("classified as an auth problem (pause reason auth)", /auth/i.test(String(r.run?.pauseReason || "") + JSON.stringify(r.run?.pauseDetail || "").slice(0, 80)), `pause=${r.run?.pauseReason} ${JSON.stringify(r.run?.pauseDetail || "").slice(0, 200)} (pre-existing: the baseline classifies it the same way)`, { severity: "warn" });
        t.check('the gateway was actually called', gw.hits.length > 0, `${gw.hits.length}`);
        const posts = gw.hits.filter((h) => h.method === 'POST');
        t.check('few model requests (a 403 is not retried)', posts.length <= 6, `${posts.length} POSTs: ${posts.map((h) => h.url).join(',').slice(0, 200)}`);
        const taps = nodeTaps(t.sb);
        t.check('the spawn carried ANTHROPIC_BASE_URL of the gateway', taps.some((tp) => tp.env.ANTHROPIC_BASE_URL === gw.url), taps.map((tp) => tp.env.ANTHROPIC_BASE_URL).join(','));
        t.check('no API retries on the wire', taps.every((tp) => tp.wire.apiRetries === 0), taps.map((tp) => tp.wire.apiRetries).join(','));
      } finally { await gw.close(); }
    },
  },

  {
    id: 'fail.signed-out',
    title: 'claude signed out (empty HOME): worca says "not signed in", fast',
    tier: 'core', models: 'cheap', diff: true,
    async run(t) {
      const empty = join(t.sb.base, 'signed-out-home');
      mkdirSync(empty, { recursive: true });
      retargetTapHome(t.sb, empty);
      const r = await implementOnly(t, NOOP_PROMPT, { timeoutMs: 8 * 60 * 1000 });
      t.note(`cli exit=${r.res.code} status=${r.run?.status} pause=${r.run?.pauseReason} ${Math.round(r.ms / 1000)}s`);
      checkFailedFast(t, r, { reason: /sign(ed)? ?in|log ?in|not logged|auth/i });
      const taps = nodeTaps(t.sb);
      t.check('at most 3 agent spawns', taps.length <= 3, `${taps.length}`);
    },
  },

  {
    id: 'fail.corrupt-mcp-registry',
    title: "a damaged MCP registry (mcp/servers.json is a directory): the run warns and continues (R2)",
    tier: 'core', models: 'cheap', diff: true,
    async run(t) {
      const mcp = join(t.sb.worca, '.worca-cc', 'mcp');
      mkdirSync(join(mcp, 'servers.json'), { recursive: true });
      mkdirSync(join(mcp, 'sets.json'), { recursive: true });
      mkdirSync(join(mcp, 'secrets.json'), { recursive: true });
      const r = await implementOnly(t, SUBTRACT_TASK);
      const warn = (r.res.stdout + r.res.stderr).split('\n').filter((l) => /MCP|registry/i.test(l)).slice(0, 4).join(' | ');
      t.note(`cli exit=${r.res.code} status=${r.run?.status}; mcp lines: ${warn || '(none)'}`);
      t.check('cli: exit 0 (the damaged registry did not abort the run)', r.res.code === 0, why(r.res, r.run).slice(-700));
      if (r.id) {
        const run = checkRunDone(t, t.sb, r.id);
        checkCalcRun(t, t.sb, r.proj, run);
      }
    },
  },

  {
    id: 'fail.codex-model-on-claude',
    title: 'a Codex model id (gpt-5.5) on a Claude run: refused or a clear error, never a silent fallback (R3)',
    tier: 'core', models: ['gpt-5.5'], diff: true,
    async run(t) {
      // CLI path.
      const r = await implementOnly(t, NOOP_PROMPT, { timeoutMs: 10 * 60 * 1000 });
      const taps = nodeTaps(t.sb);
      const used = taps.map((tp) => ({ argv: flagOf(tp, '--model'), init: tp.wire?.mainInit?.model || null }));
      t.note(`CLI: exit=${r.res.code} status=${r.run?.status} pause=${r.run?.pauseReason}; node spawns=${JSON.stringify(used)}; out=${why(r.res, r.run).slice(-300)}`);
      const silent = r.run?.status === 'done' && used.some((u) => u.argv !== 'gpt-5.5');
      t.check('CLI: no silent fallback (a done run whose nodes ran on another model)', !silent, JSON.stringify(used));
      t.check('CLI: refused, errored, or really ran gpt-5.5 as asked', r.res.code !== 0 || r.run?.status !== 'done' || used.every((u) => u.argv === 'gpt-5.5'), JSON.stringify(used));

      // Server path: a defragment run is the one start that takes a model pair (checkStartPair).
      const srv = await t.sb.server();
      try {
        await registerProject(srv, r.proj);
        const before = new Set(t.sb.runs().map((x) => x.id));
        const start = await srv.api('POST', '/api/run', { projectDir: r.proj, workflowId: 'wf_memory_defrag', memoryScope: 'project', model: 'gpt-5.5', prompt: 'Defragment project memory.', title: 'live defrag gpt' });
        t.note(`API defrag start with model gpt-5.5: ${start.status} ${start.text.slice(0, 200)}`);
        if (start.status >= 200 && start.status < 300) {
          const row = await waitTerminal(t.sb, null, { timeoutMs: 15 * 60 * 1000 });
          const fresh = t.sb.runs().find((x) => !before.has(x.id));
          const seen = new Set(taps.map((x) => x.seq));
          const dtaps = t.sb.agentTaps().filter((tp) => !seen.has(tp.seq) && /\| task: /.test(tp.site));
          const dused = dtaps.map((tp) => flagOf(tp, '--model'));
          t.note(`API defrag run ${fresh?.id} → ${row?.status}; node --model: ${dused.join(',') || '(no agent spawn)'}`);
          t.check('API: accepted defrag run does not silently run another model', !(fresh?.status === 'done' && dused.some((m) => m && m !== 'gpt-5.5')), dused.join(','));
        } else {
          t.check('API: refusal names the model', /gpt-5\.5|model|codex/i.test(start.text), start.text.slice(0, 300));
        }
      } finally { await srv.stop(); }
    },
  },
];
