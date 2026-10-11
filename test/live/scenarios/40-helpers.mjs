// test/live/scenarios/40-helpers.mjs
// The one-shot Claude helpers outside the pipeline's agent nodes: model Test,
// PR description, run overview, the agent generator, the Auto classifier.
import { checkWire } from '../lib/checks.mjs';
import { GPT_RE, flagOf, wsCollect } from '../lib/server-api.mjs';
import { codingRun } from './10-pipeline.mjs';

/** The real server; the calc project registered (tolerates "already registered"). */
async function serverFor(t, proj) {
  const srv = await t.sb.server();
  const r = await srv.api('POST', '/api/projects', { name: 'calc', path: proj });
  if (r.status !== 200 && !/already/i.test(r.text)) throw new Error(`POST /api/projects: ${r.status} ${r.text.slice(0, 300)}`);
  return srv;
}

const isTitle = (tp) => /title for this task/i.test(tp.site);
const isTask = (tp) => /\| task: /.test(tp.site);

export default [
  {
    id: 'helpers.models-test',
    title: 'Model Test (POST /api/models/:id/test): built-in id, [1m] id, alias',
    tier: 'smoke', models: 'cheap', diff: true,
    async run(t) {
      const srv = await t.sb.server();
      try {
        const ids = [t.model, 'claude-opus-4-8[1m]', 'claude-sonnet-5-5'];
        for (const id of ids) {
          const before = t.sb.agentTaps().length;
          const r = await srv.api('POST', `/api/models/${encodeURIComponent(id)}/test`, {});
          t.check(`test ${id}: 200`, r.status === 200, `${r.status} ${r.text.slice(0, 300)}`);
          t.check(`test ${id}: ok`, r.json?.ok === true, r.text.slice(0, 300));
          const taps = t.sb.agentTaps().slice(before);
          t.check(`test ${id}: one harness spawn`, taps.length === 1, `${taps.length}`);
          if (taps[0]) t.check(`test ${id}: argv --model ${id}`, flagOf(taps[0], '--model') === id, String(flagOf(taps[0], '--model')));
        }
        // An alias is not a catalog id: the route answers 404 (unchanged behaviour; the diff shows both builds).
        const alias = await srv.api('POST', '/api/models/sonnet/test', {});
        t.note(`alias "sonnet" → ${alias.status} ${alias.text.slice(0, 120)}`);
        t.check('alias "sonnet": answered (200 ok or 404 unknown id)', alias.status === 404 || alias.json?.ok === true, `${alias.status} ${alias.text.slice(0, 200)}`);
        // A Codex built-in id on this machine: must not be tested through claude.
        const before = t.sb.agentTaps().length;
        const gpt = await srv.api('POST', '/api/models/gpt-5.5/test', {});
        const viaClaude = t.sb.agentTaps().slice(before).filter((tp) => flagOf(tp, '--model') === 'gpt-5.5');
        t.note(`gpt-5.5 test → ${gpt.status} ${gpt.text.slice(0, 160)}`);
        t.check('a Codex model test never spawns claude --model gpt-5.5', viaClaude.length === 0, `${viaClaude.length} claude spawns`);
        checkWire(t, t.sb.agentTaps().filter((tp) => flagOf(tp, '--model') !== 'gpt-5.5'), { expectModel: true });
      } finally { await srv.stop(); }
    },
  },
  {
    id: 'helpers.pr-describe-overview',
    title: 'PR description + run overview on a finished run',
    tier: 'core', models: 'cheap',
    async run(t) {
      const { id, proj } = await codingRun(t);
      if (!id) return;
      const row = t.sb.runs().find((r) => r.id === id);
      const key = row?.projectKey;
      t.check('run listed with a project key', !!key, JSON.stringify(row || {}).slice(0, 200));
      const srv = await serverFor(t, proj);
      try {
        let before = t.sb.agentTaps().length;
        const pr = await srv.api('POST', '/api/pr/describe', { id, projectKey: key, baseBranch: 'main' });
        t.check('pr describe: 200', pr.status === 200, `${pr.status} ${pr.text.slice(0, 400)}`);
        t.check('pr describe: body text', typeof pr.json?.body === 'string' && pr.json.body.trim().length > 40, (pr.json?.body || '').slice(0, 200));
        t.check('pr describe: mentions subtract', /subtract/i.test(pr.json?.body || ''), (pr.json?.body || '').slice(0, 200), { severity: 'warn' });
        const prTaps = t.sb.agentTaps().slice(before);
        t.check('pr describe: one harness spawn', prTaps.length === 1, prTaps.map((x) => x.site).join(' | '));
        checkWire(t, prTaps, { expectModel: true });

        before = t.sb.agentTaps().length;
        const ov = await srv.api('POST', `/api/runs/${id}/overview?key=${encodeURIComponent(key)}&force=1`, {});
        t.check('overview: 200', ov.status === 200, `${ov.status} ${ov.text.slice(0, 400)}`);
        const text = JSON.stringify(ov.json?.overview || '');
        t.check('overview: has content', text.length > 80, text.slice(0, 200));
        const ovTaps = t.sb.agentTaps().slice(before);
        t.check('overview: one harness spawn', ovTaps.length === 1, ovTaps.map((x) => x.site).join(' | '));
        checkWire(t, ovTaps, { expectModel: true });
        t.note(`overview keys: ${Object.keys(ov.json?.overview || {}).join(',')}`);
      } finally { await srv.stop(); }
    },
  },
  {
    id: 'helpers.agent-generator',
    title: 'Agent generator (POST /api/agents/generate) drafts an agent',
    tier: 'core', models: 'cheap',
    async run(t) {
      const srv = await t.sb.server();
      try {
        const r = await srv.api('POST', '/api/agents/generate', { name: 'live-changelog-writer', purpose: 'Writes a short CHANGELOG.md entry summarising the diff of the current branch.' });
        t.check('generate: 200 with genId', r.status === 200 && !!r.json?.genId, `${r.status} ${r.text.slice(0, 300)}`);
        if (!r.json?.genId) return;
        const frames = await wsCollect(t, srv, { genId: r.json.genId },
          (f) => f.genId === r.json.genId && (f.type === 'agentgen-done' || f.type === 'agentgen-error'), 600000);
        const mine = frames.filter((f) => f.genId === r.json.genId);
        const done = mine.find((f) => f.type === 'agentgen-done');
        const err = mine.find((f) => f.type === 'agentgen-error');
        t.check('generate: agentgen-done', !!done, err ? `error: ${err.message}` : `frames: ${mine.map((f) => f.type).join(',')}`);
        t.check('generate: progress frames streamed', mine.some((f) => f.type === 'agentgen-progress'), mine.map((f) => f.type).join(','), { severity: 'warn' });
        const draft = done?.draft;
        t.check('draft: markdown body', typeof draft?.markdown === 'string' && draft.markdown.length > 100, String(draft?.markdown || '').slice(0, 200));
        t.check('draft: meta object', draft?.meta && typeof draft.meta === 'object', JSON.stringify(draft?.meta || null).slice(0, 300));
        checkWire(t, t.sb.agentTaps(), { expectModel: true });
      } finally { await srv.stop(); }
    },
  },
  {
    id: 'helpers.auto-classifier',
    title: 'Auto workflow: the classifier spawn, its booked cost, no gpt-* models offered',
    tier: 'core', models: 'cheap', diff: true,
    async run(t) {
      const { id } = await codingRun(t, { workflow: 'auto' });
      const aux = t.sb.agentTaps().filter((tp) => !isTask(tp) && !isTitle(tp));
      t.note(`non-node spawns: ${aux.map((x) => x.site).join(' | ')}`);
      t.check('classifier spawn recorded', aux.length >= 1, t.sb.agentTaps().map((x) => x.site).join(' | '));
      for (const tp of aux) {
        const text = tp.args.join('\n') + (tp.stdin || '') + Object.values(tp.files || {}).join('\n');
        const gpt = [...new Set(text.match(GPT_RE) || [])];
        t.check(`classifier prompt offers no gpt-* model (${tp.site.slice(0, 40)})`, gpt.length === 0, gpt.join(','));
      }
      if (!id) return;
      const metas = t.sb.query('select node_id, exec_meta from pipeline_steps where pipeline_id = ? and exec_meta is not null', id)
        .map((r) => { try { return { node: r.node_id, aux: JSON.parse(r.exec_meta).auxCosts || null }; } catch { return { node: r.node_id, aux: null }; } })
        .filter((r) => r.aux);
      t.note(`auxCosts: ${JSON.stringify(metas)}`);
      const kinds = Object.fromEntries(metas.flatMap((m) => Object.entries(m.aux)));
      const cls = Object.entries(kinds).filter(([k]) => !/title/i.test(k));
      t.check('classifier cost booked in auxCosts (> 0)', cls.some(([, v]) => (v.usd || 0) > 0), JSON.stringify(kinds));
      const wireCls = aux.reduce((a, tp) => a + (tp.wire?.result?.costUsd || 0), 0);
      t.check('classifier wire cost > 0', wireCls > 0, `wire=${wireCls}`);
    },
  },
];
