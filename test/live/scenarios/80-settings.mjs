// test/live/scenarios/80-settings.mjs
// Settings on the Claude harness: a settings.json written by the previous build
// keeps working on this one (read, re-saved unchanged, used by a run), a gateway
// custom model may use any id its endpoint serves, and sub-agent hook telemetry
// (WORCA_SUBAGENT_HOOKS) fills the sub-agent rows without disturbing the run.
import { existsSync, readFileSync } from 'node:fs';
import { createSandbox } from '../lib/sandbox.mjs';
import { SUBTRACT_TASK, checkCalcRun, checkRunBookkeeping, checkRunDone } from '../lib/checks.mjs';
import { flagOf, implementOnly, nodeTaps, rawEvents, settingsOf } from '../lib/scenario-kit.mjs';

const BASELINE_REPO = process.env.LIVE_BASELINE_REPO || '/Users/sdjukic/dev/worca-cc-baseline';

// What a user of the previous build had saved: one value per settings family.
const SAVED = {
  titleModel: 'claude-haiku-4-5',
  autoWorkflowModel: 'claude-sonnet-5-5',
  prDescriptionModel: 'claude-haiku-4-5',
  askMaxTurns: 20,
  askMaxBudgetUsd: null,
  askWeb: { enabled: true, allowedDomains: ['example.com'] },
  hideBuiltinModels: false,
  humanRateUsdPerHour: 90,
  pipelineCostLimitUsd: 25,
  memoryDefrag: { model: 'claude-sonnet-5-5', effort: 'medium' },
  nightMode: { enabled: false, graceMinutes: 45, strategy: 'mixed', deciderModel: 'claude-haiku-4-5', deciderEffort: 'high' },
};
const CUSTOM = { id: 'live-custom-gw', label: 'Live custom gateway', env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', ANTHROPIC_AUTH_TOKEN: 'live-dummy' } };

const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));
const canon = (v) => JSON.stringify(v, Object.keys(v ?? {}).sort());

