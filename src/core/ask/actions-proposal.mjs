// src/core/ask/actions-proposal.mjs
// The ONE validator behind mcp__worca__propose_actions_change, and the event/notice text of the
// actions card (docs/actions.md "Chat"). Pure: the stored config and the workspace registry
// are injected (actions-deps.mjs binds the real ones), so the MCP child validates for the model's
// self-correction and the parent turn re-validates authoritatively and mints the card — the
// workspace-proposal.mjs split. Nothing here writes and nothing here runs: the card is applied by
// ui/server.mjs's cards route behind the user's click, and an action still only ever starts from a
// person's Start button. Every command the card would store is shown on it word for word.
import { normalizeProjectActions, normalizeAction, normalizeStacks, memberAliases } from '../actions/model.mjs';

export const ACTIONS_CHANGE_KINDS = Object.freeze(['project', 'stacks']);

const str = (v) => (typeof v === 'string' ? v.trim() : '');
// eslint-disable-next-line no-control-regex
const BREAKS_RE = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/g;
const clip = (v, n) => String(v ?? '').replace(BREAKS_RE, ' ').slice(0, n);
const basename = (p) => String(p).split('/').filter(Boolean).pop() || String(p);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// The Ask tools show stored commands redacted (a key in an env row). A value that comes back holding a
// marker is the stored one only when the whole action is unchanged; anything else would store the marker.
const REDACTION_MARK_RE = /<redacted>|\[redacted\]/;
const deepStrings = (v, fn) => (typeof v === 'string' ? fn(v) : Array.isArray(v) ? v.map((x) => deepStrings(x, fn))
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepStrings(x, fn)])) : v);
const RUNS_AS = 'Commands run on this machine as the user worca runs as, only when a person clicks Start (or Check out, for the setup command). Chat never starts them';

/** One action as the card shows it: the command first, word for word, then how it runs. */
export function describeAction(a) {
  const lines = [a.cmd];
  if (a.cmdWin32) lines.push(`Windows: ${a.cmdWin32}`);
  const ready = a.kind === 'task' ? 'runs to an exit code'
    : a.ready.kind === 'port' ? `ready when port ${a.ready.port} answers (${Math.round(a.ready.timeoutMs / 1000)} s)`
      : a.ready.kind === 'output' ? `ready when the output contains "${a.ready.text}" (${Math.round(a.ready.timeoutMs / 1000)} s)`
        : 'ready once it starts';
  lines.push(`${a.kind} · ${ready}${a.cwd && a.cwd !== '.' ? ` · in ${a.cwd}` : ''}`);
  for (const e of a.env) lines.push(e.type === 'port' ? `${e.name} = port ${e.value === 'auto' ? '(automatic)' : e.value}` : `${e.name} = ${e.value}`);
  if (a.openUrl) lines.push(`open ${a.openUrl}`);
  return lines.join('\n');
}

const describeStack = (s, nameOf) => [
  `${s.kind} stack`,
  ...s.steps.map((st, i) => `${i + 1}. ${nameOf(st.member)} › ${st.action}${st.env.length ? ` (${st.env.map((e) => `${e.name}=${e.value}`).join(', ')})` : ''}`),
].join('\n');

/**
 * @param {object} r
 * @param {() => Promise<Array<{key,name,path}>>} r.listProjects           registered projects
 * @param {(key:string) => object} r.readProjectActions                    the stored config (normalized)
 * @param {(id:string) => Promise<{id,name}|null>} r.readWorkspace
 * @param {(id:string) => Promise<Array<{projectKey,name}>|null>} r.workspaceMembers
 * @param {(id:string) => object[]} r.readWorkspaceStacks
 * @param {(key:string) => Promise<Array<{workspaceId,workspaceName,stackId,label,actions:string[]}>>} r.stacksUsing
 *        the workspace stacks that start one of this project's actions
 * @param {(s:string) => string} [r.redact]  the redaction the read tools apply (to recognise a value they showed redacted)
 */
