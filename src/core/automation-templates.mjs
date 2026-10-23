// src/core/automation-templates.mjs — the ready-made workflows of Git event automations (#711).
// Each is a NORMAL saved workflow (a row in `workflows`), written the first time an automation needs it, so a person
// can open and edit it in the Workflows view like any other. Worca never overwrites one that exists: an edited
// template keeps its edits, and a deleted one comes back only when an automation needs it again.
// No Clarify node in any of them: nobody is watching an event run (wf_pr_fix's posture).
import { readWorkflow, writeGraphWorkflow } from './workflows.mjs';

const w = (id, from, fromPort, to, toPort, config) => ({ id, from: { node: from, port: fromPort }, to: { node: to, port: toPort },
  ...(config ? { config } : {}) });
const task = { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} };
const end = (x) => ({ id: 'n_end', kind: 'end', x, y: 200, config: {} });

const ROOT_CAUSE_HINTS = 'This is a bug report. Reproduce it first where you can (a failing test is best), then find the root cause '
  + 'and say how you confirmed it. The plan starts with "## Root cause" and ends with the fix and the test that proves it.';
const PLAN_ONLY_HINTS = 'Write the plan for a person to approve before any code changes: what is wrong or missing, the change, '
  + 'the files it touches and the tests. Keep it short enough to read in an issue comment.';
const REVIEW_HINTS = 'You review a pull request someone else wrote. Nothing was implemented in this run: review the diff the task '
  + 'names. Give every finding a location as path/to/file.ext:line.';

export const AUTOMATION_TEMPLATES = Object.freeze({
  rootCause: {
    id: 'wf_auto_bug_root_cause', name: 'Bug → reproduce and root-cause', domain: 'coding', codeGraph: false,
    nodes: [task, { id: 'n_plan', kind: 'agent', key: 'planner', x: 320, y: 200, config: { promptHints: ROOT_CAUSE_HINTS } },
      { id: 'n_refine', kind: 'agent', key: 'refiner', x: 600, y: 200, config: {} }, end(880)],
    wires: [w('w1', 'n_task', 'task', 'n_plan', 'task'), w('w2', 'n_plan', 'plan', 'n_refine', 'plan'),
      w('w3', 'n_refine', 'revise', 'n_refine', 'revise', { maxCycles: 2 }), w('w4', 'n_refine', 'plan', 'n_end', 'result')],
  },
  planOnly: {
    id: 'wf_auto_issue_plan', name: 'Issue → plan only', domain: 'coding', codeGraph: false,
    nodes: [task, { id: 'n_plan', kind: 'agent', key: 'planner', x: 320, y: 200, config: { promptHints: PLAN_ONLY_HINTS } },
      { id: 'n_refine', kind: 'agent', key: 'refiner', x: 600, y: 200, config: {} }, end(880)],
    wires: [w('w1', 'n_task', 'task', 'n_plan', 'task'), w('w2', 'n_plan', 'plan', 'n_refine', 'plan'),
      w('w3', 'n_refine', 'revise', 'n_refine', 'revise', { maxCycles: 2 }), w('w4', 'n_refine', 'plan', 'n_end', 'result')],
  },
  fix: {
    id: 'wf_auto_issue_fix', name: 'Issue → fix and open a draft PR', domain: 'coding',
    nodes: [task,
      { id: 'n_plan', kind: 'agent', key: 'planner', x: 320, y: 200, config: {} },
      { id: 'n_refine', kind: 'agent', key: 'refiner', x: 600, y: 200, config: {} },
      { id: 'n_impl', kind: 'agent', key: 'implementer', x: 880, y: 200, config: {} },
      { id: 'n_review', kind: 'agent', key: 'reviewer', x: 1160, y: 200, config: {} }, end(1440)],
    wires: [w('w1', 'n_task', 'task', 'n_plan', 'task'), w('w2', 'n_plan', 'plan', 'n_refine', 'plan'),
      w('w3', 'n_refine', 'revise', 'n_refine', 'revise', { maxCycles: 2 }), w('w4', 'n_refine', 'plan', 'n_impl', 'plan'),
      w('w5', 'n_refine', 'plan', 'n_review', 'plan'), w('w6', 'n_impl', 'done', 'n_review', 'done'),
      w('w7', 'n_review', 'review', 'n_impl', 'fix', { maxCycles: 3 }), w('w8', 'n_review', 'pass', 'n_end', 'result')],
  },
  // The fix after a person approved a proposed plan: no planner, the task (which quotes the approved plan) feeds both
  // plan ports, as in Watch PR's wf_pr_fix. Re-planning would only re-confirm what was approved.
  approvedFix: {
    id: 'wf_auto_approved_fix', name: 'Approved plan → implement and open a draft PR', domain: 'coding',
    nodes: [task,
      { id: 'n_impl', kind: 'agent', key: 'implementer', x: 320, y: 200, config: {} },
      { id: 'n_review', kind: 'agent', key: 'reviewer', x: 600, y: 200, config: {} }, end(880)],
    wires: [w('w1', 'n_task', 'task', 'n_impl', 'plan'), w('w2', 'n_task', 'task', 'n_review', 'plan'),
      w('w3', 'n_impl', 'done', 'n_review', 'done'), w('w4', 'n_review', 'review', 'n_impl', 'fix', { maxCycles: 3 }),
      w('w5', 'n_review', 'pass', 'n_end', 'result')],
  },
  // The reviewer's blocking `review` output is deliberately unwired: there is no implementer to loop back to, so a
  // review with findings ends the run (done) and its verdict is what Worca posts.
  review: {
    id: 'wf_auto_pr_review', name: 'PR → review', domain: 'coding', codeGraph: false,
    nodes: [task, { id: 'n_review', kind: 'agent', key: 'reviewer', x: 320, y: 200, config: { promptHints: REVIEW_HINTS } }, end(600)],
    wires: [w('w1', 'n_task', 'task', 'n_review', 'plan'), w('w2', 'n_review', 'pass', 'n_end', 'result')],
  },
});

/** Which template an action runs (a "run" rule names its own workflow). */
export const TEMPLATE_FOR_ACTION = Object.freeze({ propose: 'rootCause', fix: 'fix', review: 'review' });

/** The template's workflow id, writing the row first when it does not exist. */
export async function ensureAutomationTemplate(key) {
  const tpl = AUTOMATION_TEMPLATES[key];
  if (!tpl) throw new Error(`unknown automation template "${key}"`);
  if (await readWorkflow(tpl.id)) return tpl.id;
  const at = new Date().toISOString();
  const saved = await writeGraphWorkflow({ ...tpl, origin: null, createdAt: at });
  return saved.id;
}

/** The template list for the rule editor: { key, id, name }. */
export function listAutomationTemplates() {
  return Object.entries(AUTOMATION_TEMPLATES).map(([key, t]) => ({ key, id: t.id, name: t.name }));
}
