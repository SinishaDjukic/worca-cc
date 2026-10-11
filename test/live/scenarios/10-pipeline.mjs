// test/live/scenarios/10-pipeline.mjs
// Pipelines end to end through the CLI on the calc fixture.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SUBTRACT_TASK, checkCalcRun, checkRunBookkeeping, checkRunDone, checkWire, oracle, runIdFrom, SUBTRACT_ORACLE } from '../lib/checks.mjs';

async function codingRun(t, { workflow = 'wf_default', extra = [], expectModel = true, model = t.model, project = 'calc', prompt = SUBTRACT_TASK } = {}) {
  const proj = t.sb.addProject(project);
  const res = await t.sb.cli(['--project', proj, '--prompt', prompt, '--yes', ...(model ? ['--model', model] : []), '--workflow', workflow, '--title', `live ${workflow}`, ...extra]);
  t.check('cli: exit 0', res.code === 0, `code=${res.code} ${res.stderr.slice(-600)} ${res.stdout.slice(-900)}`);
  const id = runIdFrom(t.sb, res);
  t.check('cli: run id found', !!id, res.stdout.slice(-400));
  if (!id) return { proj, res };
  const run = checkRunDone(t, t.sb, id);
  checkRunBookkeeping(t, t.sb, id);
  checkCalcRun(t, t.sb, proj, run);
  checkWire(t, t.sb.agentTaps(), { expectModel });
  return { id, run, proj, res };
}

