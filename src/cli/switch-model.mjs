// src/cli/switch-model.mjs
// `worca switch-model` — change a PAUSED run's remaining stages' models before resuming it.
// Talks to the store, never to the UI server (control.mjs's rule): the switch is one
// conditional write through the same core action the run detail UI uses (model-switch.mjs).

import { resolveRunRef } from './runs.mjs';
import { cliProjectDirFor } from './control.mjs';

export const SWITCH_HELP = `worca switch-model — change a paused run's models, then resume it

Usage:
  worca switch-model <id>                       List the run's stages and their models
  worca switch-model <id> --stage <stage> [--model <m>] [--effort <e>]
                          [--subagent-model <m>] [--subagent-effort <e>]
  worca switch-model <id> --all --model <m> [...]
                                                Apply to every stage that has not completed
  --json                                        Machine-readable output

<stage> is a node id (n_refine) or an agent key (refiner) when only one stage uses it.
Pass "default" to clear a field back to the run default. Efforts: medium, high, xhigh, max.
Sub-agent models: sonnet, opus, fable, auto, inherit.

Only a PAUSED run can be switched, and only the paused stage and the stages after it.
The change applies to this run only. A stage whose model changed starts a fresh Claude
session when you resume:  worca resume <id>
`;

const FLAG_FIELDS = Object.freeze({
  '--model': 'model', '--effort': 'effort', '--subagent-model': 'subagentModel', '--subagent-effort': 'subagentEffort',
});

/** Hand-parsed like the other verbs (no argument library in this CLI). */
export function parseSwitchArgs(argv) {
  const out = { ref: null, stage: null, all: false, json: false, change: {}, unknown: [], missing: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--all') out.all = true;
    else if (a === '--stage' || Object.hasOwn(FLAG_FIELDS, a)) {
      const v = argv[i + 1];
      if (v == null || v.startsWith('--')) { out.missing.push(a); continue; }
      i += 1;
      if (a === '--stage') out.stage = v;
      else out.change[FLAG_FIELDS[a]] = v === 'default' ? '' : v;
    } else if (a.startsWith('-')) out.unknown.push(a);
    else if (!out.ref) out.ref = a;
    else out.unknown.push(a);
  }
  return out;
}

/** A node id, else a UNIQUE agent key. */
function resolveStage(stages, sel, fail) {
  const exact = stages.find((s) => s.nodeId === sel);
  if (exact) return exact;
  const byKey = stages.filter((s) => s.key === sel);
  if (byKey.length === 1) return byKey[0];
  if (byKey.length > 1) fail(`"${sel}" names ${byKey.length} stages — pass a node id: ${byKey.map((s) => s.nodeId).join(', ')}`);
  fail(`no stage "${sel}" in this run (see: worca switch-model <id>)`);
  return null;
}

function refusal(msg) {
  process.stderr.write(`worca: ${msg}\n`);
  return 1;
}

function printStages(info, { out, c }) {
  out(`${c('bold', info.title || info.pipelineId)} ${c('gray', `— paused${info.pauseReason ? ` (${info.pauseReason})` : ''}`)}`);
  const rows = [['STAGE', 'NODE', 'STATE', 'MODEL', 'EFFORT', 'SUBS', 'SUBS EFFORT']];
  for (const s of info.stages) {
    rows.push([s.key || s.label, s.nodeId, s.state, s.model || 'default', s.effort || '—',
      s.fanOut ? (s.subagentModel || 'default') : '—', s.fanOut ? (s.subagentEffort || '—') : '—']);
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  for (const r of rows) out('  ' + r.map((v, i) => String(v).padEnd(widths[i])).join('  ').trimEnd());
}

/** @returns {Promise<number>} exit code */
export async function cmdSwitchModel(argv, { out, c, fail }) {
  if (['help', '--help', '-h'].includes(argv[0])) { process.stdout.write(SWITCH_HELP); return 0; }
  const a = parseSwitchArgs(argv);
  if (a.unknown.length) fail(`unknown option(s): ${a.unknown.join(' ')} — see: worca switch-model help`);
  if (a.missing.length) fail(`${a.missing.join(', ')} needs a value — see: worca switch-model help`);
  if (!a.ref) fail('a run id is required (see: worca runs list)');
  const hasChange = Object.keys(a.change).length > 0;
  if (a.stage && a.all) fail('--stage and --all cannot be combined');
  if (hasChange && !a.stage && !a.all) fail('name the stage to change: --stage <stage> or --all');
  if (!hasChange && (a.stage || a.all)) fail('name what to change: --model, --effort, --subagent-model or --subagent-effort');
  const id = resolveRunRef(a.ref, fail);

  const { describeModelSwitch, switchPausedRunModels, ModelSwitchError } = await import('../core/model-switch.mjs');
  try {
    const info = await describeModelSwitch(id, { projectDirFor: cliProjectDirFor });
    if (!hasChange) {
      if (a.json) out(JSON.stringify(info, null, 2)); else printStages(info, { out, c });
      return 0;
    }
    const targets = a.all ? info.stages.filter((s) => s.switchable) : [resolveStage(info.stages, a.stage, fail)];
    if (!targets.length) return refusal(`run ${id} has no stage left to switch`);
    const changes = Object.fromEntries(targets.map((s) => [s.nodeId, { ...a.change }]));
    const res = await switchPausedRunModels(id, { changes, by: 'local', projectDirFor: cliProjectDirFor });
    if (a.json) { out(JSON.stringify({ id, changed: res.changed, warnings: res.warnings }, null, 2)); return 0; }
    if (!res.changed.length) out(c('gray', 'Nothing changed — the stages already use that selection.'));
    for (const ch of res.changed) out(`${c('green', 'Switched')} ${c('bold', ch.label)} ${c('gray', `(${ch.nodeId})`)}: ${ch.before.model || 'default'} → ${ch.after.model || 'default'}`);
    for (const w of res.warnings) out(c('yellow', w));
    if (res.changed.length) out(c('gray', `Resume with: worca resume ${id}`));
    return 0;
  } catch (err) {
    if (!(err instanceof ModelSwitchError)) throw err;
    if (a.json) { out(JSON.stringify({ id, error: err.message, code: err.code }, null, 2)); return 1; }
    return refusal(err.message);
  }
}
