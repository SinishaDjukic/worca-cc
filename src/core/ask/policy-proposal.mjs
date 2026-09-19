// src/core/ask/policy-proposal.mjs
// The ONE validator behind mcp__worca__propose_policy_change, the pure document edit it proposes,
// and the event/notice text of the policy card. Pure: every reader is injected (policy-deps.mjs
// binds the real ones), so the MCP child validates for the model's self-correction and the parent
// turn re-validates authoritatively (the metrics-proposal.mjs split). Nothing here writes —
// applying a card is ui/server.mjs's business, behind the user's click.
//
// Why a card at all (docs/team-policy.md "Ask Worca"): every kind pushes to a shared branch or
// changes what a whole team's runs start from. Outward-facing and read by teammates — never a
// direct tool. Continuing past a team cap is deliberately NOT a kind: that override carries a
// person's reason and stays on the pause banner.
import { ASK_LIMITS } from './limits.mjs';
import { FIELDS, fieldMeta, normalizeEntry, normalizePolicyDoc, KINDS } from '../policy/registry.mjs';
import { fmtValue } from '../policy/effective.mjs';

export const POLICY_CHANGE_KINDS = Object.freeze(['enable', 'edit', 'workspace_home', 'route_members']);
const TITLE_MAX = 120;
const NOTES_MAX = 2000;
const MAX_OPS = 20;

export const POLICY_ERRORS = Object.freeze({
  kind: `kind must be one of ${POLICY_CHANGE_KINDS.join(', ')}`,
  bothTargets: 'give projectKey OR workspaceId, not both',
  projectRequired: (kind) => `${kind} needs a projectKey`,
  workspaceRequired: (kind) => `${kind} needs a workspaceId`,
  targetRequired: 'edit needs a projectKey or a workspaceId (the policy that governs it is edited)',
  unknownProject: (key) => `unknown projectKey "${key}"`,
  unknownWorkspace: (id) => `unknown workspaceId "${id}"`,
  mode: 'mode must be "here" or "follow"',
  noOrigin: (name) => `${name} has no origin remote — a team policy lives on origin, so there is nowhere to put it`,
  delegateTo: 'delegateTo must be the slug (owner/repo) of the project whose policy to follow',
  targetUnknown: (slug) => `${slug} is not a project in Worca on this machine — list_projects shows each project's policy slug`,
  targetNoPolicy: (slug) => `${slug} carries no team policy — it needs one before others can follow it`,
  targetFollows: (slug, other) => `${slug} follows ${other}; follow ${other} directly (no chains)`,
  followSelf: (name) => `${name} cannot follow itself`,
  alreadyCarries: (name) => `${name} already carries its own team policy — propose kind "edit" to change it`,
  carriesNotMarker: (name) => `${name} carries its own team policy; it cannot be turned into a follower from here`,
  alreadyFollows: (name, slug) => `${name} already follows ${slug}`,
  followsNotHere: (name, slug) => `${name} follows ${slug}; its branch is a marker, not a policy — edit ${slug}'s policy instead, or propose mode "follow" to re-point it`,
  noPolicy: (name, detail) => `${name} has no usable team policy${detail ? ` (${detail})` : ''} — propose kind "enable" first`,
  notHome: (slug) => `the policy home ${slug} is not checked out on this machine, so it cannot be published from here — edit it where ${slug} is registered, or on the Team policy page there`,
  opsRequired: 'edit needs at least one of set, unset, title or notes',
  tooMany: `at most ${MAX_OPS} field changes per card`,
  opShape: (i) => `set[${i}] must be { key, value, kind?, onBreach?, requireReason?, window?, forWorkspaceRuns? }`,
  unsetShape: (i) => `unset[${i}] must be { key, forWorkspaceRuns? }`,
  unknownField: (key) => `unknown field "${key}" — get_team_policy lists every field key`,
  kindRequired: (key, kinds) => `${key}: kind is required for a field the policy does not set yet (${kinds.join(' | ')})`,
  hard: (key) => `${key}: hard constraints are not enforced by this version — use "soft"`,
  unsetMissing: (key, block) => `${key} is not set in ${block === 'workspaceRuns' ? 'the workspaceRuns block' : 'the policy'}`,
  duplicate: (key) => `${key} is changed twice in one card`,
  title: `title must be a string of at most ${TITLE_MAX} characters`,
  notes: `notes must be a string of at most ${NOTES_MAX} characters`,
  noChange: 'nothing changes — the policy already says exactly this',
  homeNotMember: (key) => `homeProjectKey "${key}" is not a member of this workspace`,
  homeNoPolicy: (name) => `${name} has no team policy of its own and follows none, so it cannot be the policy home — enable it first`,
  homeSame: (name) => `${name} is already the policy home`,
  homeUnset: 'the policy home is already unset',
  noHome: (name) => `${name} has no valid policy home — propose kind "workspace_home" first`,
});

