// ui/public/shape/feature-view.mjs — Shaper s3: the feature's head-less view for the Plans tab and the group page's
// Overview tab. The run model (run-status-card.mjs) owns the head, status line, bars and members on the group page;
// this view adds the re-planned note, the open step (deps.mountAsk), the step log, the Ship card (s4) and the controls
// (feature-actions.mjs). featureHeadline stays for the Plans row's summary line.
import { featureCardModel, paintFeatureLog } from './feature-card.mjs';
import { paintFeatureActions } from './feature-actions.mjs';
import { renderShipCard, saveAcceptance, confirmRequirement } from './ship-card.mjs';
import { buildRequirementRoleFolds } from './role-rows.mjs';
import { reasonLine } from '../../../src/shared/shape/ship-ledger.mjs';
import { CONFIRM_ROLES, roleOfPerspective, perspectiveOfRole } from '../../../src/shared/shape/feature-record.mjs';
import { criterionPerspective } from '../../../src/shared/shape/requirements.mjs';

const range = (xs) => (xs.length === 1 ? `slice ${xs[0]}` : `slices ${xs[0]}–${xs[xs.length - 1]}`);

export function featureHeadline(f) {
  if (f.status === 'canceled') return `Canceled · ${f.done} of ${f.total} slices done`;
  if (f.status === 'replanned' || f.status === 'replanning') return 'Re-planned';
  if (f.status === 'done') return `All ${f.total} slices done`;
  if (f.halted) {
    const word = f.halted.state === 'paused' ? 'paused' : f.halted.state === 'failed' ? 'could not start'
      : f.halted.state === 'missed' || f.halted.state === 'canceled' ? 'did not start' : 'stopped';
    return `Slice ${f.halted.index} ${word}${f.halted.waiting.length ? ` · ${range(f.halted.waiting)} waiting` : ''}`;
  }
  return `${f.done} of ${f.total} slices done`;
}

/** Run 4 (D18): the feature's card model, also for the group page's header ⋯. */
export const featureModelOf = (f, snapOf) => featureCardModel({ card: { pipelineId: f.originPipelineId || null, feature: f, log: f.log || [] }, snapOf: snapOf || (() => null) });

/** s4: the Ship card (ship-card.mjs) in place of the old Ship as block: the waiting line while runs go on, the ready
 *  card without Not now, the applied card once shipped; nothing for a canceled or re-planned feature. */
function shipBlock(doc, f) {
  const s = f.ship || {};
  const phase = s.mode ? 'applied' : s.ready ? 'ready' : f.status === 'active' ? 'waiting' : null;
  if (!phase) return doc.createDocumentFragment();
  // One ship flow: the ready card's Create PR opens the shared dialog (setShipDialogOpener); nothing is posted here.
  // Shaper requirements s3: the ledger's marks save through the one helper the chat card uses (R-arch-7).
  // Feature D1 (D14): a marked feature's Ship is the small-runs card, the one card's ship step's; Mark confirmed posts
  // through the one helper both use.
  const sr = s.smallRuns && phase !== 'waiting' ? s.smallRuns : null;
  const card = renderShipCard(doc, { phase, featureId: f.id, title: f.title, runs: f.total, files: s.files, added: s.linesAdded,
    deleted: s.linesRemoved, suggested: s.suggested, result: s.result || null, ...(s.acceptance ? { acceptance: s.acceptance } : {}),
    ...(sr ? { smallRuns: sr, shipMode: s.mode || null } : {}) },
  sr ? { onConfirm: (id, mark, reason) => confirmRequirement(f.id, id, mark, reason) } : s.acceptance ? { onMark: (entries) => saveAcceptance(f.id, entries) } : {});
  card.dataset.needsGit = '';   // shipping opens pull requests: hidden while git is missing (git-gate.mjs)
  return card;
}

/** Feature page slice 6 (D13): a mark is open while the feature is ready to ship, not shipped, and a confirmed
 *  requirement still waits for its mark or for a reason. The page bar then offers Mark and ship. */
export function markOpen(f) {
  const s = f && f.ship;
  if (!s || !s.smallRuns || !s.ready || s.mode) return false;
  return (s.smallRuns.confirmed || []).some((e) => e && (e.state === 'waiting' || e.state === 'needs-reason'));
}

