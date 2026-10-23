// ui/public/automations-view.mjs — Settings › Automations (docs/git-automations.md, flag gitAutomations): per project,
// the three Auto-handle switches, the event rules and what they did lately. app.js owns the fetches and the dialogs;
// this module only renders and calls back. Every GitHub-sourced string (titles, logins) goes through textContent.
import { makeSwitch } from './switch.mjs';

export const AUTOMATIONS_EMPTY_RULES = 'No rules of your own yet. The Auto-handle switches above need none; add a rule for anything else.';
export const AUTOMATIONS_EMPTY_EVENTS = 'Nothing happened yet. New issues and pull requests show here with what Worca did.';

const EVENT_WORDS = Object.freeze({ 'issue.opened': 'Issue opened', 'pr.opened': 'PR opened or ready' });
const ACTION_WORDS = Object.freeze({ run: 'Run a workflow', propose: 'Propose a fix', fix: 'Full fix (draft PR)', review: 'Review the PR' });
const STATUS = Object.freeze({
  skipped: ['Skipped', 'grey'], queued: ['Queued', 'grey'], starting: ['Starting', 'blue'], running: ['Running', 'blue'],
  'awaiting-approval': ['Waiting for approval', 'amber'], done: ['Done', 'green'], failed: ['Failed', 'red'],
});
const REASONS = Object.freeze({
  'untrusted-author': 'author is not a collaborator (add the trigger label to start it)', draft: 'a draft',
  filtered: 'labels do not match', missed: 'opened while Worca was off', closed: 'closed', 'daily-cap': 'daily cap reached',
  concurrency: 'waiting for a free slot', 'rule-off': 'rule turned off',
});

function h(doc, tag, cls, text) {
  const el = doc.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}