const str = (v) => (typeof v === 'string' ? v.trim() : '');
// eslint-disable-next-line no-control-regex
const BREAKS_RE = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/g;
const clip = (v, n) => String(v ?? '').replace(BREAKS_RE, ' ').slice(0, n);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v ?? null));

/** One entry as a single line: "soft $25.00 · pause · reason required". */
export function describeEntry(key, entry) {
  if (!entry) return null;
  const meta = fieldMeta(key);
  if (!meta) return null;
  const bits = [`${entry.kind} ${fmtValue(meta, entry.value)}`];
  if (entry.onBreach) bits.push(entry.onBreach);
  if (entry.requireReason) bits.push('reason required');
  if (entry.window) bits.push(entry.window);
  return bits.join(' · ');
}

/**
 * Normalise the model's edit ops against the CURRENT document. Returns {ops} or {errors}.
 * ops: { set:[{key, block, entry}], unset:[{key, block}], title?, notes? } — entries validated.
 */
export function normalizeEditOps(raw, doc) {
  const errors = [];
  const set = Array.isArray(raw.set) ? raw.set : raw.set == null ? [] : null;
  const unset = Array.isArray(raw.unset) ? raw.unset : raw.unset == null ? [] : null;
  if (set === null) errors.push(POLICY_ERRORS.opShape(0));
  if (unset === null) errors.push(POLICY_ERRORS.unsetShape(0));
  if (errors.length) return { errors };
  if (set.length + unset.length > MAX_OPS) return { errors: [POLICY_ERRORS.tooMany] };
  const seen = new Set();
  const ops = { set: [], unset: [] };
  set.forEach((op, i) => {
    if (!isObj(op) || !str(op.key) || !('value' in op)) { errors.push(POLICY_ERRORS.opShape(i)); return; }
    const key = str(op.key);
    const meta = fieldMeta(key);
    if (!meta) { errors.push(POLICY_ERRORS.unknownField(clip(key, 80))); return; }
    const block = op.forWorkspaceRuns === true ? 'workspaceRuns' : 'fields';
    const id = `${block}:${key}`;
    if (seen.has(id)) { errors.push(POLICY_ERRORS.duplicate(key)); return; }
    seen.add(id);
    const cur = doc?.[block]?.[key] || (block === 'workspaceRuns' ? doc?.fields?.[key] : null) || null;
    let kind = str(op.kind);
    if (kind === 'hard') { errors.push(POLICY_ERRORS.hard(key)); return; }
    if (!kind) {
      if (cur && meta.kinds.includes(cur.kind)) kind = cur.kind;
      else if (meta.kinds.length === 1) kind = meta.kinds[0];
      else { errors.push(POLICY_ERRORS.kindRequired(key, meta.kinds)); return; }
    }
    if (!KINDS.includes(kind)) { errors.push(`${key}: kind must be one of ${meta.kinds.join(' | ')}`); return; }
    // Attributes not given keep the current entry's (raising a cap keeps its onBreach / reason rule).
    const rawEntry = { kind, value: op.value };
    for (const a of meta.attrs || []) {
      if (op[a] !== undefined && op[a] !== null) rawEntry[a] = op[a];
      else if (cur && cur[a] !== undefined && cur.kind === kind) rawEntry[a] = cur[a];
    }
    const { entry, warning } = normalizeEntry(key, rawEntry);
    if (!entry) { errors.push(warning || `${key}: invalid`); return; }
    if (warning) { errors.push(warning); return; }
    ops.set.push({ key, block, entry });
  });
  unset.forEach((op, i) => {
    const o = typeof op === 'string' ? { key: op } : op;
    if (!isObj(o) || !str(o.key)) { errors.push(POLICY_ERRORS.unsetShape(i)); return; }
    const key = str(o.key);
    if (!fieldMeta(key)) { errors.push(POLICY_ERRORS.unknownField(clip(key, 80))); return; }
    const block = o.forWorkspaceRuns === true ? 'workspaceRuns' : 'fields';
    const id = `${block}:${key}`;
    if (seen.has(id)) { errors.push(POLICY_ERRORS.duplicate(key)); return; }
    seen.add(id);
    if (!doc?.[block]?.[key]) { errors.push(POLICY_ERRORS.unsetMissing(key, block)); return; }
    ops.unset.push({ key, block });
  });
  if (raw.title !== undefined && raw.title !== null) {
    if (typeof raw.title !== 'string' || raw.title.length > TITLE_MAX) errors.push(POLICY_ERRORS.title);
    else ops.title = clip(raw.title, TITLE_MAX).trim();
  }
  if (raw.notes !== undefined && raw.notes !== null) {
    if (typeof raw.notes !== 'string' || raw.notes.length > NOTES_MAX) errors.push(POLICY_ERRORS.notes);
    else ops.notes = String(raw.notes).replace(/\r\n?/g, '\n').slice(0, NOTES_MAX);
  }
  if (errors.length) return { errors };
  if (!ops.set.length && !ops.unset.length && ops.title === undefined && ops.notes === undefined) return { errors: [POLICY_ERRORS.opsRequired] };
  return { ops };
}

