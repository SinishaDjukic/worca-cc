// ui/public/shape/feature-view.mjs — the feature card (spec §3.8, screen 9): progress, each slice's state and PR, and
// Review plan / Resume / Re-plan the rest / Cancel the rest. One view for slice 1's Chat run card and the Plans tab (L11).
export const SLICE_STATE_LABELS = Object.freeze({
  planned: 'Planned', starting: 'Starting', shaping: 'Planning', questions: 'Waiting for your answers', approval: 'Waiting for your plan approval',
  running: 'Building', paused: 'Paused', done: 'Done', stopped: 'Stopped', error: 'Stopped with an error',
  failed: 'Could not start', missed: 'Waiting', canceled: 'Canceled',
});

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

const NEEDS = new Set(['approval', 'questions']);
// The slice in flight on the feature page: sliceState's live states.
const CURRENT = new Set(['approval', 'questions', 'running', 'shaping', 'starting', 'paused']);

/** The Chat card's one line (board 9). */
export function featureSummaryLine(f) {
  const s = f.status === 'active' ? f.slices.find((x) => NEEDS.has(x.state)) : null;
  return `Shaper · ${s ? `Slice ${s.index} needs you` : featureHeadline(f)}`;
}

/** One part per slice, tinted by its state (style.css: .shape-feature-seg[data-state]). */
function segBar(h, f) {
  const bar = h('div', 'shape-feature-segs');
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', featureHeadline(f));
  for (const s of f.slices) { const seg = h('span', 'shape-feature-seg'); seg.dataset.state = s.state; bar.appendChild(seg); }
  return bar;
}

/** D16, P13: the Chat run card's summary: one line, the segmented bar and Open feature. deps: { openFeature(id) } */
export function renderFeatureSummary(doc, f, deps) {
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const needs = f.status === 'active' && f.slices.some((x) => NEEDS.has(x.state));
  const el = h('section', `shape-feature-sum${needs ? ' is-needs' : ''}${f.halted ? ' is-halted' : ''}`);
  el.dataset.feature = f.id;
  el.append(h('div', 'shape-feature-sum-line', featureSummaryLine(f)), segBar(h, f));
  const open = h('button', 'btn shape-feature-sum-open', 'Open feature'); open.type = 'button'; open.dataset.act = 'shape-feature-sum-open';
  open.addEventListener('click', () => deps.openFeature(f.id));
  el.appendChild(open);
  return el;
}

/** "merge first" on the earliest open PR, "merge after slice K" on later open ones (D16, D22). */
function mergeTags(slices) {
  const open = slices.filter((s) => s.pr && s.pr.url && s.pr.state !== 'MERGED' && s.pr.state !== 'CLOSED');
  return new Map(open.map((s, i) => [s.index, i === 0 ? 'merge first' : `merge after slice ${open[i - 1].index}`]));
}

/** deps: { act(action, body, {focus}) → Promise<{ok, error?}>, openSlice(slice), openRun(ref), confirm, error?: string }
 *  The feature page (D16) adds { page: true, progressOf(slice), paintProgress(bar, prog), mountAsk(slot, slice) }. */
