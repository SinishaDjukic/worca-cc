// ui/public/shape/outline-body.mjs — the outline ask, the Split step card (spec §3.8, screen 8; D30–D32; shaper-cards
// D1, D8, D9, D11, D14): Chat's live run card, the run page and the feature page. ONE layout with the gate on and off:
// head, a summary, the runs as a compact list with a per-run ⋯ (Merge with next / Remove), Undo edits, the
// Ask-me-before-each-run switch, a folded check line, and Ask for changes / Approve N runs / ⋯ (Fix all, Don't split,
// Stop). Merges and removals are previewed here (applyOutlineEdits) and posted with the approve; the server re-applies
// them (L4). The UI says "run"; the engine, payloads and server error texts keep "slice".
// src/shared is served as is (ui/server.mjs:1556), the same way plan-body.mjs imports it.
import { applyOutlineEdits, checkSlices, outlineFixAllFeedback, settleLeftOut, objectionFeedback } from '../../../src/shared/shape/slices.mjs';
import { CONFIRM_ROLES, CARE_LABELS } from '../../../src/shared/shape/feature-record.mjs';
import { swapOpen, buildCheckFold, buildCheckRows, checkMark, fold } from './check-row.mjs';
import { stepHead, stepSender, splitRefused, SPLIT_APPROVE_TITLE, SPLIT_FIX_TITLE } from './step-card.mjs';
import { findingList } from './role-rows.mjs';
import { buildChatQuestion } from '../chat/question.mjs';
import { toggleMenu } from '../workflows/menu.mjs';
import { icon } from '../icons.mjs';
import { makeSwitch } from '../switch.mjs';
import { flagOn } from '../flags.mjs';

/** "3 runs · v2 · why" — the round only after the first, the why when set. */
export function outlineSummary(outline, round = 1) {
  const n = Array.isArray(outline && outline.slices) ? outline.slices.length : 0;
  const why = String((outline && outline.why) || '').trim();
  return [`${n} ${n === 1 ? 'run' : 'runs'}`, round > 1 ? `v${round}` : '', why].filter(Boolean).join(' · ');
}

/** D11: the primary names how many runs it starts; with fewer than 2 it plans the change as one. */
export const approveRunsLabel = (n) => (n < 2 ? 'Plan it as one' : `Approve ${n} runs`);

/** The outline check as the card shows it: a slice is a run (Don't slice is Don't split). The Planner's feedback keeps
 *  the core wording, so only the drawn rows go through this. */
const runWord = (t) => String(t || '').split(/("[^"]*")/).map((part, i) => (i % 2 ? part   // a quoted title stays as written
  : part.replace(/Don't slice/g, 'Don\'t split').replace(/no slicing/g, 'no split')
    .replace(/\b([Ss])lice(s?)\b/g, (_, s, pl) => `${s === 'S' ? 'R' : 'r'}un${pl}`))).join('');
const runWorded = (c) => ({ ...c, items: c.items.map((it) => ({ ...it, label: runWord(it.label), detail: runWord(it.detail) })) });