/**
 * deps: { act(action, body, {focus}) → Promise<{ok, error?}>, confirm, openRun(ref), openPlan(controls), snapOf?(pid),
 *         pause?(target, btn), stop?(target), mountAsk?(slot, step), runsOpen?: boolean, error?: string,
 *         omit?: string[] (feature-actions keys the host's model footer already shows), inGroup?: boolean (the group page:
 *         no merge-order line and no ⋯, the page header owns both), shipFirst?: boolean (slice 6: the Ship card first, no
 *         step log or merge-order line: the feature page's Requirements tab) }
 */
export function renderFeature(doc, f, deps) {
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const m = featureModelOf(f, deps.snapOf);
  const el = h('section', `shape-feature${m.controls && m.controls.halted ? ' is-halted' : ''}`);
  el.dataset.feature = f.id;
  // F47: the host asked for an earlier feature; this is the one its Re-plan the rest started.
  if (f.replanOf) el.appendChild(h('div', 'shape-feature-replanned', 'Re-planned: the runs below replace the earlier outline'));
  // A slot only: the host swaps in its persistent ask element (P12), so a repaint never wipes a typed answer.
  if (m.step && deps.mountAsk) { const slot = h('div', 'shape-feature-ask'); el.appendChild(slot); deps.mountAsk(slot, m.step); }
  // Feature page slice 6 (D4): the Requirements tab shows the Ship card first; the step log lives on the Log tab, and
  // the Runs tab states the merge order.
  if (deps.shipFirst) el.prepend(shipBlock(doc, f));
  else {
    const log = h('ol', 'chat-rc-log shape-feature-log'); log.setAttribute('aria-label', 'Steps');
    el.appendChild(log);
    paintFeatureLog(doc, log, m.log);
    // Run 4 (D17): the group page states the merge order on its Runs tab and owns the ⋯ in its header.
    if (f.slices.length > 1 && !deps.inGroup) {
      const order = h('div', 'shape-feature-order', 'Merge in order: each run\'s branch starts from the one before.');
      order.dataset.needsGit = '';
      el.appendChild(order);
    }
    el.appendChild(shipBlock(doc, f));
  }
  const foot = h('div', 'shape-feature-actions');
  el.appendChild(foot);
  paintFeatureActions(doc, foot, m.controls, deps, { omit: deps.omit || [], menu: !deps.inGroup });
  return el;
}

// ---- Shaper small runs D3: the feature page's Requirements and Decisions (ui/public/group-page.mjs tabs) ----

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const pad2 = (n) => String(n).padStart(2, '0');
const clockOf = (at) => { const d = at ? new Date(at) : null; return d && !Number.isNaN(d.getTime()) ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : ''; };
/** A row's mark name for screen readers: the state alone, since the note already says the word. */
const MARK_NAMES = Object.freeze({ check: 'met', live: 'in progress', wait: 'waiting', '?': 'needs you', paused: 'paused', x: 'not met', none: 'dropped' });
const RELEASE = Object.freeze({ key: 'release', label: 'Release' });

/** The ship ledger's entries in agreed order (`f.requirementKinds`), each with its role key (a confirmed one's own role,
 *  an owned one's by its id prefix; none is Release). Only entries the server gave a status (`shown`). */
function ledgerEntries(f) {
  const sr = f.ship.smallRuns;
  const byId = new Map([...(sr.owned || []).map((e) => [e.id, { e, owned: true }]), ...(sr.confirmed || []).map((e) => [e.id, { e, owned: false }])]);
  const order = Array.isArray(f.requirementKinds) && f.requirementKinds.length ? f.requirementKinds.map((k) => k.id) : [...byId.keys()];
  return order.map((id) => byId.get(id)).filter((x) => x && x.e.shown).map(({ e, owned }) => ({ e, owned,
    role: owned ? roleOfPerspective(criterionPerspective(e.id, { smallRuns: true })) || RELEASE.key : e.role }));
}

