// ui/public/automations-view.mjs — Git event automations (docs/git-automations.md, flag gitAutomations).
//   renderAutomations          a project's or a workspace's Automations tab: the Auto-handle switches, the rules, what
//                              they did (a workspace's watches every member's repository)
//   renderAutomationsOverview  Settings › Automations: which projects automate what, delivery, recent activity
// app.js owns the fetches and the dialogs; this module only renders and calls back. Every string from GitHub or Azure
// DevOps (titles, logins) goes through textContent.
import { makeSwitch } from './switch.mjs';

export const AUTOMATIONS_EMPTY_RULES = 'No rules of your own yet. The switches above need none; add a rule for anything else.';
export const AUTOMATIONS_EMPTY_EVENTS = 'Nothing yet. New issues and pull requests show here with what Worca did.';
export const AUTOMATIONS_EMPTY_PROJECTS = 'No project or workspace automates anything yet. Open one and use its Automations tab.';
/** A workspace's switches start workspace runs: what changes from a project's, in the words under each switch. */
const WORKSPACE_HELP = Object.freeze({
  propose: 'Bug: finds the root cause across the workspace and posts a fix plan. Feature request: posts a plan. Nothing changes until someone '
    + 'approves (here, or /worca approve). Questions and unclear issues get a comment, no run.',
  fix: 'Fixes it across the workspace without asking, then opens one draft PR per changed repository, linked to each other. Only the issue\'s '
    + 'own repository\'s PR closes it. Never merges.',
});
const EVENT_NOUNS = Object.freeze({ 'issue.opened': 'new issues', 'pr.opened': 'new pull requests' });