function btn(doc, label, cls, onClick) {
  const b = h(doc, 'button', cls || 'btn btn-sm', label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** "Issue opened → Propose a fix" plus its filter and limits, one line each. */
export function ruleSummary(rule, workflowNames = {}) {
  const what = rule.action === 'run' ? `Run ${workflowNames[rule.workflowId] || rule.workflowId}` : ACTION_WORDS[rule.action] || rule.action;
  const f = rule.filter || {};
  const bits = [];
  if (f.labels?.length) bits.push(`labels ${f.labels.join(', ')}`);
  if (f.excludeLabels?.length) bits.push(`not ${f.excludeLabels.join(', ')}`);
  if (f.triggerLabel) bits.push(`trigger label “${f.triggerLabel}”`);
  if (f.allowLogins?.length) bits.push(`also @${f.allowLogins.join(', @')}`);
  const l = rule.limits || {};
  return {
    title: `${EVENT_WORDS[rule.event] || rule.event} → ${what}`,
    detail: [...bits, `${l.dailyRuns}/day`, `$${l.maxCostUsd} per run`, `${l.maxConcurrent} at a time`].join(' · '),
  };
}

/** One status badge word + colour, and the reason in words. */
export function eventStatus(e) {
  const [word, family] = STATUS[e.status] || [e.status, 'grey'];
  const reason = e.reason ? (REASONS[e.reason] || e.reason) : '';
  return { word, family, reason };
}

/**
 * The pane body for one project: Auto-handle switches, rules, recent events.
 * data: GET /api/automations?projectDir= ({ rules, events, autoHandle, switches, repo, webhook, polling })
 * cb: { onSwitch(key, on), onAddRule(), onToggleRule(rule, on), onDeleteRule(rule), onApprove(event), onOpenRun(event), onCheckNow() }
 */
export function renderAutomations(doc, data, { workflowNames = {}, ...cb } = {}) {
  const root = h(doc, 'div', 'automations');
  if (!data.repo) {
    root.append(h(doc, 'p', 'hint', 'This project has no GitHub or Azure DevOps remote. Automations watch a repository on one of them.'));
    return root;
  }
  const azure = data.forge === 'azure';
  const hostName = azure ? 'Azure DevOps' : 'GitHub';
  const hooked = azure ? data.azureWebhook?.configured : data.webhook?.configured;
  const delivery = hooked
    ? `Delivery: ${azure ? 'Azure DevOps service hooks' : 'GitHub webhooks'}, with a poll every 5 minutes as a catch-up.`
    : data.polling === false ? 'Polling is off (WORCA_AUTOMATIONS_POLL=0) and no webhook secret is set: nothing is delivered.'
      : `Delivery: Worca checks ${hostName} every minute.`;
  const head = h(doc, 'p', 'hint automations-repo');
  head.append(`Watching ${data.repo}. ${delivery} `);
  head.append(btn(doc, 'Check now', 'btn btn-sm btn-quiet', () => cb.onCheckNow?.()));
  root.append(head);

  const ah = h(doc, 'div', 'automations-switches drows');
  ah.append(h(doc, 'h3', '', 'Auto-handle'));
  for (const s of data.switches || []) {
    const sw = makeSwitch(doc, { label: s.label, checked: !!data.autoHandle?.[s.key], rowClass: 'automations-switch', data: { switch: s.key } });
    sw.input.addEventListener('change', () => cb.onSwitch?.(s.key, sw.input.checked));
    ah.append(sw.row);
  }
  ah.append(h(doc, 'p', 'hint', azure
    ? 'On Azure DevOps a new issue is a new work item in the project, and its tags are labels. Runs use the Strict guardrails, and Worca never votes on or completes a pull request.'
    : 'Only collaborators\' issues and PRs start a run. Runs use the Strict guardrails, and Worca never approves or merges.'));
  root.append(ah);

  const rules = h(doc, 'div', 'automations-rules drows');
  const rh = h(doc, 'div', 'pl-head');
  rh.append(h(doc, 'h3', '', 'Rules'), btn(doc, 'Add rule', 'btn btn-sm', () => cb.onAddRule?.()));
  rules.append(rh);
  // An Auto-handle switch IS its rule: the switch above is its only control, so the list holds the rules added here.
  const own = (data.rules || []).filter((r) => r.origin !== 'auto-handle');
  if (!own.length) rules.append(h(doc, 'div', 'hist-empty', AUTOMATIONS_EMPTY_RULES));
  for (const r of own) {
    const s = ruleSummary(r, workflowNames);
    const row = h(doc, 'div', 'drow drow-stack automations-rule');
    row.dataset.rule = r.id;
    const top = h(doc, 'div', 'pl-head');
    top.append(h(doc, 'b', '', s.title));
    if (!r.enabled) top.append(h(doc, 'span', 'badge grey', 'Off'));
    row.append(top, h(doc, 'small', 'hint', s.detail));
    const acts = h(doc, 'div', 'pl-actions');
    acts.append(btn(doc, r.enabled ? 'Turn off' : 'Turn on', 'btn btn-sm', () => cb.onToggleRule?.(r, !r.enabled)));
    acts.append(btn(doc, 'Delete', 'btn btn-sm', () => cb.onDeleteRule?.(r)));
    row.append(acts);
    rules.append(row);
  }
  root.append(rules);

  const evs = h(doc, 'div', 'automations-events drows');
  evs.append(h(doc, 'h3', '', 'Recent'));
  if (!(data.events || []).length) evs.append(h(doc, 'div', 'hist-empty', AUTOMATIONS_EMPTY_EVENTS));
  for (const e of data.events || []) {
    const st = eventStatus(e);
    const row = h(doc, 'div', 'drow drow-stack automations-event');
    row.dataset.event = e.id;
    const top = h(doc, 'div', 'pl-head');
    const link = h(doc, 'a', '', `${e.kind === 'pr' ? 'PR' : /^dev\.azure\.com\//i.test(String(e.repo || '')) ? 'Work item' : 'Issue'} #${e.number}`);
    if (/^https:\/\/(github\.com|dev\.azure\.com)\//.test(String(e.url || ''))) { link.href = e.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    top.append(link, ' ', h(doc, 'span', '', e.title || ''), h(doc, 'span', `badge ${st.family}`, st.word));
    row.append(top);
    const meta = [e.author ? `by @${e.author}` : '', ACTION_WORDS[e.phase === 'fix' ? 'fix' : e.action] || '', st.reason,
      e.costUsd ? `$${Number(e.costUsd).toFixed(2)}` : '', e.via === 'webhook' ? 'webhook' : ''].filter(Boolean).join(' · ');
    row.append(h(doc, 'small', 'hint', meta));
    const acts = h(doc, 'div', 'pl-actions');
    if (e.status === 'awaiting-approval') acts.append(btn(doc, 'Approve the fix', 'btn btn-primary btn-sm', () => cb.onApprove?.(e)));
    if (e.pipelineId) acts.append(btn(doc, 'Open run', 'btn btn-sm', () => cb.onOpenRun?.(e)));
    if (e.prUrl && /^https:\/\//.test(e.prUrl)) {
      const pr = h(doc, 'a', 'btn btn-sm', 'Open PR');
      pr.href = e.prUrl; pr.target = '_blank'; pr.rel = 'noopener noreferrer';
      acts.append(pr);
    }
    if (acts.childNodes.length) row.append(acts);
    evs.append(row);
  }
  root.append(evs);
  return root;
}