export function createActionsChangeValidator(r) {
  const redact = typeof r.redact === 'function' ? r.redact : (x) => x;
  const marked = (v) => REDACTION_MARK_RE.test(JSON.stringify(v ?? ''));
  /** The incoming action list with each redacted-but-unchanged action swapped back for the stored one. */
  function unredactActions(list, before) {
    return list.map((a, i) => {
      if (!marked(a)) return a;
      const old = before.actions.find((x) => x.id === str(a?.id));
      let mine = null;
      try { mine = normalizeAction(a, i); } catch { mine = null; }
      if (old && mine && same(mine, deepStrings(old, redact))) return old;
      throw Object.assign(new Error(`action "${clip(str(a?.id), 40)}" holds a redacted value — send it back exactly as get_project_actions returned it, or ask the user to change it on the project's Actions tab`), { field: `actions[${i}]` });
    });
  }
  /** @returns {Promise<{ok:true, card:object}|{ok:false, errors:string[]}>} */
  return async function validateActionsChange(input) {
    const inp = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const kind = str(inp.kind);
    if (!ACTIONS_CHANGE_KINDS.includes(kind)) return { ok: false, errors: [`kind must be one of ${ACTIONS_CHANGE_KINDS.join(', ')}`] };
    const note = clip(str(inp.note), 200);
    const card = { type: 'actions', kind, summary: '', ...(note ? { note } : {}), changes: [], warnings: [], effects: [RUNS_AS] };
    try {
      if (kind === 'project') {
        const key = str(inp.projectKey);
        if (!key) return { ok: false, errors: ['projectKey is required for kind "project"'] };
        const p = ((await r.listProjects()) || []).find((x) => x && x.key === key);
        if (!p) return { ok: false, errors: [`unknown projectKey "${clip(key, 120)}" — list_projects names the registered projects`] };
        if (!Array.isArray(inp.actions)) return { ok: false, errors: ['actions is required: the full list (send [] to remove them all; get_project_actions returns the current one)'] };
        const before = r.readProjectActions(key);
        // setup and builtins left out keep what is stored; actions is always the whole list.
        let setup = Object.hasOwn(inp, 'setup') ? inp.setup : before.setup;
        if (marked(setup)) {
          if (str(setup) !== redact(before.setup || '')) return { ok: false, errors: ['the setup command holds a redacted value — send it back exactly as get_project_actions returned it, or ask the user to change it on the project\'s Actions tab'] };
          setup = before.setup;
        }
        const after = normalizeProjectActions({
          setup,
          actions: unredactActions(inp.actions, before),
          builtins: inp.builtins && typeof inp.builtins === 'object' ? { ...before.builtins, ...inp.builtins } : before.builtins,
        });
        const name = clip(p.name || basename(p.path), 120);
        card.projectKey = key;
        card.projectName = name;
        if ((before.setup || null) !== (after.setup || null)) {
          card.changes.push({ op: !before.setup ? 'add' : !after.setup ? 'remove' : 'change', label: 'Setup', before: before.setup || null, after: after.setup || null });
        }
        const beforeById = new Map(before.actions.map((a) => [a.id, a]));
        const afterIds = new Set(after.actions.map((a) => a.id));
        for (const a of after.actions) {
          const old = beforeById.get(a.id);
          if (!old) card.changes.push({ op: 'add', label: a.label, id: a.id, after: describeAction(a) });
          else if (!same(old, a)) card.changes.push({ op: 'change', label: a.label, id: a.id, before: describeAction(old), after: describeAction(a) });
        }
        for (const a of before.actions) if (!afterIds.has(a.id)) card.changes.push({ op: 'remove', label: a.label, id: a.id, before: describeAction(a) });
        const off = Object.entries(after.builtins).filter(([k, v]) => before.builtins[k] !== v);
        for (const [k, v] of off) card.changes.push({ op: 'change', label: `Built-in ${k}`, before: before.builtins[k] ? 'on' : 'off', after: v ? 'on' : 'off' });
        if (!card.changes.length) return { ok: false, errors: [`this is what ${name} already has — nothing would change`] };
        const removed = before.actions.filter((a) => !afterIds.has(a.id)).map((a) => a.id);
        const kindChanged = after.actions.filter((a) => beforeById.get(a.id) && beforeById.get(a.id).kind !== a.kind).map((a) => a.id);
        for (const s of (await r.stacksUsing(key)) || []) {
          const hit = s.actions.filter((id) => removed.includes(id) || kindChanged.includes(id));
          if (hit.length) card.warnings.push(`Stack "${clip(s.label, 40)}" of workspace ${clip(s.workspaceName, 80)} starts ${hit.join(', ')} — change that stack too, or it stops working`);
        }
        const verb = !before.actions.length && !before.setup ? 'Set up actions for' : 'Change the actions of';
        card.summary = `${verb} ${name}`;
        card.change = { projectKey: key, config: after };
        return { ok: true, card };
      }

      // kind === 'stacks'
      const id = str(inp.workspaceId);
      if (!id) return { ok: false, errors: ['workspaceId is required for kind "stacks"'] };
      const ws = await r.readWorkspace(id);
      const members = ws ? await r.workspaceMembers(id) : null;
      if (!ws || !members) return { ok: false, errors: [`unknown workspace "${clip(id, 120)}" — list_projects names the workspaces`] };
      if (!Array.isArray(inp.stacks)) return { ok: false, errors: ['stacks is required: the full list (send [] to remove them all; get_workspace_stacks returns the current one)'] };
      const memberActions = Object.fromEntries(members.map((m) => [m.projectKey, r.readProjectActions(m.projectKey).actions.map(({ id: aid, kind: k }) => ({ id: aid, kind: k }))]));
      if (marked(inp.stacks)) return { ok: false, errors: ['a stack step holds a redacted value — ask the user to change that stack on the workspace\'s Actions tab'] };
      const { stacks } = normalizeStacks({ stacks: inp.stacks }, { memberActions });
      const before = r.readWorkspaceStacks(id) || [];
      const aliases = memberAliases(members);
      const nameOf = (k) => { const m = members.find((x) => x.projectKey === k); return clip(m ? `${m.name} (${aliases[k]})` : k, 80); };
      const beforeById = new Map(before.map((s) => [s.id, s]));
      const afterIds = new Set(stacks.map((s) => s.id));
      for (const s of stacks) {
        const old = beforeById.get(s.id);
        if (!old) card.changes.push({ op: 'add', label: s.label, id: s.id, after: describeStack(s, nameOf) });
        else if (!same(old, s)) card.changes.push({ op: 'change', label: s.label, id: s.id, before: describeStack(old, nameOf), after: describeStack(s, nameOf) });
      }
      for (const s of before) if (!afterIds.has(s.id)) card.changes.push({ op: 'remove', label: s.label, id: s.id, before: describeStack(s, nameOf) });
      card.workspaceId = ws.id;
      card.workspaceName = clip(ws.name || ws.id, 120);
      if (!card.changes.length) return { ok: false, errors: [`this is what ${card.workspaceName} already has — nothing would change`] };
      card.summary = `${before.length ? 'Change the stacks of' : 'Add stacks to'} ${card.workspaceName}`;
      card.change = { workspaceId: ws.id, stacks };
      return { ok: true, card };
    } catch (err) {
      const field = err && err.field ? ` (${err.field})` : '';
      return { ok: false, errors: [`${String(err && err.message ? err.message : err)}${field}`] };
    }
  };
}