/** Export a built-in workflow, let `edit` change its v2 graph, import it; returns the new id. */
function importEdited(t, fromId, name, edit) {
  const ex = t.sb.cliSync(['workflow', 'export', fromId, '--format', 'json']);
  if (ex.status !== 0) throw new Error(`export ${fromId}: ${ex.stderr}`);
  const graph = JSON.parse(ex.stdout);
  edit(graph);
  graph.name = name;
  const file = join(t.sb.base, `${name.replace(/\W+/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(graph, null, 2));
  const im = t.sb.cliSync(['workflow', 'import', file, '--name', name]);
  if (im.status !== 0) throw new Error(`import: ${im.stderr} ${im.stdout}`);
  const list = t.sb.cliSync(['workflow', 'list']).stdout.split('\n').map((l) => l.split('\t'));
  const row = list.find((r) => r[1] === name);
  if (!row) throw new Error(`imported workflow "${name}" not listed:\n${list.join('\n')}`);
  return row[0];
}

const taskOf = (tp) => (/task: (.+)$/.exec(tp.site) || [])[1] || null;
const flagOf = (tp, f) => { const i = tp.args.indexOf(f); return i >= 0 ? tp.args[i + 1] : null; };

export default [
  {
    id: 'pipeline.default',
    title: 'wf_default (clarify → plan → refine → implement → review) on the calc fixture',
    tier: 'smoke', models: 'cheap', diff: true,
    async run(t) {
      const { res } = await codingRun(t);
      t.check('cli: prints the result line', /Result: completed/.test(res?.stdout || ''), (res?.stdout || '').slice(-300));
    },
  },
  {
    id: 'pipeline.models',
    title: 'wf_default on every model in the matrix (ids, aliases, [1m])',
    tier: 'core', models: 'matrix',
    async run(t) {
      await codingRun(t);
      const nodes = t.sb.agentTaps().filter((tp) => taskOf(tp));
      t.check('every agent node got --model as asked', nodes.length > 0 && nodes.every((tp) => flagOf(tp, '--model') === t.model),
        nodes.map((tp) => `${taskOf(tp)}=${flagOf(tp, '--model')}`).join(', '));
    },
  },
  {
    id: 'pipeline.mixed-models',
    title: 'per-node model + effort from the workflow reach each node (opus / sonnet / haiku mix)',
    tier: 'core', models: ['mixed'],
    async run(t) {
      const plan = {
        // efforts each model accepts: src/core/config.mjs (haiku-4-5: medium|high)
        n_clarify: { model: 'claude-haiku-4-5', effort: 'high' },
        n_plan: { model: 'claude-opus-5-5', effort: 'xhigh' },
        n_refine: { model: 'claude-sonnet-5-5', effort: 'medium' },
        n_impl: { model: 'claude-haiku-4-5', effort: 'medium' },
        n_review: { model: 'claude-sonnet-5-5', effort: 'high' },
      };
      const id = importEdited(t, 'wf_default', 'Live mixed models', (g) => {
        for (const n of g.nodes) if (plan[n.id]) n.config = { ...(n.config || {}), ...plan[n.id] };
      });
      t.note(`imported workflow ${id}`);
      await codingRun(t, { workflow: id, model: null });
      const byTask = { Clarify: 'n_clarify', Plan: 'n_plan', 'Refine Plan': 'n_refine', Implementation: 'n_impl', 'Review Implementation': 'n_review' };
      for (const tp of t.sb.agentTaps()) {
        const node = byTask[taskOf(tp)];
        if (!node) continue;
        t.check(`${node}: --model ${plan[node].model}`, flagOf(tp, '--model') === plan[node].model, `argv --model=${flagOf(tp, '--model')}`);
        t.check(`${node}: --effort ${plan[node].effort ?? '(none)'}`, flagOf(tp, '--effort') === (plan[node].effort ?? null), `argv --effort=${flagOf(tp, '--effort')}`);
        const init = tp.wire?.mainInit?.model || '';
        t.check(`${node}: wire init model is ${plan[node].model}`, t.profile.expectInitModel(plan[node].model).test(init), `init=${init}`);
      }
      const rows = t.sb.query("select node_id, run_model from sub_agents where subagent_type = 'run-title'");
      t.note(`title helper model: ${JSON.stringify(rows)}`);
    },
  },
  {
    id: 'pipeline.auto-no-human',
    title: 'Auto workflow with --no-human: classifier picks, run finishes unattended',
    tier: 'core', models: 'cheap', diff: true,
    async run(t) {
      await codingRun(t, { workflow: 'auto', extra: ['--no-human'] });
      const gpt = t.sb.agentTaps().filter((tp) => /\bgpt-[\w.-]+/.test(JSON.stringify(tp.args) + (tp.stdin || '')));
      t.check('no Codex (gpt-*) model offered or used on a Claude run', gpt.length === 0,
        gpt.map((tp) => `${tp.site}: ${(JSON.stringify(tp.args) + tp.stdin).match(/\bgpt-[\w.-]+/g)?.slice(0, 6).join(',')}`).join(' | '));
    },
  },
  {
    id: 'pipeline.concurrent',
    title: 'three runs at once in one WORCA_HOME (three projects)',
    tier: 'full', models: 'cheap',
    async run(t) {
      const names = ['calc', 'calc-b', 'calc-c'];
      const projs = names.map((n) => t.sb.addProject(n, 'calc'));
      const results = await Promise.all(projs.map((p, i) => t.sb.cli(['--project', p, '--prompt', SUBTRACT_TASK, '--yes', '--model', t.model, '--title', `live concurrent ${i}`])));
      results.forEach((r, i) => t.check(`run ${i}: exit 0`, r.code === 0, `${r.stderr.slice(-400)} ${r.stdout.slice(-400)}`));
      const runs = t.sb.runs();
      t.check('three runs recorded', runs.length === 3, runs.map((r) => `${r.id}:${r.status}`).join(','));
      for (const r of runs) {
        t.check(`run ${r.id}: done`, r.status === 'done', `${r.status} ${r.pauseReason || ''}`);
        checkRunBookkeeping(t, t.sb, r.id);
        if (r.branch) {
          const o = oracle(t.sb, r.projectDir, r.branch, SUBTRACT_ORACLE);
          t.check(`run ${r.id}: oracle`, o.ok && o.testsOk, o.out + o.testsOut.slice(-200));
        }
      }
      const sessions = new Set(t.sb.agentTaps().flatMap((tp) => tp.wire?.sessionIds || []));
      const stored = t.sb.query('select session_id from pipeline_steps where session_id is not null').map((r) => r.session_id);
      t.check('no session id shared across runs', new Set(stored).size === stored.length, `${stored.length} stored, ${new Set(stored).size} distinct`);
      t.check('every stored session came off the wire', stored.every((s) => sessions.has(s)), '');
      checkWire(t, t.sb.agentTaps(), { expectModel: true });
    },
  },
  {
    id: 'pipeline.memory-defrag',
    title: 'wf_memory_defrag (project scope) after a coding run left memory behind',
    tier: 'full', models: 'cheap',
    async run(t) {
      const { proj } = await codingRun(t);
      const res = await t.sb.cli(['--project', proj, '--workflow', 'wf_memory_defrag', '--memory-scope', 'project', '--yes', '--model', t.model]);
      t.check('defrag: exit 0', res.code === 0, `${res.stderr.slice(-500)} ${res.stdout.slice(-700)}`);
      const id = runIdFrom(t.sb, res);
      if (id) checkRunDone(t, t.sb, id);
      checkWire(t, t.sb.agentTaps(), { expectModel: true });
    },
  },
];
export { codingRun, importEdited };