export function renderOutlineBody(panel, pq, deps) {
  // Small runs B4: the marked run's Split step; the unmarked body below is unchanged.
  if (pq.plan && pq.plan.smallRuns === true) return renderSplitBody(panel, pq, deps);
  const { doc } = deps;
  const plan = pq.plan || {};
  const asked = plan.outline || { why: '', slices: [] };
  const { h, btn } = makers(doc);
  // A re-ask after a failed feature creation carries the person's edits (plan.edits, L5); start from them if they
  // still apply.
  const carried = Array.isArray(plan.edits) ? plan.edits.filter((e) => e && (e.op === 'merge' || e.op === 'remove') && typeof e.id === 'string') : [];
  let edits = carried.length && applyOutlineEdits(asked, carried).ok ? carried : [];
  panel.appendChild(stepHead(doc, deps.title, deps.chip));
  const body = h('div', 'plan-body plan-card outline-body');
  const err = h('div', 'plan-err'); err.hidden = true; err.setAttribute('role', 'alert');
  const send = stepSender(deps, err);
  const setErrors = errorsSetter(err);

  const summary = h('p', 'plan-summary outline-summary');
  const list = h('ol', 'outline-slices');
  // The agreed ids a person left out (an id no run placed is the check row's, not this line's).
  const leftOut = h('div', 'outline-goal');
  leftOut.dataset.kind = 'left-out';
  // Undo edits: shown only while there are edits. It posts nothing.
  const undo = btn('outline-undo', 'Undo edits');
  // Undo hides itself: the focus moves to the first failing row's action when refused, else to the primary.
  undo.addEventListener('click', (e) => { e.stopPropagation(); edits = []; paint(); if (wasRefused) focusFirstFailing(); else approve.focus(); });
  // D19: off unless chosen; a re-ask keeps the choice
  const { row: each, input: eachBox } = makeSwitch(doc, { label: 'Ask me before each run', checked: plan.approveEach === true, rowClass: 'outline-approve-each' });
  const under = h('div', 'outline-under'); under.append(undo, each);
  const checks = buildCheckFold(doc, runWorded(checkSlices(asked)), 'Outline');
  body.append(summary, list, leftOut, under, checks.line, checks.rows);

  // Ask for changes: closed by default, then Send changes (D30)
  const typed = plan.revisable ? typedRow(doc, send, setErrors) : null;
  if (typed) { typed.row.hidden = true; body.appendChild(typed.row); }

  const approve = btn('btn-primary outline-approve', '');
  approve.addEventListener('click', (e) => {
    e.stopPropagation();
    send({ decision: 'approve', ...(edits.length ? { edits } : {}), approveEach: eachBox.checked });
  });
  const foot = h('div', 'qpanel-foot plan-actions');
  if (typed) foot.appendChild(swapOpen(btn('btn-quiet plan-ask-changes', 'Ask for changes'), typed.row, typed.cancel, () => typed.typed.focus()));
  foot.append(approve, moreButton(doc, { plan, send, confirm: deps.confirm, check: () => checkSlices(currentOutline()) }));
  body.append(err, foot);
  if (plan.error) { err.hidden = false; err.textContent = plan.error; }
  panel.appendChild(body);
  paint();

  function currentOutline() { const r = applyOutlineEdits(asked, edits); return r.ok ? r.outline : asked; }

  function paint() {
    let r = applyOutlineEdits(asked, edits);
    if (!r.ok) {                     // never post an edit the server would refuse: drop it and say why
      setErrors([{ path: 'edits', message: r.error }]);
      edits = edits.slice(0, -1);
      r = applyOutlineEdits(asked, edits);
    }
    const outline = r.ok ? r.outline : asked;
    const n = outline.slices.length;
    list.replaceChildren(...outline.slices.map((s, i) => runItem(s, i, n)));
    const left = (outline.leftOut || []).filter((e) => e.reason);
    leftOut.textContent = left.length ? `Left out: ${left.map((e) => `${e.id} — ${e.reason}`).join('; ')}` : '';
    leftOut.hidden = !left.length;
    summary.textContent = outlineSummary(outline, plan.round || 1);
    checks.update(runWorded(checkSlices(outline)));
    undo.hidden = !edits.length;
    approve.textContent = approveRunsLabel(n);
    panel.dispatchEvent(new doc.defaultView.CustomEvent('step-primary', { bubbles: true }));
  }

  // The number is the existing `.outline-slice-title::before` CSS counter: no second number in the markup.
  function runItem(s, i, n) {
    const li = h('li', 'outline-slice');
    li.dataset.slice = s.id;
    const head = h('div', 'outline-slice-head');
    head.appendChild(h('b', 'outline-slice-title', s.title));
    if (s.estimate) head.appendChild(h('span', 'badge grey outline-est', s.estimate));
    const more = rowMore(doc, i, n, s.id, (op) => { edits = [...edits, { op, id: s.id }]; paint(); });
    if (more) head.appendChild(more);
    li.appendChild(head);
    if (s.goal) li.appendChild(h('div', 'outline-goal', s.goal));
    if (s.requirements && s.requirements.length) {
      const sat = h('div', 'outline-goal', `Satisfies: ${s.requirements.join(', ')}`);
      sat.dataset.kind = 'satisfies';
      li.appendChild(sat);
    }
    return li;
  }

  panel.__plan = { setErrors };
}