/** The pinned project / workspace fills a missing target — the tool's own default (tools.mjs), replayed by turn.mjs. */
export function actionsProposalInput(input, pin) {
  const inp = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  if (str(inp.kind) === 'project' && !str(inp.projectKey) && pin?.projectKey) return { ...inp, projectKey: pin.projectKey };
  if (str(inp.kind) === 'stacks' && !str(inp.workspaceId) && pin?.workspaceId) return { ...inp, workspaceId: pin.workspaceId };
  return inp;
}

const eventText = (s, n) => clip(s, n).replace(/"/g, "'").replace(/\[(\/?)worca context\]/gi, '($1worca context)');

/** `[worca event] …` — the synthetic turn's prompt after the user acted on an actions card. */
export function actionsEventPrompt({ cardId, state, card = {}, result = null }) {
  const summary = eventText(card.summary, 200);
  if (state === 'declined') return `[worca event] actions card ${cardId} declined; "${summary}"`;
  if (state === 'failed') return `[worca event] actions card ${cardId} failed: ${eventText(result?.error || 'unknown error', 300)}; "${summary}"`;
  return `[worca event] actions card ${cardId} applied; "${summary}"${result?.detail ? `; ${eventText(result.detail, 300)}` : ''}`;
}

/** The user-row notice above the event turn. */
export function actionsNoticeText({ state, card = {}, result = null }) {
  const s = clip(card.summary, 160);
  if (state === 'declined') return `Declined — ${s}`;
  if (state === 'failed') return `Could not apply — ${s}: ${clip(result?.error || 'unknown error', 200)}`;
  return `Applied — ${s}${result?.detail ? ` · ${clip(result.detail, 200)}` : ''}`;
}
