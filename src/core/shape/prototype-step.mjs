// src/core/shape/prototype-step.mjs — Shaper small runs C1, the Prototype step: one loop with its effects injected
// (like runSplitChallenge), held inside the Requirements approval. The state lives in `rec.prototype` (persisted as
// `shape_stats.prototype` by every `persist`), so a resumed run starts again from it. Nothing here reads the flag,
// spawns or touches Design: the orchestrator passes those in.
import {
  normalizePrototype, prototypeOffer, prototypeReviewRounds, screenRequirements, screensOfPlan, skipLine, REMARK_MAX,
} from '../../shared/shape/prototype.mjs';
import { PROTOTYPE_CONFIRMED, prototypeBuiltText, remarkUpdatedText } from '../../shared/shape/feature-log.mjs';

export const PROTOTYPE_ASK_KIND = 'prototype';
export const REGISTRY_MISSING = 'Design builds are not available';
const DECISIONS = Object.freeze({
  offered: ['build', 'skip'], built: ['confirm', 'remark'], remark: ['change', 'keep'], failed: ['build', 'skip'],
});
const FINDINGS_MAX = 20;
const TEXT_MAX = 300;

const refuse = (code, message) => ({ ok: false, errors: [{ code, message }] });

/** D15: a `prototype` ask's answer for its moment; `stop` is the step's ⋯ Stop at any moment. */
export function validatePrototypeAnswer(raw, moment) {
  const allowed = DECISIONS[moment];
  const d = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw.decision : undefined;
  if (d === 'stop') return { ok: true, payload: { decision: 'stop' } };
  if (!allowed || !allowed.includes(d)) return refuse('bad-decision', `Answer ${allowed ? allowed.join(' or ') : 'nothing'} here.`);
  if (d === 'remark') {
    const r = typeof raw.remark === 'string' ? raw.remark.trim() : '';
    if (!r || r.length > REMARK_MAX) return refuse('bad-remark', `A remark is 1 to ${REMARK_MAX} characters.`);
    return { ok: true, payload: { decision: 'remark', remark: r } };
  }
  return { ok: true, payload: { decision: d } };
}

const clip = (t) => String(t).slice(0, TEXT_MAX);
const asFindings = (texts) => texts.slice(0, FINDINGS_MAX).map((text) => ({ role: 'design', text: clip(text), objection: false }));

/** R-arch-6: what a build that is not usable says: the screens that did not build, or its end. */
export function buildFindings(end, screens = []) {
  const all = Array.isArray(end?.sections) ? end.sections : [];
  if (!all.length) return ['0 screens built: Design\'s lead planned no screen'];
  const named = new Map(screensOfPlan(all).map((s) => [s.section, s.name]));
  const bad = all.filter((s) => s.status !== 'done');
  if (!bad.length) return [`The build ended ${end?.status || 'early'}${end?.reason ? ` (${end.reason})` : ''}`];
  const known = new Map((Array.isArray(screens) ? screens : []).map((s) => [s.section, s.name]));
  return [`${all.length - bad.length} of ${all.length} screens built: ${bad.map((s) => known.get(s.id) || named.get(s.id) || s.id).join(', ')} failed`];
}

const usable = (end) => !!end && end.status === 'done' && !end.reason && Array.isArray(end.sections) && end.sections.length > 0
  && end.sections.every((s) => s.status === 'done');

/**
 * The step loop.
 * @param {{rec: object, position: string, agreed: Array<{id: string, text: string}>, designOn: boolean, registry: boolean,
 *   ask: (moment: string, view: object) => Promise<object>,
 *   build: (a: {keep: (designId: string) => Promise<void>}) => Promise<{designId?: string, buildId: string, round: number} | {refused: string}>,
 *   change: (a: {instruction: string, sections: string[], needsLead: boolean}) => Promise<{buildId: string, round: number} | {refused: string}>,
 *   awaitBuild: (buildId: string) => Promise<{status: string, reason: string|null, sections: object[], costUsd: number, version: number|null}>,
 *   review: (round: number, prior: object[]) => Promise<Array<{role, text, objection, sections}>>,
 *   matchRemark: (remark: string) => Promise<{id, text, example, was} | null>,
 *   rewrite: (id: string, p: {text: string, example: string}) => Promise<boolean>,
 *   freeze: (a: {shownVersion: number|null, screens: object[]}) => Promise<{dir, version, digest?} | {stale: number|null}>,
 *   persist: () => Promise<void>, audit: (text: string) => Promise<void>, now?: () => Date}} a
 * @returns {Promise<{state: 'confirmed'|'skipped'|'stopped'}>}
 */