/** The element makers both bodies use. */
function makers(doc) {
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (cls, text) => { const b = h('button', `btn btn-sm ${cls}`, text); b.type = 'button'; return b; };
  return { h, btn };
}

/** The Ask for changes field (D30): the changes textarea, then Cancel and Send changes. */
function typedRow(doc, send, setErrors) {
  const { h, btn } = makers(doc);
  const typed = h('textarea', 'plan-feedback');
  typed.rows = 2; typed.placeholder = 'Ask for changes to the runs in your own words…';
  typed.setAttribute('aria-label', 'Changes to the runs');
  const cancel = btn('btn-quiet plan-typed-cancel', 'Cancel');
  const sendBtn = btn('plan-revise', 'Send changes');
  sendBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const text = typed.value.trim();
    if (!text) { setErrors([{ path: 'feedback', message: 'Write what should change first' }]); return; }
    send({ decision: 'revise', feedback: text });
  });
  const acts = h('div', 'plan-typed-acts'); acts.append(cancel, sendBtn);
  const row = h('div', 'plan-typed'); row.append(typed, acts);
  return { row, typed, cancel };
}

/** A run row's ⋯ (Merge with next, Remove), or null when it has neither. `edit(op)` applies one. */
function rowMore(doc, i, n, id, edit) {
  const tools = [
    ...(i + 1 < n ? [{ label: 'Merge with next', onSelect: () => edit('merge') }] : []),
    ...(n > 1 ? [{ label: 'Remove', onSelect: () => edit('remove') }] : []),
  ];
  if (!tools.length) return null;
  const more = makers(doc).btn('btn-quiet btn-icon outline-row-more');
  more.append(icon(doc, 'more', 16));
  more.setAttribute('aria-label', `More for run ${i + 1}`);
  more.setAttribute('aria-haspopup', 'menu');
  more.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu({ doc, anchor: more, align: 'end', label: `More for run ${i + 1}`, items: tools }); });
  return more;
}

/** The foot's ⋯: Fix all (while revisable and a check fails), Don't split (plan it as one), Stop. `check()` is the
 *  current check. */
function moreButton(doc, { plan, send, confirm, check }) {
  const more = makers(doc).btn('btn-quiet btn-icon plan-more');
  more.append(icon(doc, 'more', 16));
  more.setAttribute('aria-label', 'More for these runs');
  more.setAttribute('aria-haspopup', 'menu');
  more.addEventListener('click', (e) => {
    e.stopPropagation();
    const c = check();
    toggleMenu({ doc, anchor: more, align: 'end', label: 'More for these runs', items: [
      ...(plan.revisable && c.items.some((it) => !it.pass) ? [{ label: 'Fix all', onSelect: () => send({ decision: 'revise', feedback: outlineFixAllFeedback(c.items) }) }] : []),
      { label: 'Don\'t split (plan it as one)', onSelect: () => send({ decision: 'flat' }) },
      { label: 'Stop', onSelect: async () => {
        if (await confirm({ title: 'Stop this run', message: 'The outline stays in the run\'s artifacts.', confirmLabel: 'Stop', danger: true })) send({ decision: 'stop' });
      } },
    ] });
  });
  return more;
}

