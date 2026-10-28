// src/cli/setup.mjs
// `worca setup --from FILE` (plans/setup-assistant-design.md D16, AC-5.8): applies a team setup file with the
// setup backend's own validator and one settings write, then asks only for the questions the file leaves out. Network
// and model access are never asked here: they stay in the setup assistant and `worca proxy` (D12).
import { createInterface } from 'node:readline';
import { readTeamSetupFile, teamValues } from '../core/setup/team-file.mjs';
import { planSetupApply, commitSetupPlan, runSetupSteps, sameValue } from '../core/setup/apply.mjs';
import { readSettings } from '../core/settings.mjs';
import { ROLE_LABELS } from '../shared/model-roles.mjs';

const HELP = `worca setup --from FILE [--yes]
  Applies a team setup file (docs/setup-assistant.md#team-setup) and asks only for what it leaves out,
  then shows the changes and asks before it writes.
  --yes   keep your current value for everything the file leaves out, and apply without asking
Network and model access: the setup assistant in the Worca UI, or worca proxy.`;

const num = (s) => { const n = Number(s); return Number.isFinite(n) ? n : s; };
const yesNo = (s) => (/^(y|yes|on|true)$/i.test(s) ? true : /^(n|no|off|false)$/i.test(s) ? false : s);
/** The questions `worca setup --from` may ask, in order; `key` is the apply-body path teamValues() reports. */
export const CLI_QUESTIONS = Object.freeze([
  { key: 'work.uiLevel', label: 'Interface level', parse: (s) => s },
  { key: 'work.runEngine', label: 'Coding agent', parse: (s) => s },
  { key: 'work.pipelineCostLimitUsd', label: 'Per-run limit ($)', parse: num },
  { key: 'work.totalCostLimitUsd', label: 'Total limit ($)', parse: num },
  { key: 'work.costLimitResetPeriod', label: 'Reset', parse: (s) => s },
  { key: 'work.autoGeneratePrDescription', label: 'AI-written PR descriptions', parse: yesNo },
  ...['deep', 'everyday', 'quick'].map((r) => ({ key: `models.modelRoles.claude.${r}`, label: `${ROLE_LABELS[r]} model`, parse: (s) => ({ model: s }) })),
]);

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
function setPath(obj, path, v) { const ks = path.split('.'); let o = obj; for (const k of ks.slice(0, -1)) o = (o[k] ||= {}); o[ks.at(-1)] = v; }
// The saved value shown in [brackets]: the apply-body path minus its group (models.modelRoles.claude.deep → modelRoles.claude.deep).
const savedAt = (settings, key) => getPath(settings, key.split('.').slice(1).join('.'));
const shown = (v) => (v == null ? 'not set' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? (v.model || 'not set') : String(v));
const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// The labels of the work fields the CLI never asks about (the same words as the registry's Setup rows).
/** The deps `worca setup` plans with: no network change ever; the rest are planSetupApply's defaults. */
export const CLI_APPLY_DEPS = Object.freeze({ checkProxy: async () => { throw new Error('worca setup never changes the network.'); } });
const EXTRA_LABELS = Object.freeze({ sync: 'Sync before run', networkWait: 'Wait for the network', smartNaming: 'Smart run names', hideBuiltinModels: 'Hide built-in models' });

function lineReader(input, output) {
  const rl = createInterface({ input, terminal: false });
  const it = rl[Symbol.asyncIterator]();
  return { ask: async (q) => { output.write(q); const n = await it.next(); return n.done ? null : n.value.trim(); }, close: () => rl.close() };
}