export async function runPrototypeStep({ rec, position, agreed, designOn, registry, ask, build, change, awaitBuild, review,
  matchRemark, rewrite, freeze, persist, audit = async () => {}, now = () => new Date() }) {
  const stamp = () => now().toISOString();
  let p = normalizePrototype(rec.prototype);
  const save = async (fields, { at = true } = {}) => {
    p = { ...p, ...fields, ...(at ? { at: stamp() } : {}) };
    for (const [k, v] of Object.entries(fields)) if (v === undefined) delete p[k];
    rec.prototype = p;
    await persist();
  };
  const skip = async (cause) => {
    await save({ state: 'skipped', cause });
    await audit(`${skipLine(cause)}.`);
    return { state: 'skipped' };
  };
  if (p && (p.state === 'confirmed' || p.state === 'skipped')) return { state: p.state };
  const screens = screenRequirements(agreed);
  if (!p) {
    p = { v: 1, state: 'offered', screenIds: screens.map((s) => s.id), round: 0, screens: [], costUsd: 0, findings: [],
      reviewRounds: 0, remarks: 0, rebuilt: false, at: stamp() };
    // D4: no screen requirement first, then Design off or no registry; each skips with its line and no ask.
    if (!screens.length) return skip('no-screens');
    if (!registry) await audit(`${REGISTRY_MISSING}.`);
    if (!designOn || !registry) return skip('design-off');
    await save({});
  }
  const offer = prototypeOffer({ position, screens: Math.max(1, p.screenIds.length), designOn: true }).offer;
  let failures = 0;
  let remarkError = null;
  let shown = null;
  const view = (extra = {}) => ({
    state: p.state, offer, position, requirements: screens.filter((s) => p.screenIds.includes(s.id)),
    screens: p.screens, screenIds: p.screenIds, costUsd: p.costUsd, findings: p.findings, reviewRounds: p.reviewRounds,
    remarks: p.remarks, rebuilt: p.rebuilt, ...(p.designId ? { designId: p.designId } : {}), ...(p.buildId ? { buildId: p.buildId } : {}),
    ...((shown ?? p.version) !== undefined ? { version: shown ?? p.version } : {}), ...(p.remark ? { remark: p.remark } : {}),
    attempt: failures, ...extra,
  });

  const fail = async (texts) => { failures += 1; await save({ state: 'failed', findings: asFindings(texts) }); };

  /** Starts a round; false (and the failed state) when Design refused it. */
  const start = async (kind, args) => {
    // `keep` saves a design the moment it is made, so a replayed round reuses it instead of making a second one.
    const keep = async (designId) => { if (designId && designId !== p.designId) await save({ designId }, { at: false }); };
    const s = kind === 'first' ? await build({ keep }) : await change(args);
    if (!s || s.refused) { await fail([s?.refused || 'Design did not start the build']); return false; }
    await save({ state: 'building', buildId: s.buildId, round: p.round + 1, ...(s.designId ? { designId: s.designId } : {}) });
    return true;
  };

  /** Awaits the recorded build; restarts an interrupted or unknown one (D16, invariant 6). true when usable. */
  const settle = async () => {
    let end = await awaitBuild(p.buildId);
    if (end.status === 'interrupted' || end.status === 'missing') {
      // The interrupted round's spend stays counted; start's save persists it with the new round.
      if (Number(end.costUsd) > 0) p = { ...p, costUsd: Math.round((p.costUsd + Number(end.costUsd)) * 1e4) / 1e4 };
      const left = (end.sections || []).filter((s) => s.status !== 'done').map((s) => s.id);
      const ok = (end.sections || []).length
        ? await start('change', { instruction: 'Finish the screens the last round left unbuilt.', sections: left, needsLead: !left.length })
        : await start('first');
      if (!ok) return false;
      end = await awaitBuild(p.buildId);
    }
    const cost = Math.round((p.costUsd + (Number(end.costUsd) || 0)) * 1e4) / 1e4;
    if (!usable(end)) { p = { ...p, costUsd: cost }; await fail(buildFindings(end, p.screens)); return false; }
    const parsed = screensOfPlan(end.sections);
    // One save: the cost is added once, and the state leaves `building`, so a resume never awaits (or adds) it again.
    await save({ state: 'built', costUsd: cost, version: end.version ?? p.version, screens: parsed.length >= p.screens.length ? parsed : p.screens });
    shown = null;
    return true;
  };

  /** D9: Thorough's review rounds, from round `from`; each objection gets one change round on its sections. */
  const reviewRounds = async (from) => {
    const max = prototypeReviewRounds();
    let prior = [];
    for (let r = from; r <= max; r += 1) {
      await save({ state: 'reviewing', reviewRounds: r });
      const found = await review(r, prior);
      await save({ findings: found.slice(0, FINDINGS_MAX).map((f) => ({ role: f.role, text: clip(f.text), objection: f.objection === true })) });
      const objections = found.filter((f) => f.objection === true);
      if (!objections.length || r === max) break;
      const known = new Set(p.screens.map((s) => s.section));
      const sections = [...new Set(objections.flatMap((f) => f.sections || []).filter((id) => known.has(id)))];
      if (!await start('change', { instruction: objections.map((f) => `${f.role === 'product' ? 'Product' : 'Design'}: ${f.text}`).join('\n'), sections, needsLead: !sections.length })) return false;
      if (!await settle()) return false;
      prior = objections;
    }
    return true;
  };

  /** After a usable build: the review (Thorough, never after a remark's rebuild), then the built state. */
  const builtNow = async (from = p.reviewRounds + 1) => {
    if (offer.review && !p.rebuilt && from <= prototypeReviewRounds() && !await reviewRounds(from)) return;
    await save({ state: 'built' });
    await audit(`${prototypeBuiltText(p.screens.length, p.costUsd, p.rebuilt)}.`);
  };

  const buildFrom = async (kind, args) => {
    if (!await start(kind, args)) return;
    if (await settle()) await builtNow();
  };

  // Resume: a recorded build is awaited, never started twice; a review round runs again.
  if (p.state === 'building' && p.buildId) { if (await settle()) await builtNow(); }
  else if (p.state === 'building') await buildFrom('first');
  else if (p.state === 'reviewing') {
    // The reviewed build already settled (its cost is counted): wait for it, then run the open round again.
    const end = p.buildId ? await awaitBuild(p.buildId) : null;
    if (usable(end)) await builtNow(p.reviewRounds);
    else await fail(buildFindings(end, p.screens));
  }

  for (;;) {
    if (p.state === 'offered') {
      const a = await ask('offered', view());
      if (a.decision === 'stop') return { state: 'stopped' };
      if (a.decision === 'skip') return skip(position === 'lean' ? 'lean' : 'person');
      await buildFrom('first');
      continue;
    }
    if (p.state === 'failed') {
      const a = await ask('failed', view());
      if (a.decision === 'stop') return { state: 'stopped' };
      if (a.decision === 'skip') return skip('person');
      // A fresh first build: its review starts again at round 1, as an unreviewed (not a remark's) build.
      await save({ findings: [], reviewRounds: 0, rebuilt: false });
      await buildFrom('first');
      continue;
    }
    if (p.state === 'matching') {
      // A pause while matching: the stored remark is matched again.
      const said = p.remark?.text || '';
      const prior = { ...p, state: 'built' };
      delete prior.remark;
      await matchThen(said, prior);
      continue;
    }
    if (p.state === 'remark') {
      const a = await ask('remark', view());
      if (a.decision === 'stop') return { state: 'stopped' };
      const { id, proposed, text: said } = p.remark;
      if (a.decision === 'keep') { await save({ state: 'built', remark: undefined }); continue; }
      if (!await rewrite(id, { text: proposed.text, example: proposed.example })) {
        await audit(`Remark not applied: ${id} could not be rewritten with a valid example; the requirement is kept.`);
        await save({ state: 'built', remark: undefined });
        continue;
      }
      await audit(`${remarkUpdatedText(said, id)}.`);
      const sections = p.screens.filter((s) => s.ids.includes(id)).map((s) => s.section);
      await save({ remarks: p.remarks + 1, rebuilt: true });
      await buildFrom('change', { instruction: `${id} now reads: ${proposed.text}\nExample: ${proposed.example}\nChange the screens to match it.`,
        sections, needsLead: !sections.length });
      continue;
    }
    // built
    const a = await ask('built', view(remarkError ? { remarkError: remarkError.error, remarkText: remarkError.text } : {}));
    remarkError = null;
    if (a.decision === 'stop') return { state: 'stopped' };
    if (a.decision === 'remark') {
      const prior = p;
      await save({ state: 'matching', remark: { text: a.remark } });
      await matchThen(a.remark, prior);
      continue;
    }
    let r;
    try {
      r = await freeze({ shownVersion: shown ?? p.version ?? null, screens: p.screens });
    } catch (err) {
      if (err?.code !== 'no-dist' && err?.code !== 'no-freeze') throw err;
      await fail([err.message]);
      continue;
    }
    if (r && 'stale' in r) { shown = r.stale; continue; }
    await save({ state: 'confirmed', ref: { dir: r.dir, version: r.version, designId: p.designId, ...(r.digest ? { digest: r.digest } : {}) }, version: r.version, remark: undefined });
    await audit(`${PROTOTYPE_CONFIRMED}.`);
    return { state: 'confirmed' };
  }

  /** D10: no match puts back the prior record exactly (its `at` too); a match raises the proposal. */
  async function matchThen(said, prior) {
    const proposal = await matchRemark(said);
    if (!proposal) {
      p = prior;
      rec.prototype = prior;
      await persist();
      remarkError = { error: 'no-match', text: said };
      return;
    }
    await save({ state: 'remark', remark: { text: said, id: proposal.id, proposed: { text: proposal.text, example: proposal.example, was: proposal.was || '' } } });
  }
}