export default [
  {
    id: 'settings.compat',
    title: "the previous build's settings.json: read, re-saved unchanged, and a run still works",
    tier: 'core', models: 'cheap',
    async run(t) {
      if (!existsSync(BASELINE_REPO)) t.skip(`no baseline checkout at ${BASELINE_REPO} (set LIVE_BASELINE_REPO)`);
      // 1. The previous build writes the settings, in this sandbox's HOME.
      const old = createSandbox({ repo: BASELINE_REPO, profile: t.profile, outDir: t.sb.base, label: 'baseline', base: t.sb.base });
      const bsrv = await old.server();
      let before;
      try {
        const m = await bsrv.api('POST', '/api/models', CUSTOM);
        t.check('baseline: custom model saved', m.status === 200, m.text.slice(0, 300));
        for (const [k, v] of Object.entries(SAVED)) {
          const r = await bsrv.api('POST', '/api/settings', { [k]: v });
          t.check(`baseline: ${k} saved`, r.status === 200, r.text.slice(0, 300));
        }
        before = (await bsrv.api('GET', '/api/settings')).json;
      } finally { await bsrv.stop(); }
      const fileBefore = JSON.parse(readFileSync(t.sb.settingsFile, 'utf8'));

      // 2. This build reads them.
      const srv = await t.sb.server();
      try {
        const got = await srv.api('GET', '/api/settings');
        t.check('GET /api/settings 200', got.status === 200, got.text.slice(0, 300));
        for (const k of Object.keys(SAVED)) {
          if (k === 'nightMode') {
            const nm = got.json?.nightMode || {};
            for (const [f, v] of Object.entries(SAVED.nightMode)) t.check(`read back nightMode.${f}`, canon(nm[f]) === canon(v), `got ${JSON.stringify(nm[f])} (baseline read ${JSON.stringify(before?.nightMode?.[f])})`);
            continue;
          }
          t.check(`read back ${k}`, canon(got.json?.[k]) === canon(before?.[k]), `this build ${JSON.stringify(got.json?.[k])} vs baseline ${JSON.stringify(before?.[k])}`);
        }
        const models = await srv.api('GET', '/api/models');
        const ids = JSON.stringify(models.json ?? models.text);
        t.check('the custom model is still in the catalog', ids.includes(CUSTOM.id), ids.slice(0, 300));

        // 3. Saved back unchanged.
        const back = await srv.api('POST', '/api/settings', pick(got.json, Object.keys(SAVED)));
        t.check('POST the same settings back: accepted', back.status === 200, back.text.slice(0, 400));
        const again = await srv.api('GET', '/api/settings');
        for (const k of Object.keys(SAVED)) t.check(`unchanged after re-save: ${k}`, canon(again.json?.[k]) === canon(got.json?.[k]), `${JSON.stringify(again.json?.[k])} vs ${JSON.stringify(got.json?.[k])}`);
      } finally { await srv.stop(); }
      const fileAfter = JSON.parse(readFileSync(t.sb.settingsFile, 'utf8'));
      const lost = Object.keys(fileBefore).filter((k) => !(k in fileAfter));
      t.check('no settings.json key dropped by the re-save', lost.length === 0, lost.join(','));

      // 4. A run on the migrated settings, title on the saved titleModel.
      const r = await implementOnly(t, SUBTRACT_TASK);
      t.check('cli: exit 0', r.res.code === 0, `${r.res.stderr.slice(-400)} ${r.res.stdout.slice(-500)}`);
      if (r.id) { const run = checkRunDone(t, t.sb, r.id); checkCalcRun(t, t.sb, r.proj, run); }
      const title = t.sb.agentTaps().find((tp) => /title for this task/i.test(tp.site));
      t.check('the run title used the saved titleModel', title && flagOf(title, '--model') === SAVED.titleModel, title ? flagOf(title, '--model') : 'no title spawn');
    },
  },

  {
    id: 'settings.gateway-model-id',
    title: 'a gateway custom model may be named gpt-5.5 (an id its endpoint serves) (R6)',
    tier: 'core', models: 'cheap', diff: true,
    async run(t) {
      const srv = await t.sb.server();
      try {
        const env = { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', ANTHROPIC_AUTH_TOKEN: 'live-dummy' };
        const plain = await srv.api('POST', '/api/models', { id: 'gpt-5.5', label: 'GPT via my gateway', env });
        t.note(`POST /api/models {id:"gpt-5.5", env:{ANTHROPIC_BASE_URL}} → ${plain.status} ${plain.text.slice(0, 200)}`);
        // DECISION NEEDED (R6): the multi-harness build reserves the Codex built-in ids, so a gateway model of that name
        // is refused; the previous build accepted it. Reported, not failed, until that is decided.
        t.check('a Claude-engine gateway model named gpt-5.5 is accepted (R6, decision needed)', plain.status === 200, plain.text.slice(0, 300), { severity: 'warn' });
        const other = await srv.api('POST', '/api/models', { id: 'gpt-4.1-gw', label: 'Other gateway id', env });
        t.check('control: a non-colliding gateway id is accepted', other.status === 200, other.text.slice(0, 300));
      } finally { await srv.stop(); }
    },
  },

  {
    id: 'telemetry.subagent-rows',
    title: 'a node that fans out sub-agents gets one closed sub_agents row per sub-agent (no hook telemetry)',
    tier: 'core', models: 'cheap', diff: true,
    run: (t) => fanOut(t, { hooks: false }),
  },
  {
    id: 'telemetry.subagent-hooks',
    title: 'WORCA_SUBAGENT_HOOKS=1: the Agent PostToolUse hook fills sub-agent rows; the run model stays the main one (R5)',
    tier: 'core', models: 'cheap', diff: true,
    env: { WORCA_SUBAGENT_HOOKS: '1' },
    run: (t) => fanOut(t, { hooks: true }),
  },
];

async function fanOut(t, { hooks }) {
  const prompt = 'Before anything else, use your sub-agent tool (Agent / Task) to launch TWO sub-agents in parallel, in ONE message: '
    + 'sub-agent A reads src/calc.mjs and returns the names of its exported functions; sub-agent B reads test/calc.test.mjs and returns its test names. '
    + 'Wait for both reports. Then do this task:\n\n' + SUBTRACT_TASK;
  const r = await implementOnly(t, prompt);
  t.check('cli: exit 0', r.res.code === 0, `${r.res.stderr.slice(-400)} ${r.res.stdout.slice(-500)}`);
  if (!r.id) return;
  const run = checkRunDone(t, t.sb, r.id);
  checkRunBookkeeping(t, t.sb, r.id);
  checkCalcRun(t, t.sb, r.proj, run);
  const tp = nodeTaps(t.sb)[0];
  t.check('implementer spawned', !!tp, '');
  if (!tp) return;
  const kinds = rawEvents(tp).filter((e) => e.type === 'system' && e.subtype === 'task_started').map((e) => (e.is_backgrounded ? 'background' : 'foreground'));
  t.note(`sub-agent launches on the wire: ${kinds.join(',') || '(none)'}`);
  t.check('the agent fanned out (precondition)', tp.wire.subagentSpawns >= 1, `spawns=${tp.wire.subagentSpawns} tools=${tp.wire.tools.map((x) => x.name).join(',')}`);
  if (hooks) {
    t.check('argv: --include-hook-events', tp.args.includes('--include-hook-events'), tp.args.filter((a) => a.startsWith('--')).join(' '));
    const post = settingsOf(tp)?.hooks?.PostToolUse || [];
    t.check('--settings: PostToolUse hook on Agent', post.some((h) => h.matcher === 'Agent' && h.hooks?.some((x) => x.type === 'command')), JSON.stringify(post));
    t.note(`hook command: ${JSON.stringify(post.flatMap((h) => h.hooks))}`);
    const resp = tp.wire.hookEvents.filter((h) => h.subtype === 'hook_response' && /PostToolUse:Agent/.test(h.name || ''));
    t.check('PostToolUse:Agent hook responses streamed', resp.length >= 1, JSON.stringify(tp.wire.hookEvents.map((h) => h.name)).slice(0, 300));
  } else {
    t.check('argv: no --include-hook-events when telemetry is off', !tp.args.includes('--include-hook-events'), '');
  }
  const rows = t.sb.query("select id, label, status, duration_ms, tokens, cost_usd, run_model, subagent_type from sub_agents where pipeline_id = ? and coalesce(subagent_type, '') <> 'run-title' and coalesce(node_id, '') <> 'preflight'", r.id);
  t.note(`sub_agents: ${JSON.stringify(rows).slice(0, 700)}`);
  t.check('one sub_agents row per launched sub-agent', rows.length >= tp.wire.subagentSpawns && rows.length > 0, `${rows.length} rows for ${tp.wire.subagentSpawns} launches (${kinds.join(',')})`);
  t.check('every sub-agent row is closed', rows.every((x) => ['finished', 'failed', 'stopped'].includes(x.status)), JSON.stringify(rows.map((x) => x.status)));
  if (hooks) t.check('hook telemetry filled duration and tokens', rows.length > 0 && rows.every((x) => x.duration_ms > 0 && x.tokens > 0), JSON.stringify(rows).slice(0, 500));
  // Known on both builds: sub-agent rows carry no cost (the hook payload has usage, no price), and
  // subagent_type is read from the Agent tool input only, so it is null when the model omits it.
  t.note(`sub-agent cost_usd: ${rows.map((x) => x.cost_usd).join(',')}; subagent_type: ${rows.map((x) => x.subagent_type).join(',')}`);
  const titles = t.sb.query("select count(*) n from sub_agents where pipeline_id = ? and subagent_type = 'run-title'", r.id)[0]?.n;
  t.check('one run-title row (the title helper did not run the task itself)', titles === 1, `${titles} run-title rows — the title spawn must run with no tools (--tools "" --strict-mcp-config)`);
  // R5: the step's recorded model is the main session's, never a sub-agent's init.
  const detail = JSON.stringify(t.sb.runShow(r.id) || {});
  const used = [...new Set([...detail.matchAll(/"modelUsed":"([^"]+)"/g)].map((m) => m[1]))];
  t.note(`child inits on the wire: ${tp.wire.childInits}; main init: ${tp.wire.mainInit?.model}; modelUsed in run detail: ${used.join(',') || '(not exposed)'}`);
  if (used.length) t.check('modelUsed is the main session model', used.every((m) => t.profile.expectInitModel(t.model).test(m)), used.join(','));
  t.check('main init model is the requested model', t.profile.expectInitModel(t.model).test(tp.wire.mainInit?.model || ''), tp.wire.mainInit?.model);
}