export async function cmdSetup(argv, {
  out = (s) => process.stdout.write(`${s}\n`), err = (s) => process.stderr.write(`${s}\n`),
  input = process.stdin, prompt = process.stderr, settings = readSettings,
  catalog = async () => (await import('../core/config.mjs')).listModels(null),
  claudeAuth = async () => (await (await import('../core/preflight.mjs')).probeClaudeAuth()).state,
} = {}) {
  if (argv[0] === 'help' || argv.includes('--help')) { out(HELP); return 0; }
  const at = argv.indexOf('--from'); const from = at >= 0 ? argv[at + 1] : null;
  if (!from) { err(HELP); return 2; }
  const yes = argv.includes('--yes');
  const read = readTeamSetupFile({ path: from });
  if (!read.found) { err(`worca setup: no file at ${from}.`); return 2; }
  if (!read.ok) { err(`worca setup: ${read.error}`); return 2; }
  for (const w of read.warnings) err(`worca setup: ${w}`);
  const team = teamValues(read.doc.fields, { catalog: await catalog(), claudeAuth: await claudeAuth() });
  for (const u of team.unmapped) out(`${ROLE_LABELS[u.role] || u.role}: ${u.upstream} — ${u.line} Your pick is kept.`);

  const current = settings();
  const body = structuredClone(team.values);
  // What the file sets, including a role it names that no source here serves: neither is asked (AC-5.8, qa-1-6).
  const fileSet = new Set([...team.keys, ...team.unmapped.map((u) => `models.modelRoles.${u.harness}.${u.role}`)]);
  const rl = yes ? null : lineReader(input, prompt);
  try {
    if (rl) {
      for (const q of CLI_QUESTIONS) {
        if (fileSet.has(q.key)) continue;                     // the file sets it: never asked (AC-5.8)
        const answer = await rl.ask(`${q.label} [${shown(savedAt(current, q.key))}]: `);
        if (answer) setPath(body, q.key, q.parse(answer));     // Enter or end of input keeps the saved value
      }
    }
    // Roles ride as a patch over the saved roles; a value equal to what is saved is not sent (one write, only changes).
    if (body.models?.modelRoles) body.models.testRoles = false;
    for (const [k, v] of Object.entries(body.work || {})) if (sameValue(v, current[k])) delete body.work[k];
    if (body.work && !Object.keys(body.work).length) delete body.work;
    const plan = await planSetupApply(body, CLI_APPLY_DEPS);
    if (!plan.written.length) { out(`Nothing to change: your settings already match ${from}.`); return 0; }
    // Show the change before the one write (security-1-7); --yes is the person's prior consent.
    for (const q of CLI_QUESTIONS) {
      const now = getPath(body, q.key); if (now === undefined) continue;
      const was = savedAt(current, q.key);
      if (!sameValue(now, was)) out(`  ${q.label}: ${shown(was)} → ${shown(now)}`);
    }
    // Fields with no question (sync, networkWait, smartNaming, hideBuiltinModels) list each changed sub-key, so the
    // person sees exactly what a sync or wait block changes (security-2-3). Records compare against the merged value.
    for (const k of Object.keys(body.work || {})) {
      if (CLI_QUESTIONS.some((q) => q.key === `work.${k}`) || !plan.written.includes(k)) continue;   // a patch that merges to the saved value is no change
      const label = EXTRA_LABELS[k] || k; const now = plan.values[k]; const was = current[k];
      if (isRecord(now) || isRecord(was)) {
        for (const sk of new Set([...Object.keys(isRecord(was) ? was : {}), ...Object.keys(isRecord(now) ? now : {})])) {
          if (!sameValue(now?.[sk], was?.[sk])) out(`  ${label} · ${sk}: ${shown(was?.[sk])} → ${shown(now?.[sk])}`);
        }
      } else if (!sameValue(now, was)) out(`  ${label}: ${shown(was)} → ${shown(now)}`);
    }
    if (rl) {
      const ok = await rl.ask('Apply these changes? [y/N] ');
      if (!/^(y|yes)$/i.test(ok || '')) { out('Nothing changed.'); return 1; }
    }
    await commitSetupPlan(plan);
    await runSetupSteps(plan, { onResult: (r) => out(`  ${r.state === 'ok' ? '✓' : '✗'} ${r.label}: ${r.line}`) });
    out(`Applied ${plan.written.length} settings from ${from}.`);
    return 0;
  } catch (e) {
    err(`worca setup: ${e.field ? `${e.field}: ` : ''}${e.message}`);
    return e.field ? 2 : 1;
  } finally { rl?.close(); }
}