/**
 * The Requirements tab (owner direction db793abc0): the caption, then one role fold per role (role-rows.mjs
 * buildRequirementRoleFolds, the Requirements step's) in CONFIRM_ROLES order, each with its count and how many are met,
 * not met, dropped or open. A role whose requirements are all met starts closed, any other open. Each row: the state mark, the id, the
 * text on one line, the server's status `shown.text` (`run N` a link to that run's page when `runHref(N)` names one).
 * Null without a small-runs ledger. No listeners on the rows: a repaint (group-page.mjs keepUnchanged) may replace them.
 */
export function renderFeatureRequirements(doc, f, { runHref = () => null } = {}) {
  if (!f || !f.ship || !f.ship.smallRuns) return null;
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const all = ledgerEntries(f);
  const box = h('div', 'plan-body srows shape-feature-reqs');
  const byPerson = all.filter((x) => !x.owned).length;
  const byNone = all.filter((x) => x.owned && x.e.status === 'unowned').length;
  box.appendChild(h('p', 'cap shape-feature-reqs-cap', all.length
    ? `${plural(all.length, 'requirement')} · ${all.length - byPerson - byNone} owned by a run · ${byPerson} confirmed by a person${byNone ? ` · ${byNone} owned by no run` : ''}` : '0 requirements'));
  if (!all.length) return box;
  const roles = [...CONFIRM_ROLES, RELEASE];
  const groups = roles.map((role) => ({ role, rows: all.filter((x) => x.role === role.key) })).filter((g) => g.rows.length).map(({ role, rows }) => {
    const met = rows.filter((x) => x.e.shown.mark === 'check').length;
    // Decided, not open: read from the ledger entry (`shown.mark` x also marks a missing reason and an accepted gap).
    const decided = (mark) => rows.filter((x) => x.e.state === 'confirmed' && x.e.mark === mark).length;
    const notMet = decided('not-met');
    const dropped = decided('dropped');
    const open = rows.length - met - notMet - dropped;
    const part = (n, word) => (n ? ` · ${n} ${word}` : '');
    return { key: role.key, perspective: role.key === RELEASE.key ? null : perspectiveOfRole(role.key), label: role.label, lead: false,
      summary: `${rows.length} · ${met} met${part(notMet, 'not met')}${part(dropped, 'dropped')}${part(open, 'open')}`,
      state: met === rows.length ? 'clean' : 'open', mark: 'wait', markWord: 'not all met', findings: [],
      rows: rows.map(({ e, owned }) => {
        const label = reasonLine(e.text);
        const at = clockOf(e.at);
        const href = owned && Number.isInteger(e.run) ? runHref(e.run) : null;
        return { id: e.id, idCol: true, label, pass: e.shown.mark === 'check', mark: e.shown.mark, ariaLabel: e.shown.word === 'gap accepted' ? 'gap accepted' : MARK_NAMES[e.shown.mark] || 'waiting',
          tip: `${e.id} · ${label} · ${e.shown.text}${at ? ` · ${at}` : ''}`, data: { key: e.id, owner: e.shown.owner, role: e.shown.role || null },
          ...(href ? { note: e.shown.word, noteLead: { text: e.shown.owner, href } } : { note: e.shown.text }) };
      }) };
  });
  const { el } = buildRequirementRoleFolds(doc, groups);
  box.appendChild(el);
  return box;
}

/**
 * The Decisions tab of a small-runs feature: the Care row first, exactly once (`ship.smallRuns.care.line`, in place of
 * the log's own Care line), then every decision log line (`f.log`), each a .srows row (paintFeatureLog `srows`).
 * Paints nothing without a small-runs ledger.
 */
export function paintFeatureDecisions(doc, host, f) {
  const sr = f && f.ship && f.ship.smallRuns;
  if (!sr) return;
  host.classList.add('plan-body', 'srows', 'shape-feature-decisions');
  let list = host.querySelector(':scope > ul.plan-checks');
  if (!list) { list = doc.createElement('ul'); list.className = 'plan-checks'; host.replaceChildren(list); }
  const lines = [{ key: 'care', run: null, text: sr.care.line, detail: [] },
    ...(Array.isArray(f.log) ? f.log : []).filter((l) => l && l.key !== 'care')].map((l) => ({ ...l, text: reasonLine(l.text) }));
  paintFeatureLog(doc, list, lines, { srows: true });
  const care = list.querySelector(':scope > li[data-key="care"]');
  if (care) care.dataset.fact = 'care';
}