export function renderFeature(doc, f, deps) {
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  // data-act names each control, so the host can give the focus back after a repaint (a rebuild drops it). Per-slice
  // controls carry the slice index, so the focus returns to the same slice's button.
  const btn = (cls, text, act = cls.split(' ').pop()) => { const b = h('button', `btn ${cls}`, text); b.type = 'button'; b.dataset.act = act; return b; };
  const el = h('section', `shape-feature${f.halted ? ' is-halted' : ''}${deps.page ? ' is-page' : ''}`);
  el.dataset.feature = f.id;
  el.appendChild(h('div', 'shape-feature-title', f.title));
  // F47: the host asked for an earlier feature; this is the one its Re-plan the rest started.
  if (f.replanOf) el.appendChild(h('div', 'shape-feature-replanned', 'Re-planned: the slices below replace the earlier outline'));
  el.appendChild(h('div', 'shape-feature-head', featureHeadline(f)));
  if (deps.page) el.appendChild(segBar(h, f));
  else {
    const bar = h('div', 'shape-feature-bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', String(f.total)); bar.setAttribute('aria-valuenow', String(f.done));
    bar.appendChild(h('span', 'shape-feature-fill')).style.width = `${f.total ? Math.round((f.done / f.total) * 100) : 0}%`;
    el.appendChild(bar);
  }
  const tags = deps.page ? mergeTags(f.slices) : null;
  const ol = h('ol', 'shape-feature-slices');
  for (const s of f.slices) {
    const li = h('li', `shape-feature-slice is-${s.state}`);
    li.append(h('span', 'shape-feature-slice-title', `${s.index} · ${s.title}`), h('span', 'shape-feature-slice-state', SLICE_STATE_LABELS[s.state] || s.state));
    if (s.state === 'approval' || s.state === 'questions') {
      const rv = btn('shape-feature-review', s.state === 'approval' ? 'Review plan' : 'Answer', `shape-feature-review-${s.index}`);
      rv.addEventListener('click', () => deps.openSlice(s));
      li.appendChild(rv);
    } else if (s.pipelineId || s.runId) {
      const open = btn('shape-feature-open', 'Open', `shape-feature-open-${s.index}`);
      open.addEventListener('click', () => deps.openSlice(s));
      li.appendChild(open);
    }
    if (s.pr && s.pr.url) {
      const a = h('a', 'shape-feature-pr', `${s.pr.number ? `PR #${s.pr.number}` : 'PR'}${deps.page && s.pr.draft ? ' · draft' : ''}`);
      a.href = s.pr.url; a.target = '_blank'; a.rel = 'noopener';
      li.appendChild(a);
      if (tags && tags.has(s.index)) li.appendChild(h('span', 'shape-feature-merge', tags.get(s.index)));
    }
    ol.appendChild(li);
  }
  el.appendChild(ol);

  // A re-planned feature links to the Re-plan the rest run (its outline ask waits there for a person).
  if ((f.status === 'replanning' || f.status === 'replanned') && f.replan && (f.replan.runId || f.replan.pipelineId)) {
    const open = btn('shape-feature-replan-open', 'Open the re-plan');
    open.addEventListener('click', () => deps.openRun(f.replan));
    el.appendChild(open);
  }

  // The host repaints the whole view after an action and on WS frames, so a failure's text comes back in deps.error
  // (kept by the host until the next action) instead of living only in this element.
  const err = h('div', 'shape-feature-err', deps.error || null); err.hidden = !deps.error; err.setAttribute('role', 'alert');
  // F39: name the control BEFORE disabling it. In Chromium a disabled button loses the focus at once, so the host
  // cannot read it from document.activeElement after the action. act() awaits the repaint, so the old (disabled)
  // button is replaced before anything is re-enabled: no second post from a double click.
  const run = async (action, body, b) => {
    const focus = b.dataset.act;
    b.disabled = true; err.hidden = true;
    const r = await deps.act(action, body, { focus }).catch(() => ({ ok: false }));
    if (!r || !r.ok) { err.textContent = (r && r.error) || 'That did not work. Try again.'; err.hidden = false; }
    if (b.isConnected) b.disabled = false;
  };
  if (deps.page) {
    const cur = f.slices.find((s) => CURRENT.has(s.state));
    if (cur) {
      const box = h('div', 'shape-feature-current');
      box.dataset.slice = String(cur.index);
      box.appendChild(h('div', 'shape-feature-current-title', `Slice ${cur.index} · ${cur.title}`));
      const prog = deps.progressOf ? deps.progressOf(cur) : null;
      const bar = h('div', 'run-prog shape-feature-current-bar');
      const text = h('div', 'shape-feature-current-text', prog ? prog.text : '');
      bar.hidden = !prog; text.hidden = !prog;
      if (prog && deps.paintProgress) deps.paintProgress(bar, prog);
      box.append(bar, text);
      el.appendChild(box);
      if (NEEDS.has(cur.state) && deps.mountAsk) {
        // A slot only: the host swaps in its persistent ask element (P12), so a repaint never wipes a typed answer.
        const slot = h('div', 'shape-feature-ask');
        box.appendChild(slot);
        deps.mountAsk(slot, cur);
      }
    }
    if (f.slices.length > 1) el.appendChild(h('div', 'shape-feature-order', 'Merge in order: each slice\'s branch starts from the one before.'));
    if (f.ship && f.ship.mode) {
      const done = h('div', 'shape-feature-shipped', f.ship.mode === 'one' ? 'Shipped as one PR' : 'Shipped as stacked PRs');
      if (f.ship.prUrl) { const a = h('a', null, ' · open it'); a.href = f.ship.prUrl; a.target = '_blank'; a.rel = 'noopener'; done.appendChild(a); }
      el.appendChild(done);
    } else if (f.ship && f.ship.ready) {
      const box = h('div', 'shape-feature-ship');
      box.appendChild(h('div', 'shape-feature-ship-head', 'Ship as'));
      for (const [mode, label] of [['stacked', 'Stacked PRs'], ['one', 'One PR']]) {
        const b = btn(`shape-feature-ship-${mode}${f.ship.suggested === mode ? ' btn-primary' : ''}`,
          f.ship.suggested === mode ? `${label} (suggested)` : label, `shape-feature-ship-${mode}`);
        b.addEventListener('click', () => run('ship', { mode }, b));
        box.appendChild(b);
      }
      if (f.ship.suggested) {
        box.appendChild(h('div', 'shape-feature-ship-why', f.ship.suggested === 'one'
          ? `This feature adds ${f.ship.linesAdded} lines: one PR is easier to review.`
          : `This feature adds ${f.ship.linesAdded} lines: stacked PRs keep each review small.`));
      }
      el.appendChild(box);
    }
    if (f.status !== 'active') el.appendChild(err);
  }
  if (f.status === 'active') {
    const foot = h('div', 'shape-feature-actions');
    if (f.halted) {
      const res = btn('btn-primary shape-feature-resume', `Resume slice ${f.halted.index}`);
      res.addEventListener('click', () => run('resume', null, res));
      foot.appendChild(res);
    }
    if (f.open || f.halted) {
      const rp = btn('shape-feature-replan', 'Re-plan the rest');
      rp.addEventListener('click', async () => {
        if (await deps.confirm({ title: 'Re-plan the rest', message: 'The waiting slices are canceled and Worca plans what is left from the last finished slice.', confirmLabel: 'Re-plan' })) run('replan', null, rp);
      });
      const cx = btn('shape-feature-cancel', 'Cancel the rest');
      cx.addEventListener('click', async () => {
        if (await deps.confirm({ title: 'Cancel the rest', message: 'The slices that have not started are canceled. A running slice keeps running.', confirmLabel: 'Cancel the rest', danger: true })) run('cancel', null, cx);
      });
      foot.append(rp, cx);
    }
    const lab = h('label', 'shape-feature-approve-each');
    const box = h('input'); box.type = 'checkbox'; box.checked = f.approveEach; box.dataset.act = 'shape-feature-approve-each';
    box.addEventListener('change', () => run('approve-each', { on: box.checked }, box));
    lab.append(box, doc.createTextNode(' Approve each slice\'s plan'));
    foot.appendChild(lab);
    el.append(foot, err);
  }
  return el;
}