/** The card's setErrors: the messages on the error line; `hide(e)` drops the errors the card already shows. */
function errorsSetter(err, hide = () => false) {
  return (errors) => {
    const shown = (Array.isArray(errors) ? errors : []).filter((e) => !hide(e));
    err.classList.remove('ok');
    err.textContent = shown.map((e) => e.message || e.code || 'invalid').join(' · ');
    err.hidden = !shown.length;
  };
}

export const SPLIT_TOO_MANY_ROUNDS = 'Too many rounds: plan it as one or stop';
export const SPLIT_APPROVABLE_NOW = 'The split can be approved now';
export const NOT_CHALLENGED = 'Not challenged: no review step in this workflow';
const KEEP = 'keep';
const CHANGES = 'changes';
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Slice 11 (D3): the Split row's wait part with the flag on, from the runs a run builds on. */
const splitWaitsWord = (runs) => (!runs.length ? 'waits for no run' : `waits for ${runs.length === 1 ? 'run' : 'runs'} ${runs.join(', ')}`);
const listJoin = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0] || '');

/**
 * Small runs B4: the Split step (prototype #split). One fold row per run (Owns, Starts from, Checked by), the checks
 * fold, one challenge fold, the Care row, then Ask for changes / Approve N runs / ⋯. A split that fails a rule nobody can
 * waive (ownership, coverage, confirmRole) is refused: its failing (rule, id) rows lead the open checks fold, the card and
 * the bar have no primary, and a confirmRole row offers "Ask the role to confirm" (a `confirm` edit). Open objections
 * after the challenge are one decision-pattern question (Keep the split / Ask for changes). Every list draws in the one
 * shared row layout (`.srows`, owner direction d5c0afe48).
 */
