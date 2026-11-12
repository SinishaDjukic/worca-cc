// src/core/pr-auto-finish.mjs
// "Create a PR when a run finishes": the server-side step that runs once a run has settled (after teardown committed its
// work). It reads the decision the run saved at its start (pipelines.pr_auto, src/core/pr-auto.mjs) and opens the PR through
// the server's own PR paths, attributed to the person who started the run. A Shaper feature's slices follow the feature's
// copy: `each` opens a stacked PR per slice, `one` opens a single PR once the whole feature is done.
// Nothing here changes a run's status or throws into the caller: every problem becomes a recorded, logged outcome.

import { PR_OPEN_LABELS, prExemptText } from '../shared/pr-auto.mjs';
import { readRunPrAuto, setRunPrOutcome, featurePrSetting, setFeaturePrOutcome, logToRun } from './pr-auto.mjs';
import { featureOfPipeline, featureView, featureThread, featureRootSource, featureBase, acceptanceRefusal } from './shape/features.mjs';
import { roundOrigin } from './shape/rounds.mjs';
import { readPrState, readMemberPrStates, readPipelineStateById } from './artifacts.mjs';
import { branchExists, commitsAhead } from './git-info.mjs';
import { addNotification } from './notifications.mjs';
import { withBillTo, normalizeBillTo } from './billing.mjs';
import { asPersonMode } from './github-credentials.mjs';
import { personGithubToken } from './broker-client.mjs';
import { forgeOf, parseRemoteUrl } from './forge.mjs';
import { workspaceMembers } from './workspace-prs.mjs';

const SETTLED = new Set(['done', 'error', 'stopped']);
const NOT_OPENED = 'Pull request not opened';

/**
 * Can the starter's own GitHub account push? Only asked when PRs must go out as a person (WORCA_GH_AS_PERSON) and a target
 * remote is on GitHub. It never falls back to worca's credential, even in `prefer` mode.
 * @returns {Promise<{ok:true}|{ok:false, reason:string}>}
 */
export async function accountCheck({ startedBy, repoUrls = [], env = process.env, personGithubToken: tokenFor = personGithubToken } = {}) {
  if (!asPersonMode(env)) return { ok: true };
  if (!repoUrls.some((url) => forgeOf(parseRemoteUrl(url)) === 'github')) return { ok: true };
  const person = normalizeBillTo(startedBy);
  const who = person && person !== 'local' ? person : null;
  if (!who) {
    return { ok: false, reason: `pull requests on this deployment go out as the person who started the run, and ${startedBy || 'nobody'} is not a signed-in person` };
  }
  try { await tokenFor(who); return { ok: true }; }
  catch (err) {
    return { ok: false, reason: `${who} has no usable GitHub account for pushes (${err?.message || err}). Connect one in Settings › My credentials, then use Create PR.` };
  }
}

let current = null;
export function setPrAutoFinisher(finisher) { current = finisher || null; }
export function prAutoFinisher() { return current; }

const DEFAULTS = {
  readRunPrAuto, setRunPrOutcome, featurePrSetting, setFeaturePrOutcome, logToRun,
  featureOfPipeline, featureView, featureThread, featureRootSource, featureBase, acceptanceRefusal, roundOrigin,
  readPrState, readMemberPrStates, readState: readPipelineStateById, branchExists, commitsAhead, addNotification, withBillTo, accountCheck,
  now: () => new Date().toISOString(),
  pushRemoteUrls: async () => [], live: () => null, changed: () => {}, postNotice: () => {},
};

const urlsOf = (r) => (Array.isArray(r.prs) ? r.prs.filter((p) => p.url && !p.existed).map((p) => p.url) : [r.url]);
const stepOf = (c) => (c && c.step ? ` at git ${c.step}` : '');
const keptBranch = (st) => (st ? [st.branch, ...Object.values(st.branches || {})].find((b) => b && b.commitFailed) : null);

