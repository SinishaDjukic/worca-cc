// src/shared/intent-leads.mjs — the one plain sentence each Chat intent puts in front of a sent message
// (ui/public/chat/intent.mjs), and the strip the server's fallback chat title takes before it reads the first line
// (run 4, D19). Shared: the browser imports /src/shared, and the server cannot import the composer's browser modules.
export const INTENT_LEADS = Object.freeze({
  run: 'Propose a pipeline run for this task.',
  shape: 'Shape this task first: propose a run with `shape`.',
  workflow: 'Build a workflow from this description.',
  schedule: 'Propose a scheduled run for this.',
  track: 'Track this run here.',
  diff: 'Explain what this run changed.',
  script: 'Write a script for this.',
  away: 'Turn Away mode on now.',
  metrics: 'Show my team metrics.',
  model: 'Help me add this model.',
  workspace: 'Create a new workspace.',
  remember: 'Remember this.',
  tasks: 'Find tasks in my trackers.',
});
const LEADS = new Set(Object.values(INTENT_LEADS));
// workflowLead in intent.mjs: `Propose a pipeline run of workflow ${id} ("${name}") for this task.`
const WORKFLOW_LEAD = /^Propose a pipeline run of workflow \S+ \(".*"\) for this task\.$/;

/** The text without a leading intent lead: a lead alone gives '', a lead then a blank line gives what follows. */
export function stripIntentLead(text) {
  const s = String(text ?? '');
  const cut = s.indexOf('\n\n');
  const first = cut === -1 ? s : s.slice(0, cut);
  if (!LEADS.has(first) && !WORKFLOW_LEAD.test(first)) return s;
  return cut === -1 ? '' : s.slice(cut + 2);
}