/** Apply normalised ops to a document (a copy). Pure; the publisher re-validates the result. */
export function applyEditOps(doc, ops) {
  const next = clone(doc) || {};
  next.fields = isObj(next.fields) ? next.fields : {};
  next.workspaceRuns = isObj(next.workspaceRuns) ? next.workspaceRuns : {};
  for (const s of ops.set || []) next[s.block][s.key] = clone(s.entry);
  for (const u of ops.unset || []) delete next[u.block][u.key];
  if (ops.title !== undefined) next.title = ops.title;
  if (ops.notes !== undefined) next.notes = ops.notes;
  delete next.delegateTo;
  return next;
}

/** Human lines for the card: one per changed field (before → after), title and notes last. */
export function describeChanges(doc, next) {
  const out = [];
  for (const block of ['fields', 'workspaceRuns']) {
    // Registry order, like the editor and the branch file.
    const keys = FIELDS.map((f) => f.key).filter((k) => doc?.[block]?.[k] || next?.[block]?.[k]);
    for (const key of keys) {
      const a = doc?.[block]?.[key] || null;
      const b = next?.[block]?.[key] || null;
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      const meta = fieldMeta(key);
      const val = (e) => (e && meta ? fmtValue(meta, e.value) : null);
      out.push({ key, block, label: `${meta ? meta.label : key}${block === 'workspaceRuns' ? ' (workspace runs)' : ''}`,
        before: describeEntry(key, a), after: describeEntry(key, b), beforeValue: val(a), afterValue: val(b) });
    }
  }
  if ((doc?.title || '') !== (next?.title || '')) out.push({ key: 'title', block: null, label: 'Title', before: doc?.title || null, after: next?.title || null });
  if ((doc?.notes || '') !== (next?.notes || '')) out.push({ key: 'notes', block: null, label: 'Notes', before: doc?.notes ? 'set' : null, after: next?.notes ? 'updated' : null });
  return out;
}

/**
 * @param {{listProjects:() => Promise<Array<{key,name,path}>>, readWorkspace:(id) => Promise<object|null>,
 *          projectKeyOf:(path) => string, projectStatus:(p) => Promise<object>,
 *          scopePolicy:(scope) => Promise<{meta, r, canPublish:boolean}>,
 *          followersOf?:(home) => Promise<string[]>}} readers
 */