/**
 * @param {object} deps  the server's: openRunPrs(pipelineId, { draft, actor, onDraftFallback }), openMemberPr(pipelineId, {…}),
 *   shipFeatureNow(featureId, 'one', {…}), postNotice(threadId, text), live(pipelineId), changed(kind),
 *   pushRemoteUrls(repoDirs) → Promise<string[]>; any core dep above can be replaced (tests).
 */
export function createPrAutoFinisher(deps = {}) {
  const d = { ...DEFAULTS, ...deps };
  const runsBusy = new Set();
  const featuresBusy = new Set();
  const outcome = (status, final, extra = {}) => ({ status, final, ...extra, at: d.now() });
  // Run-log lines are appended in order, and each entry point waits for them before it settles.
  let logChain = Promise.resolve();
  const say = (pipelineId, level, text) => { if (pipelineId) logChain = logChain.then(() => d.logToRun(pipelineId, level, text)).catch(() => {}); };

  function notifyProblem({ pipelineId = null, projectDir = null, message }) {
    try {
      d.addNotification({ kind: 'pr_auto', severity: 'problem', pipelineId, projectDir, title: NOT_OPENED, message });
      d.changed('notifications-changed');
    } catch { /* a notification is a hint */ }
  }
  /** The feature's thread gets a notice; with no thread (or when `alsoNotify`) a notification says it. */
  function noticeFeature(featureId, text, { pipelineId = null, projectDir = null, alsoNotify = false } = {}) {
    let posted = false;
    try {
      const thread = d.featureThread(featureId);
      if (thread?.threadId) { d.postNotice(thread.threadId, text); posted = true; }
    } catch { /* fall back to a notification */ }
    if (!posted || alsoNotify) notifyProblem({ pipelineId, projectDir, message: text });
  }
  const draftFallbackLogger = (pipelineId) => ({ memberKey, name, error }) => say(pipelineId, 'warn',
    `Draft pull requests are not available for ${name || memberKey || 'this repository'} (${error}): opened it ready for review instead.`);

  /** A recorded outcome: `skipped` and `failed` are logged as "Pull request not opened: …" unless `quiet`. */
  function record(pipelineId, o, { quiet = false } = {}) {
    d.setRunPrOutcome(pipelineId, o);
    if (!quiet && (o.status === 'skipped' || o.status === 'failed')) say(pipelineId, o.status === 'failed' ? 'warn' : 'info', `${NOT_OPENED}: ${o.reason}`);
    return o;
  }

  const repoDirsOf = (st) => (st.target === 'workspace'
    ? workspaceMembers(st).filter((m) => m.workMode !== 'folder' && m.projectDir).map((m) => m.projectDir)
    : [st.projectDir].filter(Boolean));

  /** Steps 6-10 shared by a run and an `each` slice: null when the PR may be opened, else the outcome that stops it. */
  async function gate(st, final) {
    if (st.status !== 'done') return record(st.id, outcome('skipped', false, { reason: `the run ended with status ${st.status}` }));
    const failed = keptBranch(st);
    if (failed) return record(st.id, outcome('skipped', final, { reason: `the run kept uncommitted work (commit failed${stepOf(failed.commitFailed)})` }));
    const had = d.readPrState(st.id);
    const memberPrs = Object.values(d.readMemberPrStates(st.id) || {});
    const live = [had, ...memberPrs].find((p) => p && p.url && p.state !== 'CLOSED');
    if (live) return record(st.id, outcome('skipped', final, { reason: `the run already has one (${live.url})` }));
    if (st.target !== 'workspace') {
      const feature = st.branch?.feature;
      if (!feature || !(await d.branchExists(st.projectDir, feature)) || !((await d.commitsAhead(st.projectDir, st.branch.source, feature)) > 0)) {
        return record(st.id, outcome('skipped', final, { reason: `the run committed no work on ${feature || 'a branch'}` }));
      }
    }
    const account = await d.accountCheck({ startedBy: st.startedBy, repoUrls: await d.pushRemoteUrls(repoDirsOf(st)) });
    if (!account.ok) {
      notifyProblem({ pipelineId: st.id, projectDir: st.projectDir, message: account.reason });
      return record(st.id, outcome('failed', final, { reason: account.reason }));
    }
    return null;
  }

  const openedLine = (draft, url) => `Opened ${draft ? 'a draft pull request' : 'a pull request ready for review'}: ${url}`;

  async function openRun(st, pa) {
    const stopped = await gate(st, true);
    if (stopped) return stopped;
    const wantDraft = pa.open === 'draft';
    const r = await d.withBillTo(st.startedBy, () => d.openRunPrs(st.id, { draft: wantDraft, actor: st.startedBy || 'worca', onDraftFallback: draftFallbackLogger(st.id) }));
    if (r.ok) {
      if (r.existed) return record(st.id, outcome('skipped', true, { reason: `the run already has one (${r.url})` }));
      const draft = !!r.newDraft;
      for (const url of urlsOf(r)) say(st.id, 'info', openedLine(draft, url));
      for (const p of r.prs || []) if (!p.url) say(st.id, 'warn', `${NOT_OPENED} for ${p.name}: ${p.error}`);
      d.changed('pipelines-changed');
      return record(st.id, outcome('opened', true, { urls: urlsOf(r), draft, fellBack: !!r.fellBack }));
    }
    if (r.error === 'the run changed no repository') return record(st.id, outcome('skipped', true, { reason: r.error }));
    notifyProblem({ pipelineId: st.id, projectDir: st.projectDir, message: r.error });
    return record(st.id, outcome('failed', true, { reason: r.error }));
  }

  async function settleSlice(st, { featureId, idx }) {
    const final = st.status === 'done';
    const f = d.featurePrSetting(featureId);
    if (!f || f.open === 'none') return record(st.id, outcome('skipped', final, { reason: `the feature's setting is ${PR_OPEN_LABELS.none}` }), { quiet: true });
    if (f.slices === 'each') {
      const stopped = await gate(st, final);
      if (stopped) return stopped;
      const wantDraft = f.open === 'draft';
      const r = await d.withBillTo(st.startedBy, () => d.openMemberPr(st.id, { actor: st.startedBy || 'worca', draft: wantDraft, onDraftFallback: draftFallbackLogger(st.id) }));
      if (!r.ok) {
        notifyProblem({ pipelineId: st.id, projectDir: st.projectDir, message: r.error });
        return record(st.id, outcome('failed', final, { reason: r.error }));
      }
      if (r.existed || r.pr?.existed) return record(st.id, outcome('skipped', final, { reason: `the run already has one (${r.pr.url})` }));
      const draft = !!r.newDraft;
      say(st.id, 'info', openedLine(draft, r.pr.url));
      d.changed('pipelines-changed');
      return record(st.id, outcome('opened', final, { urls: [r.pr.url], draft, fellBack: !!r.fellBack }));
    }
    const view = d.featureView(featureId, { live: d.live });
    if (view?.ship?.mode) {
      const text = `the feature already shipped as ${view.ship.mode === 'one' ? 'one PR' : 'stacked PRs'}; this run's work is not in it. Create its PR from the run.`;
      if (final) noticeFeature(featureId, `${NOT_OPENED} for run ${idx}: ${text}`, { pipelineId: st.id, projectDir: st.projectDir });
      return record(st.id, outcome('skipped', final, { reason: text }));
    }
    const kept = final ? keptBranch(st) : null;
    if (kept) {
      const reason = `the run kept uncommitted work (commit failed${stepOf(kept.commitFailed)})`;
      record(st.id, outcome('skipped', true, { reason }));
    } else {
      const reason = 'This slice opens no PR of its own: the feature opens one pull request when every slice is done.';
      d.setRunPrOutcome(st.id, outcome('waiting', final, { reason }));
      say(st.id, 'info', reason);
    }
    if (final) await maybeShipOne(featureId, { triggerPipelineId: st.id, triggerState: st });
    return null;
  }

  async function settle(settled) {
    if (!settled?.id || !SETTLED.has(settled.status)) return null;
    const pa = d.readRunPrAuto(settled.id);
    if (!pa || pa.outcome?.final) return null;
    // The settled state, with the starter the row holds when a resumed run's in-memory state has none.
    const st = settled.startedBy ? settled : { ...settled, startedBy: d.readState(settled.id)?.startedBy ?? null };
    if (pa.exempt) {
      const final = st.status === 'done';
      // A Watch PR fix round carries both markers, so it is classified pr-watch: it still releases a feature's one-PR ship.
      if (pa.exempt === 'round' || pa.exempt === 'pr-watch') {
        await maybeShipOne(d.featureOfPipeline(d.roundOrigin(st.id))?.featureId, { triggerPipelineId: st.id });
      }
      return record(st.id, outcome('skipped', final, { reason: prExemptText(pa.exempt) }), { quiet: true });
    }
    const at = d.featureOfPipeline(st.id);
    if (at) return settleSlice(st, at);
    if (pa.open === 'none') return record(st.id, outcome('skipped', true, { reason: `the run's setting is ${PR_OPEN_LABELS.none}` }), { quiet: true });
    return openRun(st, pa);
  }

  async function afterSettled(st) {
    const id = st?.id;
    if (!id || runsBusy.has(id)) return null;
    runsBusy.add(id);
    try { return await settle(st); }
    catch (err) {
      const reason = `the pull request step failed: ${err?.message || err}`;
      try { return record(id, outcome('failed', st.status === 'done', { reason })); } catch { return null; }
    } finally { runsBusy.delete(id); await logChain; }
  }

  async function maybeShipOne(featureId, { triggerPipelineId = null, triggerState = null } = {}) {
    if (!featureId || featuresBusy.has(featureId)) return null;
    featuresBusy.add(featureId);
    try { return await shipOne(featureId, triggerPipelineId, triggerState); }
    catch (err) {
      try { say(triggerPipelineId, 'warn', `${NOT_OPENED}: ${err?.message || err}`); } catch { /* nothing more to do */ }
      return null;
    } finally { featuresBusy.delete(featureId); await logChain; }
  }

  async function shipOne(featureId, triggerPipelineId, triggerState) {
    const f = d.featurePrSetting(featureId);
    if (!f || f.slices !== 'one' || f.open === 'none') return null;
    if (f.outcome && f.outcome.status !== 'held') return null;
    const wasHeld = f.outcome?.status === 'held';
    const view = d.featureView(featureId, { live: d.live });
    if (!view || !view.ship.ready) return null;
    const logTo = triggerPipelineId || view.slices[view.slices.length - 1]?.pipelineId || null;
    const ctx = { pipelineId: logTo, projectDir: f.projectDir };
    const quietSkip = (reason) => { const o = outcome('skipped', true, { reason }); d.setFeaturePrOutcome(featureId, o); return o; };
    const finish = (o, line, { problem = null } = {}) => {
      d.setFeaturePrOutcome(featureId, o);
      say(logTo, o.status === 'opened' ? 'info' : 'warn', line);
      if (problem) noticeFeature(featureId, problem, { ...ctx, alsoNotify: true });
      return o;
    };
    const held = (left) => {
      const text = `The feature's pull request waits for every agreed requirement to be marked (${left} left). It opens when the last one is marked, or ship it from the Ship card.`;
      const o = outcome('held', false, { reason: 'requirements', left });
      d.setFeaturePrOutcome(featureId, o);
      say(logTo, 'info', text);
      if (!wasHeld) noticeFeature(featureId, text, ctx);
      return o;
    };
    const keptRun = view.slices.find((s) => s.pipelineId && keptBranch(s.pipelineId === triggerPipelineId && triggerState ? triggerState : d.readState(s.pipelineId)));
    if (keptRun) {
      const text = `One pull request for "${view.title}" was not opened: run ${keptRun.index} kept uncommitted work, so the last branch does not hold every slice's work. Commit it, then ship the feature from the Ship card.`;
      return finish(outcome('blocked', true, { reason: text }), text, { problem: text });
    }
    const followUp = view.slices.find((s) => s.kind === 'follow-up');
    if (followUp) {
      const text = `One pull request for "${view.title}" was not opened: run ${followUp.index} is a follow-up that starts from ${d.featureBase(featureId) || 'the base branch'}, so the last run's branch does not hold every run's work. Ship the feature from the Ship card.`;
      return finish(outcome('blocked', true, { reason: text }), text, { problem: text });
    }
    const refusal = d.acceptanceRefusal(view);
    if (refusal) return held(refusal.missing?.length ?? 0);
    const starter = f.createdBy;   // the one PR is pushed as the feature's creator, even when the last requirement was marked by another person
    const account = await d.accountCheck({ startedBy: starter, repoUrls: await d.pushRemoteUrls(f.projectDir ? [f.projectDir] : []) });
    if (!account.ok) {
      const text = `${NOT_OPENED} for "${view.title}": ${account.reason}`;
      return finish(outcome('failed', true, { reason: account.reason }), text, { problem: text });
    }
    // A person may have started a round, appended a run or shipped while the account check waited.
    const fresh = d.featureView(featureId, { live: d.live });
    if (fresh?.ship?.mode) return quietSkip('the feature was shipped from the Ship card');
    if (!fresh?.ship?.ready) return null;
    const root = d.featureRootSource(featureId);
    const base = root && root !== d.featureBase(featureId) ? root : null;
    const wantDraft = f.open === 'draft';
    let fellBack = false;
    const r = await d.withBillTo(starter, () => d.shipFeatureNow(featureId, 'one', {
      actor: starter, draft: wantDraft, watch: true, base,
      onDraftFallback: (e) => { fellBack = true; draftFallbackLogger(logTo)({ ...e, name: `"${view.title}"` }); },
    }));
    if (r.status === 200) {
      const url = r.body.prUrl;
      const draft = !!r.body.newDraft;
      return finish(outcome('opened', true, { urls: [url], draft, fellBack }), openedLine(draft, url));
    }
    const code = r.status === 409 ? r.body?.code : null;
    if (code === 'SHIPPING' || code === 'ROUND_LIVE' || code === 'NOT_READY') return null;   // the next settled run retries
    if (code === 'ALREADY_SHIPPED') return quietSkip(r.body.error);
    if (code === 'ACCEPTANCE_INCOMPLETE') return held(r.body.missing?.length ?? 0);
    const reason = r.body?.error || `the pull request could not be opened (HTTP ${r.status})`;
    const text = `${NOT_OPENED} for "${view.title}": ${reason}`;
    return finish(outcome(r.status === 409 ? 'blocked' : 'failed', true, { reason }), text, { problem: text });
  }

  async function onAcceptanceChanged(featureId) {
    try {
      if (d.featurePrSetting(featureId)?.outcome?.status === 'held') await maybeShipOne(featureId);
    } catch { /* the acceptance route's answer never depends on this */ }
  }

  /** A manual ship settles a feature with no final outcome (none yet, or held); the finisher's own ship (busy) writes its own outcome. */
  function onShipped(featureId) {
    try {
      if (featuresBusy.has(featureId)) return;
      const f = d.featurePrSetting(featureId);
      if (!f || f.slices !== 'one' || f.open === 'none' || (f.outcome && f.outcome.status !== 'held')) return;
      d.setFeaturePrOutcome(featureId, outcome('skipped', true, { reason: 'the feature was shipped from the Ship card' }));
    } catch { /* a stale held label is the worst outcome */ }
  }

  return { afterSettled, onAcceptanceChanged, onShipped, maybeShipOne };
}