const EVENT_WORDS = Object.freeze({ 'issue.opened': 'Issue opened', 'pr.opened': 'PR opened or ready' });
const ACTION_WORDS = Object.freeze({ run: 'Run a workflow', propose: 'Triage and propose', fix: 'Full fix (draft PR)', review: 'Review the PR' });
const TRIAGE_WORDS = Object.freeze({ bug: 'bug', feature: 'feature request', question: 'question', unclear: 'unclear' });
const STATUS = Object.freeze({
  skipped: ['Skipped', 'grey'], queued: ['Queued', 'grey'], starting: ['Starting', 'blue'], running: ['Running', 'blue'],
  'awaiting-approval': ['Waiting for approval', 'amber'], done: ['Done', 'green'], failed: ['Failed', 'red'],
});
const REASONS = Object.freeze({
  'untrusted-author': 'author is not a collaborator (add the trigger label to start it)', draft: 'a draft',
  filtered: 'labels do not match', missed: 'opened while Worca was off', closed: 'closed', 'daily-cap': 'daily cap reached',
  concurrency: 'waiting for a free slot', 'rule-off': 'rule turned off',
  question: 'a question: commented, no run', 'needs-info': 'unclear: asked for details, no run',
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
const isAzure = (repo) => /^dev\.azure\.com\//i.test(String(repo || ''));

/** "Issue opened → Triage and propose" plus its filter and limits, one line each. */
export function ruleSummary(rule, workflowNames = {}) {
  const what = rule.action === 'run' ? `Run ${workflowNames[rule.workflowId] || rule.workflowId}` : ACTION_WORDS[rule.action] || rule.action;
  const f = rule.filter || {};
  const bits = [];
  if (f.labels?.length) bits.push(`labels ${f.labels.join(', ')}`);
  if (f.excludeLabels?.length) bits.push(`not ${f.excludeLabels.join(', ')}`);
  if (f.triggerLabel) bits.push(`trigger label “${f.triggerLabel}”`);
  if (f.allowLogins?.length) bits.push(`also @${f.allowLogins.join(', @')}`);
  return { title: `${EVENT_WORDS[rule.event] || rule.event} → ${what}`, detail: [...bits, limitsLine(rule.limits)].filter(Boolean).join(' · ') };
}

const AUTO_HANDLE_KEY = Object.freeze({ 'issue.opened:propose': 'propose', 'issue.opened:fix': 'fix', 'pr.opened:review': 'review' });
export const autoHandleKey = (r) => AUTO_HANDLE_KEY[`${r.event}:${r.action}`] || null;
/** "Max 10 runs/day · $5 per run · 1 at a time" */
export function limitsLine(l) {
  if (!l) return '';
  return `Max ${l.dailyRuns} run${l.dailyRuns === 1 ? '' : 's'}/day · $${l.maxCostUsd} per run · ${l.maxConcurrent} at a time`;
}

/** One status badge word + colour, and the reason in words. */
export function eventStatus(e) {
  const [word, family] = STATUS[e.status] || [e.status, 'grey'];
  const reason = e.reason ? (REASONS[e.reason] || e.reason) : '';
  return { word, family, reason };
}

/** One "Recent" row: the item, what Worca did, and its actions. `projectName` prefixes it in the overview. */
function eventRow(doc, e, cb, { projectName = null } = {}) {
  const st = eventStatus(e);
  const row = h(doc, 'div', 'drow drow-stack automations-event');
  row.dataset.event = e.id;
  const top = h(doc, 'div', 'pl-head');
  if (projectName) top.append(h(doc, 'span', 'badge', projectName));
  const link = h(doc, 'a', '', `${e.kind === 'pr' ? 'PR' : isAzure(e.repo) ? 'Work item' : 'Issue'} #${e.number}`);
  if (/^https:\/\/(github\.com|dev\.azure\.com)\//.test(String(e.url || ''))) { link.href = e.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
  top.append(link, ' ', h(doc, 'span', '', e.title || ''), h(doc, 'span', `badge ${st.family}`, st.word));
  row.append(top);
  const triage = e.action === 'propose' && TRIAGE_WORDS[e.phase] ? `triaged: ${TRIAGE_WORDS[e.phase]}` : '';
  const meta = [e.author ? `by @${e.author}` : '', ACTION_WORDS[e.phase === 'fix' ? 'fix' : e.action] || '', triage, st.reason,
    e.costUsd ? `$${Number(e.costUsd).toFixed(2)}` : '', e.via === 'webhook' ? 'webhook' : ''].filter(Boolean).join(' · ');
  row.append(h(doc, 'small', 'hint', meta));
  const acts = h(doc, 'div', 'pl-actions');
  if (e.status === 'awaiting-approval' && cb.onApprove) acts.append(btn(doc, 'Approve', 'btn btn-primary btn-sm', () => cb.onApprove(e)));
  if (e.pipelineId && cb.onOpenRun) acts.append(btn(doc, 'Open run', 'btn btn-sm', () => cb.onOpenRun(e)));
  // A workspace fix opened one PR per changed repository: a link each, named by its repository.
  const prs = Array.isArray(e.prs) && e.prs.some((p) => p && p.url) ? e.prs.filter((p) => p && p.url) : (e.prUrl ? [{ url: e.prUrl }] : []);
  for (const p of prs) {
    if (!/^https:\/\//.test(p.url)) continue;
    const pr = h(doc, 'a', 'btn btn-sm', prs.length > 1 ? `Open PR (${p.name || p.repo || 'repository'})` : 'Open PR');
    pr.href = p.url; pr.target = '_blank'; pr.rel = 'noopener noreferrer';
    acts.append(pr);
  }
  if (acts.childNodes.length) row.append(acts);
  return row;
}

/** How events arrive, in one sentence. */
function deliveryLine(data, azure) {
  const hooked = azure ? data.azureWebhook?.configured : data.webhook?.configured;
  if (hooked) return `${azure ? 'Azure DevOps service hooks' : 'GitHub webhooks'}, plus a poll every 5 minutes.`;
  if (data.polling === false) return 'Polling is off (WORCA_AUTOMATIONS_POLL=0) and no webhook secret is set: nothing arrives.';
  return `Worca checks ${azure ? 'Azure DevOps' : 'GitHub'} every minute.`;
}

/** "Workspace “Shop” handles new issues in this repository: …" — a project's rules a workspace takes over. */
export function overrideLine(o) {
  const events = (o.events || []).map((e) => EVENT_NOUNS[e] || e);
  return `Workspace “${o.name}” handles ${events.join(' and ')} in this repository: its rules win, so this project's rules for `
    + `${events.length === 1 ? 'that event' : 'those events'} do nothing while the workspace's are on.`;
}

/**
 * A project's or a workspace's Automations tab.
 * data: GET /api/automations?projectDir= ({ scope: 'project', rules, events, autoHandle, switches, repo, forge, overriddenBy,
 *   defaultLimits, webhook, azureWebhook, polling }) or ?workspaceId= ({ scope: 'workspace', repos: [{ name, repo, forge }], … })
 * cb: { onSwitch(key, on), onAddRule(), onToggleRule(rule, on), onDeleteRule(rule), onApprove(event), onOpenRun(event), onCheckNow() }
 */
export function renderAutomations(doc, data, { workflowNames = {}, ...cb } = {}) {
  const root = h(doc, 'div', 'automations');
  const ws = data.scope === 'workspace';
  const watched = ws ? (data.repos || []).filter((r) => r.repo) : [];
  if (ws ? !watched.length : !data.repo) {
    root.append(h(doc, 'p', 'hint', ws
      ? 'No project in this workspace has a GitHub or Azure DevOps remote. Automations watch repositories on them.'
      : 'This project has no GitHub or Azure DevOps remote. Automations watch a repository on one of them.'));
    return root;
  }
  const azure = ws ? watched.some((r) => r.forge === 'azure') : data.forge === 'azure';
  const head = h(doc, 'p', 'hint automations-repo');
  head.append(ws ? `Watching ${watched.length} repositor${watched.length === 1 ? 'y' : 'ies'}: ${watched.map((r) => r.repo).join(', ')}. ${deliveryLine(data, azure)} `
    : `Watching ${data.repo}. ${deliveryLine(data, azure)} `);
  head.append(btn(doc, 'Check now', 'btn btn-sm btn-quiet', () => cb.onCheckNow?.()));
  root.append(head);
  if (ws) {
    const off = (data.repos || []).filter((r) => !r.repo).map((r) => r.name);
    root.append(h(doc, 'p', 'hint automations-scope', 'A new issue in any of them starts a workspace run: the plan may leave repositories '
      + 'untouched. A pull request is reviewed on its own. Where a member project has rules for the same event, this workspace\'s win.'
      + (off.length ? ` Not watched (no GitHub or Azure DevOps remote): ${off.join(', ')}.` : '')));
  }
  for (const o of data.overriddenBy || []) root.append(h(doc, 'p', 'hint automations-override', overrideLine(o)));

  const ah = h(doc, 'div', 'automations-switches drows');
  ah.append(h(doc, 'h3', '', 'Auto-handle'));
  for (const s of data.switches || []) {
    const sw = makeSwitch(doc, { label: s.label, checked: !!data.autoHandle?.[s.key], rowClass: 'automations-switch', data: { switch: s.key } });
    sw.input.addEventListener('change', () => cb.onSwitch?.(s.key, sw.input.checked));
    ah.append(sw.row);
    // What the switch does, and the limits its rule runs under (the stored rule's once it exists, else the defaults).
    const own = (data.rules || []).find((r) => r.origin === 'auto-handle' && autoHandleKey(r) === s.key);
    const help = h(doc, 'p', 'hint automations-switch-help', (ws && WORKSPACE_HELP[s.key]) || s.help || '');
    help.append(h(doc, 'span', 'automations-switch-limits', limitsLine(own?.limits || data.defaultLimits)));
    ah.append(help);
  }
  ah.append(h(doc, 'p', 'hint', azure
    ? 'Anyone in the organization can trigger runs; a new work item counts as a new issue, and its tags as labels. Runs use Strict guardrails.'
    : 'Only collaborators can trigger runs. Runs use Strict guardrails.'));
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
  for (const e of data.events || []) evs.append(eventRow(doc, e, cb));
  root.append(evs);
  return root;
}

/**
 * Settings › Automations: every project and workspace that automates something, how events arrive, and the latest activity.
 * data: GET /api/automations ({ rules, events, switches, webhook, azureWebhook, polling })
 * projects: [{ key, name }] (the registered projects; a workspace's key is `workspaces/<id>`, its rules' owner key).
 * cb: { onOpenProject(key), onApprove(event), onOpenRun(event) }
 */
export function renderAutomationsOverview(doc, data, projects = [], cb = {}) {
  const root = h(doc, 'div', 'automations automations-overview');
  const names = new Map(projects.map((p) => [p.key, p.name]));
  const delivery = h(doc, 'p', 'hint automations-repo');
  const gh = deliveryLine(data, false); const az = deliveryLine(data, true);
  delivery.append(data.polling === false && !data.webhook?.configured && !data.azureWebhook?.configured ? gh : `GitHub: ${gh} Azure DevOps: ${az}`);
  root.append(delivery);

  const list = h(doc, 'div', 'automations-projects drows');
  list.append(h(doc, 'h3', '', 'Projects and workspaces'));
  const byProject = new Map();
  for (const r of data.rules || []) {
    if (!byProject.has(r.projectKey)) byProject.set(r.projectKey, []);
    byProject.get(r.projectKey).push(r);
  }
  const labelOf = new Map((data.switches || []).map((s) => [s.key, s.label]));
  const shown = [...byProject].filter(([, rs]) => rs.some((r) => r.enabled));
  if (!shown.length) list.append(h(doc, 'div', 'hist-empty', AUTOMATIONS_EMPTY_PROJECTS));
  for (const [key, rs] of shown) {
    const row = h(doc, 'div', 'drow drow-stack automations-project');
    row.dataset.project = key;
    const top = h(doc, 'div', 'pl-head');
    top.append(h(doc, 'b', '', names.get(key) || key), h(doc, 'span', 'hint', rs[0].scope === 'workspace' ? 'Workspace: every member repository' : rs[0].repo || ''));
    row.append(top);
    const on = rs.filter((r) => r.enabled);
    const switches = on.filter((r) => r.origin === 'auto-handle').map((r) => labelOf.get(autoHandleKey(r))).filter(Boolean);
    const custom = on.filter((r) => r.origin !== 'auto-handle').length;
    row.append(h(doc, 'small', 'hint', [...switches, ...(custom ? [`${custom} rule${custom === 1 ? '' : 's'}`] : [])].join(' · ')));
    const acts = h(doc, 'div', 'pl-actions');
    acts.append(btn(doc, 'Open', 'btn btn-sm', () => cb.onOpenProject?.(key)));
    row.append(acts);
    list.append(row);
  }
  root.append(list);

  const evs = h(doc, 'div', 'automations-events drows');
  evs.append(h(doc, 'h3', '', 'Recent'));
  if (!(data.events || []).length) evs.append(h(doc, 'div', 'hist-empty', AUTOMATIONS_EMPTY_EVENTS));
  for (const e of data.events || []) evs.append(eventRow(doc, e, cb, { projectName: names.get(e.projectKey) || e.projectKey }));
  root.append(evs);
  return root;
}