export function createPolicyChangeValidator({ listProjects, readWorkspace, projectKeyOf, projectStatus, scopePolicy, followersOf = null }) {
  const nameOf = (p) => clip(p.name || p.key, 120);
  const findProject = async (key) => (await listProjects()).find((x) => x && x.key === key) || null;
  return async function validatePolicyChange(input = {}) {
    const raw = isObj(input) ? input : {};
    const kind = str(raw.kind);
    if (!POLICY_CHANGE_KINDS.includes(kind)) return { ok: false, errors: [POLICY_ERRORS.kind] };
    const projectKey = str(raw.projectKey);
    const workspaceId = str(raw.workspaceId);
    if (projectKey && workspaceId) return { ok: false, errors: [POLICY_ERRORS.bothTargets] };
    const note = clip(raw.note, ASK_LIMITS.proposalNoteMaxChars);
    const card = { type: 'policy', kind, note, projectKey: null, projectName: null, workspaceId: null, workspaceName: null, summary: '', effects: [] };

    if (kind === 'enable') {
      if (!projectKey) return { ok: false, errors: [POLICY_ERRORS.projectRequired(kind)] };
      const p = await findProject(projectKey);
      if (!p) return { ok: false, errors: [POLICY_ERRORS.unknownProject(clip(projectKey, 120))] };
      card.projectKey = p.key; card.projectName = nameOf(p);
      const st = (await projectStatus(p)) || {};
      if (st.hasOrigin === false) return { ok: false, errors: [POLICY_ERRORS.noOrigin(card.projectName)] };
      const mode = raw.mode == null || raw.mode === '' ? 'here' : raw.mode;
      if (mode !== 'here' && mode !== 'follow') return { ok: false, errors: [POLICY_ERRORS.mode] };
      card.mode = mode;
      if (mode === 'here') {
        if (st.present && !st.delegateTo) return { ok: false, errors: [POLICY_ERRORS.alreadyCarries(card.projectName)] };
        if (st.present && st.delegateTo) return { ok: false, errors: [POLICY_ERRORS.followsNotHere(card.projectName, st.delegateTo)] };
        const title = raw.title == null ? '' : raw.title;
        if (typeof title !== 'string' || title.length > TITLE_MAX) return { ok: false, errors: [POLICY_ERRORS.title] };
        card.title = clip(title, TITLE_MAX).trim();
        card.delegateTo = null; card.change = false;
        card.summary = `Set up a team policy on ${card.projectName} — on its own worca-policy branch`;
        card.effects = [
          'Creates the orphan branch worca-policy on origin, holding only .worca-policy/ with an empty policy',
          'Nothing changes for anyone until fields are published — ask me to set them, or use the Team policy page',
          'Teammates\' Worca discovers the branch within the hour',
        ];
        return { ok: true, card };
      }
      const delegateTo = str(raw.delegateTo).toLowerCase();
      if (!delegateTo || /\s/.test(delegateTo)) return { ok: false, errors: [POLICY_ERRORS.delegateTo] };
      if (st.slug && delegateTo === String(st.slug).toLowerCase()) return { ok: false, errors: [POLICY_ERRORS.followSelf(card.projectName)] };
      if (st.present && !st.delegateTo) return { ok: false, errors: [POLICY_ERRORS.carriesNotMarker(card.projectName)] };
      if (st.present && String(st.delegateTo).toLowerCase() === delegateTo) return { ok: false, errors: [POLICY_ERRORS.alreadyFollows(card.projectName, delegateTo)] };
      // The core follows only a project registered HERE that carries a policy itself (no chains).
      let target = null;
      for (const q of await listProjects()) {
        if (!q || q.key === p.key) continue;
        const qs = (await projectStatus(q)) || {};
        if (qs.slug && String(qs.slug).toLowerCase() === delegateTo) { target = qs; break; }
      }
      if (!target) return { ok: false, errors: [POLICY_ERRORS.targetUnknown(delegateTo)] };
      if (!target.present) return { ok: false, errors: [POLICY_ERRORS.targetNoPolicy(delegateTo)] };
      if (target.delegateTo) return { ok: false, errors: [POLICY_ERRORS.targetFollows(delegateTo, target.delegateTo)] };
      card.delegateTo = delegateTo;
      card.change = !!st.present;
      card.title = null;
      card.summary = `${card.change ? 'Re-point' : 'Make'} ${card.projectName} ${card.change ? 'to follow' : 'follow'} ${delegateTo}'s team policy`;
      card.effects = [
        `${card.change ? 'Rewrites' : 'Pushes'} a marker branch worca-policy on ${card.projectName}'s origin that points at ${delegateTo}`,
        `Single-project runs on ${card.projectName} then follow ${delegateTo}'s policy, for every teammate`,
        `${delegateTo} must be registered in Worca on each teammate's machine for the policy to resolve there`,
      ];
      return { ok: true, card };
    }

    if (kind === 'edit') {
      if (!projectKey && !workspaceId) return { ok: false, errors: [POLICY_ERRORS.targetRequired] };
      let scope;
      if (projectKey) {
        const p = await findProject(projectKey);
        if (!p) return { ok: false, errors: [POLICY_ERRORS.unknownProject(clip(projectKey, 120))] };
        card.projectKey = p.key; card.projectName = nameOf(p);
        scope = { kind: 'project', id: p.key };
      } else {
        const ws = await readWorkspace(workspaceId);
        if (!ws) return { ok: false, errors: [POLICY_ERRORS.unknownWorkspace(clip(workspaceId, 120))] };
        card.workspaceId = ws.id; card.workspaceName = clip(ws.name || ws.id, 120);
        scope = { kind: 'workspace', id: ws.id };
      }
      const targetName = card.projectName || card.workspaceName;
      const { r, canPublish } = await scopePolicy(scope);
      if (!r || !r.ok) return { ok: false, errors: [POLICY_ERRORS.noPolicy(targetName, r && r.detail)] };
      if (!canPublish) return { ok: false, errors: [POLICY_ERRORS.notHome(r.home)] };
      const n = normalizeEditOps(raw, r.doc);
      if (n.errors) return { ok: false, errors: n.errors };
      const next = applyEditOps(r.doc, n.ops);
      const check = normalizePolicyDoc(next);
      if (!check.doc || check.warnings.length) return { ok: false, errors: check.warnings.length ? check.warnings : ['the edited policy is invalid'] };
      const changes = describeChanges(r.doc, next);
      if (!changes.length) return { ok: false, errors: [POLICY_ERRORS.noChange] };
      const message = clip(raw.message, 120).trim();
      card.home = r.home; card.baseSha = r.sha || null; card.ops = n.ops; card.changes = changes; card.message = message || null;
      const one = changes.length === 1 ? changes[0] : null;
      card.summary = one
        ? `Edit ${r.home}'s team policy — ${one.label}: ${(one.beforeValue ?? one.before) || 'unset'} → ${(one.afterValue ?? one.after) || 'unset'}`
        : `Edit ${r.home}'s team policy — ${changes.length} changes`;
      let followers = [];
      if (followersOf) { try { followers = (await followersOf(r.home)) || []; } catch { followers = []; } }
      const others = followers.filter((s) => s !== r.home);
      card.effects = [
        `One commit to ${r.home}'s worca-policy branch, pushed to origin under your git user`,
        others.length ? `Governs ${r.home} and the projects that follow it: ${others.slice(0, 6).join(', ')}${others.length > 6 ? ` +${others.length - 6}` : ''}` : `Governs ${r.home} and every project that follows it`,
        'Teammates pick it up on their next discovery (within the hour) or on Refresh',
      ];
      if (n.ops.set.some((s) => s.entry.kind === 'soft' && fieldMeta(s.key)?.cap)) {
        card.effects.push('Soft caps pause a run at the cap; a developer can continue past it, and the override is recorded');
      }
      return { ok: true, card };
    }

    // workspace_home / route_members
    if (!workspaceId) return { ok: false, errors: [POLICY_ERRORS.workspaceRequired(kind)] };
    const ws = await readWorkspace(workspaceId);
    if (!ws) return { ok: false, errors: [POLICY_ERRORS.unknownWorkspace(clip(workspaceId, 120))] };
    card.workspaceId = ws.id; card.workspaceName = clip(ws.name || ws.id, 120);
    const projects = await listProjects();
    const members = (ws.projectPaths || []).map((path) => {
      const key = projectKeyOf(path);
      const p = projects.find((x) => x && x.key === key);
      return { key, path, name: p ? nameOf(p) : clip(String(path).split('/').pop(), 120), project: p || null };
    });
    const homeKey = ws.policyProject ? projectKeyOf(ws.policyProject) : null;
    if (kind === 'workspace_home') {
      const wantKey = raw.homeProjectKey === null || raw.homeProjectKey === undefined || raw.homeProjectKey === '' ? null : str(raw.homeProjectKey);
      if (wantKey === null) {
        if (!homeKey) return { ok: false, errors: [POLICY_ERRORS.homeUnset] };
        card.homeProjectKey = null; card.homeProjectName = null; card.homePath = null;
        card.summary = `Clear the policy home of ${card.workspaceName}`;
        card.effects = ['Workspace runs of this workspace run with no team policy on this machine until a new home is chosen', 'Members keep their own single-project policy'];
        return { ok: true, card };
      }
      const m = members.find((x) => x.key === wantKey);
      if (!m) return { ok: false, errors: [POLICY_ERRORS.homeNotMember(clip(wantKey, 120))] };
      if (homeKey === m.key) return { ok: false, errors: [POLICY_ERRORS.homeSame(m.name)] };
      const st = m.project ? (await projectStatus(m.project)) || {} : {};
      if (!st.home) return { ok: false, errors: [POLICY_ERRORS.homeNoPolicy(m.name)] };
      card.homeProjectKey = m.key; card.homeProjectName = m.name; card.homePath = m.path; card.home = st.home;
      card.summary = `Set the policy home of ${card.workspaceName} to ${m.name}`;
      card.effects = [
        `Workspace runs follow ${st.home}'s team policy, with its workspaceRuns block on top`,
        'A per-machine choice: teammates pick their own home for the same workspace',
      ];
      return { ok: true, card };
    }
    // route_members
    const { r } = await scopePolicy({ kind: 'workspace', id: ws.id });
    if (!r || !r.ok) return { ok: false, errors: [POLICY_ERRORS.noHome(card.workspaceName)] };
    const home = members.find((x) => x.key === homeKey) || null;
    card.homeProjectKey = home ? home.key : null; card.homeProjectName = home ? home.name : null; card.home = r.home;
    card.summary = `Route every member of ${card.workspaceName} to ${r.home}'s team policy`;
    card.effects = [
      `Each member with no worca-policy branch gets a marker branch on its origin that follows ${r.home}`,
      'Members that already carry or follow a policy are left alone',
      'One push per member; a push a repository rejects is reported per member',
    ];
    return { ok: true, card };
  };
}

const eventText = (s, n) => clip(s, n).replace(/"/g, "'").replace(/\[(\/?)worca context\]/gi, '($1worca context)');

/** `[worca event] …` — the synthetic turn's prompt after the user acted on a policy card. */
export function policyEventPrompt({ cardId, state, card = {}, result = null }) {
  const summary = eventText(card.summary, 160);
  if (state === 'declined') return `[worca event] policy card ${cardId} declined; "${summary}"`;
  if (state === 'failed') return `[worca event] policy card ${cardId} failed: ${eventText(result?.error || 'unknown error', 200)}; "${summary}"`;
  return `[worca event] policy card ${cardId} applied; "${summary}"${result?.detail ? `; ${eventText(result.detail, 300)}` : ''}`;
}

/** The user-row notice above the event turn. */
export function policyNoticeText({ state, card = {}, result = null }) {
  const s = clip(card.summary, 120);
  if (state === 'declined') return `Declined — ${s}`;
  if (state === 'failed') return `Could not apply — ${s}: ${clip(result?.error || 'unknown error', 200)}`;
  return `Applied — ${s}${result?.detail ? ` · ${clip(result.detail, 200)}` : ''}`;
}
