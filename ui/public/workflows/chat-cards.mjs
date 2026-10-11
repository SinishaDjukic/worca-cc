// ui/public/workflows/chat-cards.mjs
// The Workflows chat's cards (D13) and what their buttons do to the OPEN canvas. A canvas edit applies the
// moment it arrives — one undo step, with an inline Undo while it is still the canvas's last step — but only
// in the page session and on the document it was made for. A built workflow waits for "Apply to canvas" and
// opens as a NEW unsaved workflow (after the discard prompt). A drafted agent/script waits for Save. The
// proposal card draws no mini graph: the canvas is the preview.
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const RUNNER_SIDE = { code: 'code — edits the worktree (implementer tool set)', memory: 'memory — edits worca memory only (no Bash)' };

export function createCardController({ doc, composer, sessionId, client, actions = {}, blocks = () => [],
  reducedMotion = () => false, onChange = () => {}, occluder = () => null }) {
  const win = doc.defaultView || globalThis;
  // The undo chord this keyboard has: ⌘Z on a Mac, Ctrl+Z on Windows and Linux (the canvas takes both; the platform
  // check of global-search.mjs shortcutLabel).
  const undoChord = /mac|iphone|ipad|ipod/i.test(String(win.navigator?.userAgentData?.platform || win.navigator?.platform || '')) ? '⌘Z' : 'Ctrl+Z';
  const h = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const act = (name, ...a) => (typeof actions[name] === 'function' ? actions[name](...a) : undefined);
  const handled = new Set();      // card ids this page acted on (frames repeat after a resync)
  let lastEdit = null;            // {cardId, depth, docToken, after}: the newest applied edit, for its Undo
  let lastBuild = null;           // {cardId, docToken, depth, after, prev}: the newest applied build, for its Undo
  let retryQueued = false;        // one gesture-retry timer at a time, however many frames arrive during a drag
  let disposed = false;           // the dock is gone: a queued retry stands down
  const appliedHere = new Set();  // edits on this canvas whose "applied" POST failed: the card says applied anyway
  const flipRetry = new Set();    // …and the one retry of that POST the next sweep makes
  const notAdded = new Map();     // draft card id → why its "Save & add" saved but the canvas refused the add (this page)
  const mine = (card) => Boolean(card) && card.sessionId === sessionId;
  const onDoc = (card) => mine(card) && card.docToken === composer.docToken();
  const snap = () => JSON.stringify(composer.serialize());
  const stateOf = (b) => (b.state === 'proposed' && appliedHere.has(b.id) ? 'applied' : b.state);
  // Depth + document alone are not enough: ⌘Z on the chat edit followed by an edit of the user's own lands on the
  // same depth — the graph must still be exactly what the chat step left, or Undo would revert the user's edit.
  const undoLive = (rec, id) => Boolean(rec) && rec.cardId === id && composer.docToken() === rec.docToken
    && composer.undoDepth() === rec.depth && snap() === rec.after;
  const button = (text, cls, onClick) => {
    const b = h('button', cls || 'wfv-btn', text);
    b.type = 'button';
    // In flight: aria-disabled + a flag, never `disabled` — Chrome moves the focus of a button that turns disabled to
    // <body>, where the canvas owns the keys (the next Backspace deletes the selected card, an arrow nudges it).
    let busy = false;
    b.addEventListener('click', async () => {
      if (b.disabled || busy) return;
      busy = true; b.setAttribute('aria-disabled', 'true');
      try { await onClick(); } finally { busy = false; b.removeAttribute('aria-disabled'); onChange(); }
    });
    return b;
  };
  const flip = (id, body) => client.postCard(id, body);

  /** Apply every new canvas edit of this session, in order. The dock calls it after each flush. */
  async function sweep() {
    if (disposed) return;
    for (const b of blocks()) {
      if (!b || b.kind !== 'card' || !b.card || b.card.type !== 'canvas-edit' || b.state !== 'proposed' || !mine(b.card)) continue;
      if (flipRetry.has(b.id)) { flipRetry.delete(b.id); await flip(b.id, { state: 'applied' }); continue; }
      if (handled.has(b.id)) continue;
      // Never under a live drag, nor while the user types in the More / Params popover: a commit repaints the
      // inspector, which drops the half-typed value and leaves focus on <body> (the next Backspace deletes the card).
      if (composer.gesture() || (typeof composer.inspectorFocused === 'function' && composer.inspectorFocused())) {
        if (!retryQueued) { retryQueued = true; win.setTimeout(() => { retryQueued = false; void sweep(); }, 200); }
        return;
      }
      handled.add(b.id);
      if (!onDoc(b.card)) {
        await flip(b.id, { state: 'failed', error: 'Another workflow was opened before this change arrived — nothing was changed.' });
        continue;
      }
      const r = composer.applyOps(b.card.ops, `chat: ${b.card.summary || 'edit'}`);
      if (!r.ok) { await flip(b.id, { state: 'failed', error: `The canvas changed — ${r.error}` }); continue; }
      lastEdit = { cardId: b.id, depth: r.depth, docToken: composer.docToken(), after: snap() };
      reveal(r.added);
      // The edit IS on the canvas: a failed POST must not leave the card "Applying…" with no Undo. Retry once.
      const f = await flip(b.id, { state: 'applied' });
      if (!f || !f.ok) { appliedHere.add(b.id); flipRetry.add(b.id); }
      onChange();
    }
  }
  /** The dock (`occluder`: its client rect, open panel or collapsed pill) in stage coordinates (`r` = the stage's
   *  rect); a zero rect (hidden) or one outside the stage covers nothing (null). */
  function dockIn(r) {
    const o = occluder();
    const d = o && o.width > 0 && o.height > 0 ? { x0: o.left - (r.left || 0), y0: o.top - (r.top || 0) } : null;
    return d && d.x0 < r.width && d.x0 + o.width > 0 && d.y0 < r.height && d.y0 + o.height > 0 ? { ...d, x1: d.x0 + o.width, y1: d.y0 + o.height } : null;
  }
  /** Every fit the chat makes — a reveal, Apply to canvas, the build's Undo — frames the graph in the band ABOVE the
   *  dock (mockup visRect: "the open chat covers the lower stage: frame the graph above it"): the user watches the
   *  workflow being built, and the canvas is the preview. 16 px clear of the dock; a dock over (nearly) the whole
   *  stage still leaves a 120 px band. A hidden stage (no size) or no dock: the whole stage. */
  function fitAboveDock() {
    const v = composer.view;
    const r = v && typeof v.readRect === 'function' ? v.readRect() : null;
    const dock = r ? dockIn(r) : null;                               // a hidden stage (0 × 0) holds no dock
    composer.fit({ insetBottom: dock ? Math.min(Math.max(0, r.height - dock.y0 + 16), Math.max(0, r.height - 120)) : 0 });
  }
  /** Show what a chat edit added (mockup chat.js: the new card fades in, the view fits a structural edit): an
   *  add_node without x/y lands right of the right-most card (canvas-ops placeFor) — outside a fitted view. The
   *  dock covers the lower middle of the stage while the user watches a turn: a card under it is off screen too. */
  function reveal(ids) {
    const v = composer.view;
    if (!Array.isArray(ids) || !ids.length || !v) return;
    enterAnimation(ids);
    if (typeof v.bounds !== 'function' || typeof v.readRect !== 'function' || typeof v.toScreen !== 'function') return;
    const r = v.readRect();
    const box = v.bounds(0, ids);
    if (!box || !r.width || !r.height) return;                         // a hidden stage: its next entry fits anyway
    const a = v.toScreen(box.x, box.y);
    const z = v.toScreen(box.x + box.w, box.y + box.h);
    const dock = dockIn(r);
    const under = Boolean(dock) && a.x < dock.x1 && z.x > dock.x0 && a.y < dock.y1 && z.y > dock.y0;
    if (!(a.x < 0 || a.y < 0 || z.x > r.width || z.y > r.height || under)) return;
    fitAboveDock();
  }

  // ── canvas edit: one line ─────────────────────────────────────────────────
  function renderEdit(b) {
    const c = b.card;
    const state = stateOf(b);
    const el = h('div', `wfc-edit is-${state}`);
    if (state === 'failed') { el.append(h('span', 'wfc-x', '!'), h('span', 'wfc-sum', `Not applied — ${b.error || 'the canvas changed'}`)); return el; }
    if (state === 'proposed') {
      el.appendChild(h('span', 'wfc-sum', mine(c) ? `Applying: ${c.summary || 'a change'}` : `Not applied — made for an earlier visit: ${c.summary || 'a change'}`));
      return el;
    }
    el.append(h('span', 'wfc-ok', '✓'), h('span', 'wfc-sum', c.summary || 'Canvas changed'));
    if (state === 'undone') { el.appendChild(h('span', 'wfc-muted', 'Undone')); return el; }
    if (c.todo) el.appendChild(h('span', 'wfc-muted', `${plural(c.todo, 'port')} to wire`));
    const undo = button('Undo', 'wfc-link', async () => {
      if (!undoLive(lastEdit, b.id)) return;
      composer.undo();
      lastEdit = null;
      await flip(b.id, { state: 'undone' });
    });
    // ⌘Z reaches only an edit THIS page applied: another tab's or an earlier visit's edit lives on that canvas.
    if (!undoLive(lastEdit, b.id)) { undo.disabled = true; undo.title = mine(c) ? `Use ${undoChord} on the canvas` : 'Applied in another tab or visit — undo it there'; }
    el.appendChild(undo);
    return el;
  }

  // ── built workflow: Apply to canvas ───────────────────────────────────────
  function findDraft(key) {
    let found = null;
    for (const x of blocks()) if (x && x.card && (x.card.type === 'agent-draft' || x.card.type === 'script-draft') && x.card.draft && x.card.draft.key === key) found = x;
    return found;
  }
  // A key the library already holds counts as saved: Edit… saved the draft through its own form (the card never
  // hears of it), or someone made the same key meanwhile. Saving again would only earn the store's 409.
  const inLibrary = (c) => Boolean(c && c.draft && act('libraryHas', c.draft.key, c.type === 'agent-draft' ? 'agent' : 'script'));
  async function saveDraft(b, { add = false } = {}) {
    const c = b.card;
    const r = inLibrary(c) ? { ok: true, key: c.draft.key }
      : c.type === 'agent-draft' ? await act('saveAgentDraft', c.draft) : await act('saveScriptDraft', c.draft);
    if (!r || !r.ok) { act('notify', { tone: 'err', title: 'Not saved', detail: (r && r.error) || 'failed' }); return { ok: false, error: (r && r.error) || 'failed' }; }
    let added = false;
    if (add && c.then && Array.isArray(c.then.ops) && c.then.ops.length && onDoc(c)) {
      await act('reloadRegistry');
      // The reload takes a while (four fetches): a workflow opened meanwhile never takes the draft's ops.
      const a = onDoc(c) ? composer.applyOps(c.then.ops, `chat: add ${(c.draft.meta && c.draft.meta.displayName) || r.key}`)
        : { ok: false, error: 'another workflow was opened meanwhile' };
      added = a.ok;
      if (a.ok) lastEdit = { cardId: b.id, depth: a.depth, docToken: composer.docToken(), after: snap() };
      else notAdded.set(b.id, a.error || 'the canvas refused it');   // saved all the same: the card says why it is not on the canvas
    }
    await flip(b.id, { state: added ? 'added' : 'saved', card: { savedKey: r.key, ...(added ? { added: true } : {}) } });
    return { ok: true, key: r.key, added };
  }
  function enterAnimation(ids = null) {
    if (reducedMotion() || !composer.view || !composer.view.world) return;
    const only = ids ? new Set(ids) : null;
    [...composer.view.world.querySelectorAll('.node')].filter((n) => !only || only.has(n.dataset.nodeId)).forEach((n, i) => {
      n.classList.add('wfc-enter');
      n.style.animationDelay = `${i * 70}ms`;
      win.setTimeout(() => { n.classList.remove('wfc-enter'); n.style.removeProperty('animation-delay'); }, 400 + i * 70);
    });
  }
  async function applyBuild(b) {
    const c = b.card;
    // A referenced draft that was declined (or failed) is in no library: loadDraft would place an unknown key.
    for (const key of c.drafts || []) {
      const d = findDraft(key);
      if (!d || d.state === 'proposed' || d.state === 'saved' || d.state === 'added' || inLibrary(d.card)) continue;
      act('notify', { tone: 'err', title: `Not applied — this workflow needs "${key}", which was ${d.state === 'declined' ? 'declined' : 'not saved'}.` });
      return;
    }
    if (!(await composer.guardDiscard())) return;                 // clarification "build-target": discard prompt first
    for (const key of c.drafts || []) {
      const d = findDraft(key);
      if (!d) { if (act('libraryHas', key)) continue; act('notify', { tone: 'err', title: `The draft "${key}" is no longer in this chat.` }); return; }
      if (d.state === 'proposed') { const s = await saveDraft(d); if (!s.ok) return; }
    }
    if ((c.drafts || []).length) await act('reloadRegistry');
    const prev = { tpl: JSON.parse(JSON.stringify(composer.template())), dirty: composer.isDirty(), origin: composer.origin() };
    composer.loadDraft({ name: c.name, domain: c.domain, nodes: c.workflow.nodes, wires: c.workflow.wires });
    enterAnimation();
    fitAboveDock();
    lastBuild = { cardId: b.id, docToken: composer.docToken(), depth: 0, after: snap(), prev };
    await flip(b.id, { state: 'applied' });
  }
  function renderBuild(b) {
    const c = b.card;
    const el = h('div', `wfc-card wfc-plan is-${b.state}`);
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', 'Proposed workflow');
    if (b.state === 'declined') { el.appendChild(h('p', 'wfc-muted', `Declined — ${c.name}`)); return el; }
    if (b.state === 'failed') { el.appendChild(h('p', 'wfc-err', `Proposal failed: ${b.error || 'failed'}`)); return el; }
    el.appendChild(h('div', 'wfc-card-t', 'Proposed workflow'));
    el.appendChild(h('div', 'wfc-name', c.name || 'Untitled pipeline'));
    if (c.reasoning) el.appendChild(h('p', 'wfc-reason', c.reasoning));
    const titles = new Map((c.workflow.nodes || []).map((n) => [n.id, n.key || n.kind]));
    if ((c.loops || []).length) {
      const ul = h('ul', 'wfc-loops');
      for (const l of c.loops) ul.appendChild(h('li', '', `${titles.get(l.from) || l.from} → ${titles.get(l.to) || l.to} · max ${l.max} cycles`));
      el.appendChild(ul);
    }
    if ((c.drafts || []).length) {
      el.appendChild(h('div', 'wfc-sub', 'New in your library'));
      for (const key of c.drafts) el.appendChild(h('div', 'wfc-new mono', key));
    }
    const n = c.counts || {};
    el.appendChild(h('div', 'wfc-meta mono', `${plural(n.agents || 0, 'agent')} · ${plural(n.scripts || 0, 'script')} · ${plural(n.loops || 0, 'loop')}`));
    if (c.todo) el.appendChild(h('div', 'wfc-muted', `${plural(c.todo, 'port')} still to wire`));
    const row = h('div', 'wfc-actions');
    if (b.state === 'proposed') {
      row.append(button('Decline', 'wfv-btn', () => flip(b.id, { state: 'declined' })), h('span', 'wfc-spacer'),
        button('Apply to canvas', 'wfv-btn wfv-btn-primary', () => applyBuild(b)));
    } else if (b.state === 'applied') {
      row.appendChild(h('span', 'wfc-chip-ok', '✓ Applied to canvas'));
      const undo = button('Undo', 'wfc-link', async () => {
        if (!lastBuild || !undoLive(lastBuild, b.id)) return;
        const p = lastBuild.prev;
        composer.loadTemplate({ ...p.tpl, origin: p.origin });
        if (p.dirty) composer.setName(p.tpl.name || '');          // still unsaved, as it was
        fitAboveDock();
        lastBuild = null;
        await flip(b.id, { state: 'undone' });
      });
      // loadDraft cleared the undo ring, so ⌘Z cannot bring the previous workflow back once this Undo stands down.
      if (!undoLive(lastBuild, b.id)) { undo.disabled = true; undo.title = 'The canvas changed since — the previous workflow can’t be restored'; }
      row.append(undo);
      // Save only the workflow THIS card opened (an applied card from an earlier visit or another document would
      // open the save dialog for whatever canvas is showing now).
      if (lastBuild && lastBuild.cardId === b.id && composer.docToken() === lastBuild.docToken) {
        row.append(h('span', 'wfc-spacer'), button('Save as workflow', 'wfv-btn', () => { composer.openSaveDialog(); }));
      }
    } else {
      row.appendChild(h('span', 'wfc-muted', 'Undone'));
    }
    el.appendChild(row);
    return el;
  }

  // ── drafted agent / script: Save ──────────────────────────────────────────
  function portList(label, list, script) {
    const box = h('div', 'wfc-io');
    box.appendChild(h('div', 'wfc-k', label));
    for (const p of Array.isArray(list) ? list : []) {
      const when = p.when === 'blocking' ? (script ? 'on fail' : 'on blocking') : p.when === 'clean' ? (script ? 'on pass' : 'on clean') : '';
      const bits = [p.id, p.type, p.loop ? 'loop' : '', p.required === false ? 'optional' : '', p.expands ? '⤫N' : '', when].filter(Boolean);
      box.appendChild(h('div', 'wfc-port mono', bits.join(' · ')));
    }
    if (!(Array.isArray(list) && list.length)) box.appendChild(h('div', 'wfc-muted', '—'));
    return box;
  }
  function renderDraft(b) {
    const c = b.card;
    const d = c.draft || {};
    const m = d.meta || {};
    const isAgent = c.type === 'agent-draft';
    const el = h('div', `wfc-card wfc-draft is-${b.state}`);
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', isAgent ? 'New agent' : 'New script');
    const head = h('div', 'wfc-card-t', isAgent ? 'New agent' : 'New script');
    head.appendChild(h('span', 'wfc-chip', b.state === 'saved' || b.state === 'added' ? 'saved' : 'draft'));
    el.appendChild(head);
    const id = h('div', 'wfc-ident');
    id.append(h('span', 'wfc-name', m.displayName || d.key), ...(isAgent ? [] : [h('span', 'wfc-chip mono', m.runtime === 'shell' ? 'Shell' : m.runtime === 'python' ? 'Python' : 'Node.js')]), h('span', 'mono wfc-muted', d.key));
    el.appendChild(id);
    if (m.description) el.appendChild(h('p', 'wfc-reason', m.description));
    if (isAgent) {
      const chips = h('div', 'wfc-chips');
      chips.appendChild(h('span', 'wfc-chip mono', m.runnerType || 'producer'));
      if (m.fanOut) chips.appendChild(h('span', 'wfc-chip', 'Research fan-out'));
      if (m.asksQuestions) chips.appendChild(h('span', 'wfc-chip', 'Asks questions'));
      chips.appendChild(h('span', 'wfc-chip', RUNNER_SIDE[m.sideEffect] || 'none — writes only its output ports'));
      el.appendChild(chips);
    }
    const io = h('div', 'wfc-iogrid');
    io.append(portList('Inputs', m.inputs, !isAgent), portList('Outputs', m.outputs, !isAgent));
    if (!isAgent && Array.isArray(m.params) && m.params.length) io.appendChild(portList('Params', m.params.map((p) => ({ id: p.id, type: p.type })), true));
    el.appendChild(io);
    const det = h('details', 'wfc-src');
    det.appendChild(h('summary', '', isAgent ? 'System prompt' : `Program${Array.isArray(d.cases) && d.cases.length ? ` · ${plural(d.cases.length, 'test case')}` : ''}`));
    det.appendChild(h('pre', 'mono', isAgent ? (d.markdown || '') : (d.source || '')));
    el.appendChild(det);
    const row = h('div', 'wfc-actions');
    const name = m.displayName || d.key;
    if (b.state === 'declined') row.appendChild(h('span', 'wfc-muted', `Declined — ${name}`));
    else if (b.state === 'failed') row.appendChild(h('span', 'wfc-err', b.error || 'failed'));
    else if (b.state === 'added') row.appendChild(h('span', 'wfc-chip-ok', '✓ Saved and added'));
    else if (b.state === 'saved') {
      if (notAdded.has(b.id)) el.appendChild(h('p', 'wfc-err', `Not added to the canvas — ${notAdded.get(b.id)}`));   // above the actions row
      row.appendChild(h('span', 'wfc-chip-ok', `✓ Saved to your ${isAgent ? 'agents' : 'scripts'}`));
      if (c.then && Array.isArray(c.then.ops) && c.then.ops.length && onDoc(c)) {
        row.append(h('span', 'wfc-spacer'), button('Add to canvas', 'wfv-btn', async () => {
          await act('reloadRegistry');
          if (!onDoc(c)) { act('notify', { tone: 'err', title: 'Not added — another workflow was opened meanwhile.' }); return; }
          const a = composer.applyOps(c.then.ops, `chat: add ${name}`);
          if (!a.ok) { act('notify', { tone: 'err', title: 'Not added', detail: a.error }); return; }
          lastEdit = { cardId: b.id, depth: a.depth, docToken: composer.docToken(), after: snap() };
          await flip(b.id, { state: 'added', card: { added: true } });
        }));
      }
    } else {
      row.append(
        button('Edit…', 'wfv-btn', () => act(isAgent ? 'openAgentDraft' : 'openScriptDraft', d)),
        button('Decline', 'wfv-btn', () => flip(b.id, { state: 'declined' })),
        h('span', 'wfc-spacer'),
        button(isAgent ? 'Save agent' : 'Save script', 'wfv-btn', () => saveDraft(b)),
      );
      if (c.then && Array.isArray(c.then.ops) && c.then.ops.length && onDoc(c)) row.appendChild(button('Save & add to canvas', 'wfv-btn wfv-btn-primary', () => saveDraft(b, { add: true })));
    }
    el.appendChild(row);
    return el;
  }

  return {
    sweep,
    /** Everything a card's DOM depends on: the dock reuses the element while this is unchanged (no rebuild under the pointer). */
    sig: (b) => JSON.stringify([b.id, stateOf(b), b.error || null, b.card || null, mine(b.card), onDoc(b.card), undoLive(lastEdit, b.id),
      Boolean(lastBuild && lastBuild.cardId === b.id && composer.docToken() === lastBuild.docToken), undoLive(lastBuild, b.id)]),
    render(b) {
      const t = b && b.card && b.card.type;
      const el = t === 'canvas-edit' ? renderEdit(b) : t === 'workflow-build' ? renderBuild(b) : renderDraft(b);
      el.dataset.cardId = b.id;
      return el;
    },
    /** Drafts this chat still holds unsaved: they ride every message so build_workflow and the drafts' own `then` can use them (edit_canvas refuses an unsaved draft — D4) (D11). */
    pendingDrafts() {
      const out = new Map();
      for (const x of blocks()) {
        if (!x || !x.card || x.state !== 'proposed' || (x.card.type !== 'agent-draft' && x.card.type !== 'script-draft') || !x.card.draft) continue;
        if (inLibrary(x.card)) continue;                              // saved through Edit…: the tools see the real one
        out.set(x.card.draft.key, { kind: x.card.type === 'agent-draft' ? 'agent' : 'script', key: x.card.draft.key, meta: x.card.draft.meta || {} });
      }
      return [...out.values()].slice(-8);
    },
    /** Why a saved draft's add was refused in this page ('' = it was not): the dock's live region says it. */
    notAdded: (id) => notAdded.get(id) || '',
    reset() { handled.clear(); appliedHere.clear(); flipRetry.clear(); lastEdit = null; lastBuild = null; },
    /** The dock is gone: a sweep queued behind a drag or a focused popover field stands down. */
    dispose() { disposed = true; },
  };
}