function renderSplitBody(panel, pq, deps) {
  const { doc } = deps;
  const plan = pq.plan || {};
  const asked = plan.outline || { why: '', slices: [] };
  const care = plan.care;
  const ch = plan.challenge || { roles: [], challenger: false, rounds: 0, open: 0 };
  const reqs = new Map((Array.isArray(plan.requirements) ? plan.requirements : []).map((r) => [r.id, r]));
  const { h, btn } = makers(doc);
  const carried = Array.isArray(plan.edits) ? plan.edits.filter((e) => e && typeof e.id === 'string' && ['merge', 'remove', 'confirm'].includes(e.op)) : [];
  let edits = carried.length && applyOutlineEdits(asked, carried).ok ? carried : [];
  const head = stepHead(doc, deps.title, deps.chip);
  const title = head.querySelector('.ask-mcard-title');
  panel.appendChild(head);
  const body = h('div', 'plan-body plan-card outline-body split-body srows');
  const err = h('div', 'plan-err'); err.hidden = true; err.setAttribute('role', 'alert');
  const send = stepSender(deps, err);
  // D12: a refusal is already drawn by the failing rows; the server's message is for API callers.
  const setErrors = errorsSetter(err, (e) => e.code === 'split-not-approvable');
  const live = h('div', 'sr-only split-live'); live.setAttribute('aria-live', 'polite');
  // D19: at the refused-round cap the way out is Don't split or Stop (the ⋯); the head says so.
  const capLine = h('p', 'plan-summary split-cap', SPLIT_TOO_MANY_ROUNDS);
  const summary = h('p', 'plan-summary outline-summary');
  const list = h('ol', 'outline-slices split-runs');
  const undo = btn('outline-undo', 'Undo edits');
  // Undo hides itself: the focus moves to the first failing row's action when refused, else to the primary.
  undo.addEventListener('click', (e) => { e.stopPropagation(); edits = []; paint(); if (wasRefused) focusFirstFailing(); else approve.focus(); });
  const under = h('div', 'outline-under'); under.append(undo);
  const checks = buildCheckFold(doc, { items: [] }, 'Outline', { text: checkText, rows: checkRows });
  const challenge = challengeFold();
  const careKv = h('dl', 'rd-kv split-care');
  const careRow = h('div', 'rd-kv-row'); careRow.dataset.fact = 'care';
  careRow.append(h('dt', 'rd-kv-k', 'Care'), h('dd', 'rd-kv-v', `${CARE_LABELS[care] || CARE_LABELS.balanced} · chosen at the start`));
  careKv.appendChild(careRow);
  const question = ch.open > 0 ? objectionsQuestion() : null;
  body.append(capLine, summary, list, under, checks.line, checks.rows, ...challenge, careKv, ...(question ? [question.el] : []));

  const typed = plan.revisable ? typedRow(doc, send, setErrors) : null;
  if (typed) { typed.row.hidden = true; body.appendChild(typed.row); }
  const askChanges = typed ? swapOpen(btn('btn-quiet plan-ask-changes', 'Ask for changes'), typed.row, typed.cancel, () => typed.typed.focus()) : null;
  const approve = btn('btn-primary outline-approve', '');
  approve.title = 'Starts run 1; the rest follow one after another';
  approve.addEventListener('click', (e) => {
    e.stopPropagation();
    if (question && pickOf() === CHANGES) { send({ decision: 'revise', feedback: objectionFeedback(openFindings()) }); return; }
    send({ decision: 'approve', ...(edits.length ? { edits } : {}), ...(ch.open > 0 ? { openObjections: 'kept' } : {}) });
  });
  const foot = h('div', 'qpanel-foot plan-actions');
  if (askChanges) foot.appendChild(askChanges);
  const more = moreButton(doc, { plan, send, confirm: deps.confirm, check: currentCheck });
  foot.append(approve, more);
  body.append(live, err, foot);
  if (plan.error) { err.hidden = false; err.textContent = plan.error; }
  panel.appendChild(body);
  let wasRefused = null;
  paint();
  // A refused split: focus the first failing row's action, else Ask for changes. The host attaches the panel after this
  // render (a fresh open, or the Split arriving live), so the focus is set now when attached and again once it is.
  if (wasRefused) focusOnceShown();

  function applied() { const r = applyOutlineEdits(asked, edits); return r.ok ? r.outline : asked; }
  function currentCheck() { return checkSlices(settleLeftOut(applied()), { smallRuns: true, care }); }
  function pickOf() { return question ? question.list.picks().get('objections') : null; }

  function paint() {
    let r = applyOutlineEdits(asked, edits);
    if (!r.ok) { setErrors([{ path: 'edits', message: r.error }]); edits = edits.slice(0, -1); r = applyOutlineEdits(asked, edits); }
    const outline = r.ok ? r.outline : asked;
    const n = outline.slices.length;
    const refused = splitRefused(outline, care);
    // A repaint keeps the runs a person unfolded and the run control that had the focus (fit-1-3).
    const opened = new Set([...list.querySelectorAll('.outline-run-fold[aria-expanded="true"]')].map((b) => b.closest('li').dataset.slice));
    const active = doc.activeElement && list.contains(doc.activeElement) ? doc.activeElement : null;
    const focusKey = active ? { slice: active.closest('li')?.dataset.slice, more: active.classList.contains('outline-row-more') } : null;
    const at = new Map(outline.slices.map((s, i) => [s.id, i + 1]));
    list.replaceChildren(...outline.slices.map((s, i) => runItem(s, i, n, opened.has(s.id), at)));
    if (focusKey) {
      const li = [...list.children].find((x) => x.dataset.slice === focusKey.slice);
      const target = li && (focusKey.more ? li.querySelector('.outline-row-more') : li.querySelector('.outline-run-fold'));
      if (target) target.focus();
    }
    summary.textContent = `${plural(n, 'run')} proposed, one after another`;
    title.textContent = refused ? SPLIT_FIX_TITLE : SPLIT_APPROVE_TITLE;
    capLine.hidden = !(refused && !plan.revisable);
    checks.update(currentCheck());
    if (refused) { checks.rows.hidden = false; checks.line.setAttribute('aria-expanded', 'true'); }
    undo.hidden = !edits.length;
    // State 2 wins over the question: no primary while refused (card and bar), and no Keep the split to pick. The open
    // objections stay on the card as rows, so the person still sees them before asking for changes.
    if (question) question.list.el.hidden = refused;
    // One way to ask for changes (owner d3ef1cb79 #4): while the question shows, its pick drives the one primary.
    if (askChanges && typed.row.hidden) askChanges.hidden = !!(question && !refused);
    if (refused) { approve.remove(); foot.dataset.noPrimary = ''; }
    else { if (!approve.isConnected) foot.insertBefore(approve, more); delete foot.dataset.noPrimary; }
    approve.textContent = question && pickOf() === CHANGES ? 'Send changes' : approveRunsLabel(n);
    if (wasRefused === true && !refused) live.textContent = SPLIT_APPROVABLE_NOW;
    else if (refused) live.textContent = '';
    wasRefused = refused;
    panel.dispatchEvent(new doc.defaultView.CustomEvent('step-primary', { bubbles: true }));
  }

  /** A refused split opens on the first failing row's action, or on Ask for changes when that row has none. */
  function focusFirstFailing() {
    const first = [...checks.rows.children].find((row) => !row.classList.contains('ok'));
    const target = (first && first.querySelector('button')) || askChanges;
    if (target) target.focus();
  }

  /** The first-failing focus once the card is in the document and nothing else holds the focus; a few frames at most. */
  function focusOnceShown() {
    const free = () => !doc.activeElement || doc.activeElement === doc.body;
    if (body.isConnected && free()) focusFirstFailing();
    const win = doc.defaultView;
    const later = (fn) => (win && win.requestAnimationFrame ? win.requestAnimationFrame(fn) : setTimeout(fn, 16));
    let tries = 10;
    const again = () => {
      if (!wasRefused) return;
      if (body.isConnected && body.checkVisibility?.() !== false) { if (free()) focusFirstFailing(); return; }
      if (--tries > 0) later(again);
    };
    later(again);
  }

  /** After a role pick the picked row is rebuilt (its menu button is gone): the next failing row's action, else the
   *  Approve primary once it is back, else Ask for changes. */
  function focusAfterEdit() {
    const next = [...checks.rows.children].find((row) => !row.classList.contains('ok') && row.querySelector('button'));
    const target = (next && next.querySelector('button')) || (approve.isConnected ? approve : askChanges);
    if (target) target.focus();
  }

  function checkText(c) {
    const failed = checkRows(doc, c).filter((row) => !row.classList.contains('ok')).length;
    if (failed && c.items.some((i) => i.waivable === false && !i.pass)) return `${plural(failed, 'check')} failed`;
    if (c.ok) return `${plural(c.items.length, 'check')} passed`;
    return `${plural(failed, 'check')} failed`;
  }

  /** The failing rows first: one per (rule, id) of a non-waivable rule, then the other failing rules, then the
   *  confirmations picked here ("Security will confirm"), then what passed. */
  function checkRows(d, c) {
    const items = runWorded(c).items;
    const failing = [];
    const passing = [];
    for (const it of items) {
      if (it.pass) { passing.push({ ...it, id: '', detail: '' }); continue; }
      if (Array.isArray(it.failures) && it.failures.length) {
        for (const f of it.failures) failing.push({ id: f.id, label: it.label, pass: false, detail: runWord(f.text),
          ...(it.id === 'confirmRole' ? { action: confirmButton(f.id) } : {}) });
      } else failing.push({ ...it, id: '' });
    }
    const picked = edits.filter((e) => e.op === 'confirm').map((e) => ({ id: e.id, label: `${e.role} will confirm`, pass: true }));
    // The id column only on a row that carries an id (owner d3ef1cb79 #1, owner walk finding 7): id rows keep its fixed
    // width, so their texts line up; a rule row without one puts its label right after the mark.
    const all = [...failing, ...picked, ...passing];
    return buildCheckRows(d, { items: all.map((it) => ({ ...it, idCol: !!it.id })) });
  }

  function confirmButton(id) {
    const b = btn('btn-quiet split-confirm', 'Ask the role to confirm');
    b.setAttribute('aria-haspopup', 'menu');
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu({ doc, anchor: b, align: 'end', label: 'Confirms at Ship', items: CONFIRM_ROLES.map((r) => ({ label: r.label, onSelect: () => {
        edits = [...edits.filter((x) => !(x.op === 'confirm' && x.id === id)), { op: 'confirm', id, role: r.label }];
        paint();
        focusAfterEdit();
      } })) });
    });
    return b;
  }

  /** One fold line for the whole challenge (or one quiet line when none ran): fixed and disputed objections per role,
   *  and one row for the roles that raised none. Open objections are rows above the question (shown when refused too). */
  function challengeFold() {
    if (!(ch.rounds > 0)) return [h('p', 'plan-summary split-not-challenged', NOT_CHALLENGED)];
    const roles = Array.isArray(ch.roles) ? ch.roles : [];
    const settled = (r) => (r.findings || []).filter((f) => f.status === 'fixed' || f.status === 'disputed');
    const changes = roles.reduce((n, r) => n + (r.findings || []).filter((f) => f.status === 'fixed').length, 0);
    const named = roles.filter((r) => r.key !== 'devil').length;
    const by = `Challenged by ${plural(named, 'role')}${ch.challenger ? ' and the Challenger' : ''}`;
    const text = () => (ch.challenger ? `${by} · ${plural(changes, 'change')}` : by);
    const rowsOf = (d) => {
      const out = [];
      for (const r of roles) {
        const done = settled(r);
        if (!done.length) continue;
        const row = buildCheckRows(d, { items: [{ label: `${r.label} · ${plural(done.length, 'objection')}`, pass: true }] })[0];
        // findingList adds a disputed objection's reason itself: the fix stays the row text.
        const fl = findingList(d, done, 'Split');
        fl.hidden = false;
        out.push(row, fl);
      }
      const silent = roles.filter((r) => !(r.findings || []).length).map((r) => r.label);
      if (silent.length) out.push(...buildCheckRows(d, { items: [{ label: `${listJoin(silent)}: no objection`, pass: true }] }));
      return out;
    };
    const f = buildCheckFold(doc, ch, 'Challenge', { text, rows: rowsOf });
    f.line.classList.add('split-challenge-line');
    return [f.line, f.rows];
  }

  function openFindings() {
    return (Array.isArray(ch.roles) ? ch.roles : []).flatMap((r) => (r.findings || []).filter((f) => f.status === 'open').map((f) => ({ ...f, label: r.label })));
  }

  /** D14: the open objections as one question in dev's decision pattern; Worca's pick is Keep the split when the
   *  checks pass. Each objection is its role and one line. After a send-back (round 2 on) they were raised before the
   *  person's changes, and the question says so. */
  function objectionsQuestion() {
    const open = openFindings();
    const recommended = currentCheck().ok || !plan.revisable ? KEEP : CHANGES;
    const wrap = h('div', 'split-objections');
    const heading = (plan.round || 1) > 1
      ? `${plural(ch.open, 'objection')} ${ch.open === 1 ? 'was' : 'were'} raised before your changes`
      : `${plural(ch.open, 'objection')} ${ch.open === 1 ? 'is' : 'are'} still open`;
    const l = buildChatQuestion(doc, {
      id: `split-${pq.id || 'q'}`,
      heading,
      numbers: false,
      questions: [{ id: 'objections', text: heading,
        options: [
          { value: KEEP, label: 'Keep the split', recommended: recommended === KEEP },
          ...(plan.revisable ? [{ value: CHANGES, label: 'Ask for changes', recommended: recommended === CHANGES }] : []),
        ] }],
      preset: new Map([['objections', recommended]]),
      foot: false, head: false,
      submitLabel: () => '',
      onSubmit: () => {},
      onPick: () => paint(),       // a click or a key: the primary follows the pick
    }, { strip: true, register: 'plain' });
    // Each open objection is a shared row (owner d3ef1cb79 #3): ?, the role in the id column, the fix, the state at the end.
    const rows = h('div', 'plan-checks split-objection-rows');
    rows.append(...buildCheckRows(doc, { items: open.map((o) => ({ mark: '?', ariaLabel: 'open objection', id: o.label, idCol: true,
      label: o.fix || o.title || '', pass: true, action: h('span', 'split-objection-state', `${o.severity} · open`) })) }));
    wrap.append(rows, l.el);
    return { el: wrap, list: l };
  }

  /** One fold row per run, in the shared row layout (prototype splitRow): the wait mark, then the fold button (the run's
   *  number in the id column, its title, its R-ids right-aligned, the chevron), the row ⋯ beside (never inside) it;
   *  unfolded, Owns, Starts from and Checked by. */
  function runItem(s, i, n, open, at) {
    const li = h('li', 'outline-slice outline-run');
    li.dataset.slice = s.id;
    const row = h('div', 'outline-slice-head outline-run-row');
    const mark = checkMark(doc, 'wait');
    mark.setAttribute('aria-hidden', 'true');
    const toggle = btn('btn-quiet plan-fold outline-run-fold', null);
    toggle.title = s.title;
    const ids = Array.isArray(s.requirements) ? s.requirements : [];
    toggle.append(h('span', 'plan-check-id outline-run-num', String(i + 1)), h('b', 'plan-check-text outline-slice-title', s.title));
    if (ids.length) toggle.appendChild(h('span', 'outline-run-ids', ids.join(', ')));
    const chev = h('span', 'plan-chev', '›'); chev.setAttribute('aria-hidden', 'true');
    toggle.appendChild(chev);
    row.append(mark, toggle);
    const m = rowMore(doc, i, n, s.id, (op) => { edits = [...edits, { op, id: s.id }]; paint(); });
    if (m) row.appendChild(m);
    const kv = h('dl', 'rd-kv outline-run-facts');
    const fact = (key, label, value) => {
      const r = h('div', 'rd-kv-row'); r.dataset.fact = key;
      const dd = h('dd', 'rd-kv-v');
      if (typeof value === 'string') dd.textContent = value; else dd.appendChild(value);
      r.append(h('dt', 'rd-kv-k', label), dd);
      kv.appendChild(r);
    };
    // Owns: "R-x · text e.g. example", one requirement per line (B3's card, prototype splitRow).
    const owns = h('div', 'outline-owns');
    for (const id of ids) {
      const q = reqs.get(id) || { text: '', example: '' };
      const line = h('div', 'outline-own', `${id} · ${q.text || ''}`.trim());
      if (q.example) line.append(' ', h('span', 'plan-check-detail', `e.g. ${q.example}`));
      owns.appendChild(line);
    }
    fact('owns', 'Owns', owns);
    // Slice 11 (D1, D2): with the flag on, the runs it builds on (`dependsOn` as positions in this outline), ascending.
    const builds = () => [...new Set((Array.isArray(s.dependsOn) ? s.dependsOn : []).map((id) => at.get(id)).filter(Boolean))].sort((a, b) => a - b);
    fact('starts', 'Starts from', i === 0 ? 'the feature branch: it starts first'
      : `the latest finished run · ${flagOn('shaperSmallRuns', doc) ? splitWaitsWord(builds()) : `waits for ${plural(i, 'run')}`}`);
    const roles = [...new Set(ids.map((id) => (reqs.get(id) || {}).role).filter(Boolean))];
    fact('checked', 'Checked by', roles.join(' · ') || '—');
    kv.hidden = true;
    fold(toggle, kv);
    if (open) { kv.hidden = false; toggle.setAttribute('aria-expanded', 'true'); }
    li.append(row, kv);
    return li;
  }

  panel.__plan = { setErrors };
}
