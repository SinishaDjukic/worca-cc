// ui/public/graph/retune-popover.mjs
// The live-run node retune popover: one model + effort select pair anchored to a
// graph card, POSTing /api/retune.
//
// Factory + injected deps (test/helpers/ask-panel-harness.mjs) so a jsdom suite
// drives it without booting app.js.
//
// Positioning is JS-MEASURED, not CSS-anchored like .ask-pop: .gv-world carries
// the pan/zoom transform and .run-flow-wrap.gv-wrap-monitor clips its overflow,
// so a panel inside the world would scale and clip. It is fixed-positioned on
// document.body off the card's getBoundingClientRect().
//
// Markup reuses the inspector's field skin: the panel carries `ins-panel` so the
// existing `.ins-panel .ins-select` rules apply unchanged, and the field builders
// are IMPORTED from inspector.mjs rather than re-declared.

import { h, field as insField, offeredModels, fillOptions } from './inspector.mjs';
import { armFor, retuneArm } from '../../../src/shared/graph/retune-gate.mjs';

const GAP = 8;

/** One labelled select, on the inspector's shared field shape. */
function field(doc, cls, name, label) {
  const wrap = insField(doc, cls, label);
  const sel = h(doc, 'select', 'ins-select');
  sel.dataset.field = name;
  sel.setAttribute('aria-label', label);
  // Through `.ins-select-wrap`, the same shell inspector.mjs builds: the chevron
  // is a token-coloured ::after on the WRAPPER, so a select appended straight to
  // the field would sit in this panel without one.
  const shell = h(doc, 'span', 'ins-select-wrap');
  shell.appendChild(sel);
  wrap.appendChild(shell);
  return { wrap, sel };
}

/**
 * Fill the model + effort pair from a selection. Effort is filtered to the
 * SELECTED model's own `efforts` — which levels are valid is a property of the
 * model — and the control SAYS so when no model is picked rather than just
 * greying out.
 *
 * The hidden-built-in exemption is `offeredModels` (inspector.mjs), shared with
 * the composer's own picker. `keepId` is that exemption's id, and it is
 * deliberately SEPARATE from `sel.model`: the change handler repaints with the
 * LIVE value, so filtering on the selection would drop a hidden stored pick the
 * moment the user tried something else and leave them unable to go back without
 * reopening. It defaults to `sel.model` for the first paint, where the two are
 * the same thing.
 *
 * An id that is not in the catalog AT ALL is listed anyway, flagged. Without
 * that, assigning it to `select.value` with no matching <option> silently forces
 * the value to '' — the control would present the node as "inherit" when it is
 * not, and Apply would post the empty string and WIPE a live override the server
 * cannot distinguish from a deliberate clear. It happens for real: a custom or
 * plugin model deleted mid-run, and the boot race where the graph paints before
 * /api/config has resolved and `models` is still empty.
 */
function paintPair(doc, modelSel, effortSel, models, sel, keepId = sel.model) {
  // Never silently drop a value that is about to be assigned: an assignment with
  // no matching <option> coerces select.value to '', so the control would present
  // the node as "inherit" when it is not, and Apply would post the empty string
  // and WIPE a live override the server cannot tell from a deliberate clear.
  //
  // The test is what is actually OFFERED, not what is in the catalog. Those
  // differ: `offeredModels` drops `hidden` entries unless they match `keepId`, so
  // a model that IS in the catalog can still be missing from the list — flip "hide
  // built-in models" while a popover sits open on a built-in and the id is
  // catalog-known, unlisted, and silently wiped.
  const items = [{ value: '', text: 'inherit (run default)' },
    ...offeredModels(models, keepId).map((m) => ({ value: m.id, text: m.label || m.id }))];
  for (const id of [sel.model, keepId]) {
    if (!id || items.some((i) => i.value === id)) continue;
    const m = models.find((x) => x && x.id === id);
    items.push({ value: id, text: m ? `${m.label || id} (hidden)` : `${id} (not in this catalog)` });
  }
  fillOptions(doc, modelSel, items, sel.model || '');

  const model = models.find((m) => m && m.id === modelSel.value) || null;
  const efforts = model && Array.isArray(model.efforts) ? model.efforts : [];
  // A model IS picked, it just cannot be resolved — its level list is unknown, not
  // empty. The placeholder must not say "pick a model first" next to a model
  // select that plainly has one picked; the control would contradict itself.
  const unresolved = !!modelSel.value && !model;
  const levels = [{ value: '',
    text: unresolved ? 'default effort (levels unknown)' : (model ? 'default effort' : 'pick a model first') },
  ...efforts.map((e) => ({ value: e, text: e }))];
  // Exactly the model select's rule, and UNCONDITIONAL for the same reason. It is
  // not only the unresolved-model case: edit a model in Settings and drop a level
  // from its subset, and a RESOLVABLE model no longer advertises the level the node
  // is actually set to — the panel would read "default effort" for a node on `max`
  // and Apply would post the clear.
  if (sel.effort && !efforts.includes(sel.effort)) {
    levels.push({ value: sel.effort, text: model ? `${sel.effort} (no longer offered)` : sel.effort });
  }
  fillOptions(doc, effortSel, levels, sel.effort || '');
  // Disabled only when there is nothing to DO with it. A node can legitimately
  // carry an effort with no model (buildGraphManifest fills the two
  // independently), and the engine refuses that pair — so greying the control out
  // while its stored value sits selected leaves the user with an Apply that always
  // 400s and no way to reach '' and clear it.
  effortSel.disabled = !model && !unresolved && !sel.effort;
  effortSel.title = !model && !unresolved
    ? (sel.effort
      ? 'This effort has no model behind it — pick one, or clear the effort back to default.'
      : 'Pick a model first — the effort levels on offer are that model’s own.')
    : '';
}

/**
 * @param {{doc:Document, fetchFn?:Function, onApplied?:(applied:object)=>void,
 *          onError?:(message:string)=>void}} deps
 * @returns {{open:Function, close:Function, isOpen:()=>boolean}}
 */
export function createRetunePopover({ doc, fetchFn = null, onApplied = null, onError = null,
  onClose = null, raf = null, caf = null } = {}) {
  const win = doc.defaultView || globalThis;
  const doFetch = fetchFn || ((...a) => win.fetch(...a));
  // Injected so a jsdom suite can drive the follow loop. `new JSDOM(...)` without
  // `pretendToBeVisual` defines no requestAnimationFrame, so the real one is
  // absent in every test here and startFollow would return on its first line.
  const nextFrame = raf || (typeof win.requestAnimationFrame === 'function' ? (fn) => win.requestAnimationFrame(fn) : null);
  const cancelFrame = caf || (typeof win.cancelAnimationFrame === 'function' ? (id) => win.cancelAnimationFrame(id) : null);
  let panel = null;
  let anchor = null;
  // Bumped by every open() and close(). An in-flight Apply captures it and does
  // nothing when it comes back stale — see the Apply handler.
  let generation = 0;
  let followId = 0;
  let followKey = '';
  // The open panel's live select pair + the node it was opened for. Kept so the
  // catalog can be swapped under an OPEN popover — see refresh(). null on the
  // note-only arms, which have nothing to repaint.
  let pair = null;
  // Which of renderBody's three arms is on screen ('flow' | 'busy' | 'edit').
  let arm = '';
  // open()'s arguments, kept because renderBody can be re-run later (syncNode)
  // when the node's eligibility changes under a panel that is already up.
  let openRunId = '';
  let openModels = [];

  function close({ restoreFocus = false } = {}) {
    if (!panel) return;
    generation++;
    stopFollow();
    // Restore focus ONLY when the close was keyboard-driven, or when focus is
    // still inside the panel about to be removed (leaving it on a detached node
    // would drop focus to <body>). An outside CLICK must not: focus() scrolls
    // every scrollable ancestor into view, and `.run-flow-wrap.gv-wrap-monitor`
    // is overflow:hidden — programmatically scrollable, with no scrollbar for the
    // user to undo it — so a stray click on the Pause button or the Ask composer
    // would yank the page and leave the graph permanently offset in its clip box.
    const focusBack = restoreFocus || (panel.contains(doc.activeElement));
    panel.remove();
    panel = null;
    pair = null;
    // The card advertises itself as a dialog trigger (view.mjs#buildCard); only
    // this module knows when the dialog is actually up.
    if (anchor && anchor.getAttribute && anchor.getAttribute('aria-expanded') !== null) {
      anchor.setAttribute('aria-expanded', 'false');
    }
    if (focusBack && anchor) {
      try { anchor.focus({ preventScroll: true }); } catch { /* jsdom / detached */ }
    }
    anchor = null;
    arm = '';
    openRunId = '';
    openModels = [];
    doc.removeEventListener('keydown', onKeydown, true);
    doc.removeEventListener('pointerdown', onPointerdown, true);
    // The app holds a reference to the run this popover was opened for so its
    // callbacks can reach it; without this it would pin a whole run model —
    // logLines, steps, subAgents, stepper — alive after the run is evicted.
    if (onClose) onClose();
  }

  function onKeydown(e) {
    if (e.key === 'Escape' && panel) { e.preventDefault(); e.stopPropagation(); close({ restoreFocus: true }); }
  }

  function onPointerdown(e) {
    const t = e.target;
    if (!panel || !t || typeof t.closest !== 'function') return;
    if (panel.contains(t) || (anchor && anchor.contains(t))) return;
    close();
  }

  /**
   * Keep the panel glued to its card for as long as it is open.
   *
   * place() alone runs once, and the card moves for four different reasons the
   * panel cannot see: the detail body scrolls, the window resizes, and the
   * monitor host wheel-pans and ctrl/cmd-zooms `.gv-world` — the last two are a
   * CSS transform, which fires no scroll event at all. Polling the anchor's rect
   * per frame is the one measurement that catches all four. It only runs while
   * the popover is open, and repositions only when the rect actually moved.
   */
  function startFollow() {
    if (!nextFrame) return;
    followKey = '';
    const step = () => {
      followId = 0;
      if (!panel || !anchor) return;
      // The card can be replaced outright by a structural repaint; a detached
      // anchor has nothing to point at any more.
      if (anchor.isConnected === false) { close(); return; }
      const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
      const key = r ? `${Math.round(r.left)}:${Math.round(r.top)}:${Math.round(r.bottom)}` : '';
      if (key !== followKey) { followKey = key; place(anchor); }
      followId = nextFrame(step);
    };
    followId = nextFrame(step);
  }

  function stopFollow() {
    if (followId && cancelFrame) cancelFrame(followId);
    followId = 0;
    followKey = '';
  }

  /** Clamp into the viewport; flip above when the panel would run off the bottom. */
  function place(cardEl) {
    const r = cardEl.getBoundingClientRect ? cardEl.getBoundingClientRect() : { left: 0, top: 0, bottom: 0, width: 0 };
    const vw = win.innerWidth || 0;
    const vh = win.innerHeight || 0;
    // MEASURED, not a constant mirroring `.rt-pop{width}` in style.css: the panel
    // is already on the document by the time place() runs, so its real width is
    // there for the asking and cannot drift out of step with the stylesheet.
    const box = panel.getBoundingClientRect ? panel.getBoundingClientRect() : { width: 0, height: 0 };
    const pw = box.width || panel.offsetWidth || 0;
    let left = r.left;
    // No hard-coded fallback: a constant here would be a second copy of
    // `.rt-pop{width}` that the stylesheet could silently drift away from. A DOM
    // with no layout measures 0, and a 0-width clamp is a harmless no-op.
    if (vw && pw && left + pw > vw - 12) left = Math.max(12, vw - pw - 12);
    let top = r.bottom + GAP;
    if (vh && top + box.height > vh - 12 && r.top - box.height - GAP > 0) top = r.top - box.height - GAP;
    panel.style.left = `${Math.max(12, left)}px`;
    panel.style.top = `${Math.max(12, top)}px`;
  }

  /**
   * Build the panel's body for the node AS IT IS NOW, from the arm retune-gate.mjs
   * derived. A finished run, a flow card and a busy node each get a note that
   * explains itself; an idle agent on a live run gets the editable pair.
   *
   * Separate from open() because the arm is not fixed for the panel's lifetime:
   * a node that was mid-execution when the user clicked settles seconds later,
   * and a panel left as a dead note until they close and reopen it is the
   * opposite of "explain the refusal". syncNode() re-runs this when the arm
   * changes. `pair` is the editable arm's live handles, and null on the notes —
   * which is exactly how refresh()/syncNode() tell them apart.
   */
  function renderBody({ runId, node, models, arm: want, myGen }) {
    for (const el of [...panel.children]) if (!el.classList.contains('ins-head')) el.remove();
    pair = null;
    arm = want;
    if (arm === 'dead') {
      panel.appendChild(h(doc, 'div', 'rt-note',
        'This run has finished — nothing will dispatch again, so there is no next execution to retune.'));
    } else if (arm === 'flow') {
      panel.appendChild(h(doc, 'div', 'rt-note', 'Flow cards spawn nothing — there is no model to change.'));
    } else if (arm === 'busy') {
      panel.appendChild(h(doc, 'div', 'rt-note', 'This node has an execution in flight. Its model is fixed until that execution settles.'));
    } else {
      const body = h(doc, 'div', 'ins-body-in');
      const m = field(doc, 'ins-model', 'model', 'Model');
      const e = field(doc, 'ins-effort', 'effort', 'Effort');
      body.append(m.wrap, e.wrap);
      // Both of these appear WITHOUT the user acting, and the amber one is the only
      // signal that Apply is about to clobber someone else's retune — so they are
      // live regions, not decorated divs. `role=status` for the warning (polite:
      // it lands while they are reading), `role=alert` for a failed Apply, which is
      // a direct response to what they just did. `.rd-banners` uses the same idiom.
      const stale = h(doc, 'div', 'rt-stale');
      stale.setAttribute('role', 'status');
      stale.hidden = true;
      const err = h(doc, 'div', 'rt-err');
      err.setAttribute('role', 'alert');
      err.hidden = true;
      const apply = h(doc, 'button', 'btn btn-primary rt-apply', 'Apply');
      apply.type = 'button';
      body.append(stale, err, apply);
      panel.appendChild(body);
      panel.appendChild(h(doc, 'div', 'rt-note',
        'Takes effect on this node’s next execution. This run only — the workflow default is unchanged.'));

      pair = { m: m.sel, e: e.sel, node, models, stale, dirty: false, elsewhere: false };
      paintPair(doc, m.sel, e.sel, models, { model: node.model || '', effort: node.effort || '' });
      // A new model invalidates the old effort (the list is filtered by it), so
      // repaint the pair the moment the model changes.
      // `pair.node.model`, not the closure's open-time `node.model`: syncNode may
      // have adopted a newer cell since, and the hidden-model exemption has to
      // keep the value the node is ACTUALLY set to selectable — otherwise a user
      // who tries another model cannot get back to it without reopening.
      m.sel.addEventListener('change', () => {
        pair.dirty = true;
        paintPair(doc, pair.m, pair.e, pair.models, { model: pair.m.value, effort: '' }, pair.node.model || '');
        restale();
      });
      e.sel.addEventListener('change', () => { pair.dirty = true; restale(); });

      apply.addEventListener('click', async () => {
        apply.disabled = true;
        err.hidden = true;
        // Everything after the await is guarded on the generation this handler
        // was built in. A response can land after the user pressed Escape or
        // opened another card's popover; without the guard a 200 would call
        // close() and tear down the NEW popover mid-edit, and a 400 would write
        // its message onto detached nodes and log "retune failed" for a panel
        // the user already dismissed.
        const live = () => generation === myGen;
        try {
          const res = await doFetch('/api/retune', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ runId, nodeId: node.id, model: m.sel.value, effort: e.sel.value }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            if (!live()) return;
            apply.disabled = false;
            err.textContent = String(data.error || res.status);
            err.hidden = false;
            if (onError) onError(err.textContent);
            return;
          }
          // The apply SUCCEEDED, so the caller is told either way — the run was
          // retuned whether or not this panel is still on screen.
          if (onApplied) onApplied(data);
          // ...but a change that did not reach the database is live in the server
          // process only and reverts on resume. Keep the panel up and say so
          // rather than closing on a success the user cannot rely on.
          if (data && data.persisted === false) {
            if (!live()) return;
            apply.disabled = false;
            err.textContent = 'Applied to the running process, but it could not be saved — a resume will revert it.';
            err.hidden = false;
            if (onError) onError(err.textContent);
            return;
          }
          if (live()) close();
        } catch (ex) {
          if (!live()) return;
          apply.disabled = false;
          err.textContent = ex && ex.message ? ex.message : String(ex);
          err.hidden = false;
          if (onError) onError(err.textContent);
        }
      });
    }

  }

  /**
   * @param {Element} cardEl the .node card to anchor to
   * @param {{runId:string, node:object, models:Array, busy:boolean}} opts
   *   `node` is the MANIFEST cell: .id, .kind, .label, .key, .model, .effort.
   *   `busy` mirrors the engine gate (orchestrator.mjs#_retunableNode) so the UI
   *   explains a refusal instead of a dead 400.
   */
  function open(cardEl, { runId, node, models = [], busy = false } = {}) {
    // Re-clicking the same card toggles, like the ask-panel's own popover. Plain
    // close(): focus is inside the panel on a keyboard toggle (so it returns to
    // the card) and on the card already on a pointer toggle (so it stays put).
    if (panel && anchor === cardEl) { close(); return null; }
    close();
    const myGen = ++generation;
    panel = h(doc, 'div', 'rt-pop ins-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', `Retune ${node.label || node.id}`);
    panel.dataset.nodeId = node.id;
    anchor = cardEl;
    openRunId = runId;
    openModels = models;

    const head = h(doc, 'div', 'ins-head');
    head.appendChild(h(doc, 'div', 'ins-name', node.label || node.key || node.id));
    head.appendChild(h(doc, 'div', 'ins-sub', `${node.key || node.kind} · ${node.id}`));
    panel.appendChild(head);
    renderBody({ runId, node, models, arm: armFor(node, busy), myGen });
    doc.body.appendChild(panel);
    if (cardEl.getAttribute && cardEl.getAttribute('aria-expanded') !== null) {
      cardEl.setAttribute('aria-expanded', 'true');
    }
    place(cardEl);
    startFollow();
    // Capture phase, and onKeydown calls stopPropagation(): Escape already has two
    // other owners on `doc` — the monitor nav's wheel-pan disengage and the ask
    // sheet, both in the BUBBLE phase. A capture listener on `doc` that stops
    // propagation runs first and keeps the event from ever reaching them, so
    // closing the popover does not also disengage the graph or close the sheet.
    doc.addEventListener('keydown', onKeydown, true);
    doc.addEventListener('pointerdown', onPointerdown, true);
    const first = panel.querySelector('select, button');
    if (first) { try { first.focus(); } catch { /* jsdom */ } }
    return panel;
  }

  /**
   * Swap the model catalog under an OPEN popover, keeping the live selection.
   *
   * `models` is snapshotted at open(), so a popover opened during the /api/config
   * boot race holds an EMPTY catalog: the model select offers nothing but the
   * stored id, flagged "not in this catalog", and the user is stuck with a dead
   * dropdown until they close and reopen — with nothing on screen saying that
   * would help. The app calls this when the catalog lands (setModelCatalog).
   *
   * A no-op when nothing is open, or when the panel is one of the note-only arms
   * (a flow card, a busy node) that has no pair to repaint.
   */
  function refresh(models) {
    if (!Array.isArray(models)) return;
    openModels = models;                       // a later renderBody must use it too
    if (!pair) return;
    pair.models = models;
    // The LIVE values, not the node's stored ones: a user mid-edit keeps their
    // pick. `keepId` stays the stored id so a hidden or departed stored model is
    // still offered to go back to.
    paintPair(doc, pair.m, pair.e, models,
      { model: pair.m.value, effort: pair.e.value }, pair.node.model || '');
  }

  /**
   * The node changed WHILE this panel was open — a retune from chat or another
   * browser tab, or its execution starting or settling. Both arrive as an ordinary
   * `state` frame, which repaints the card but moves no node ids, so run-hosts
   * does no structural rebuild and the anchor card (and this panel) survive
   * untouched.
   *
   * Without this, Apply is a blind last-write-wins: it posts what the panel was
   * SHOWING when it opened, and quietly reverts the newer override.
   *
   * Untouched panel -> adopt the new values silently, since they are simply
   * fresher than what is on screen. Touched -> keep the user's edit, which they
   * are entitled to, but say plainly that Apply will overwrite something.
   *
   * @param {{id:string, kind?:string, model?:string, effort?:string}} node the CURRENT cell
   * @param {boolean} busy whether an execution is in flight for it right now
   */
  function syncNode(node, st = null) {
    if (!panel || !node || node.id !== panel.dataset.nodeId) return;
    // retuneArm, not armFor: it answers the RUN-level question too. A run that
    // reaches done/stopped/error while this panel is open leaves nothing that will
    // ever dispatch, and an editable panel with a live Apply over it just earns a
    // 400 from the engine. openRetuneFor asks the same question at open time.
    const want = retuneArm(st, node);
    // A node that was mid-execution when the user clicked has SETTLED: swap the
    // dead note for the editable pair rather than leaving them to close and
    // reopen. The reverse is deliberately NOT done — tearing an edit in progress
    // out from under someone because a run started is worse than letting Apply
    // come back with the engine's own "execution in flight" refusal, which the
    // panel already renders inline. A run ENDING is not in that exemption: there
    // is no refusal worth waiting for once nothing can dispatch.
    if (want !== arm && !(arm === 'edit' && want === 'busy')) {
      // Bump the generation FIRST, as open() and close() do: renderBody removes the
      // whole body, `err`, `stale` and the Apply button with it. An Apply already
      // in flight would otherwise still read as live and write its refusal onto
      // detached nodes — invisible in the panel — or, on success, close a panel
      // that is now showing a different arm.
      generation++;
      renderBody({ runId: openRunId, node, models: openModels, arm: want, myGen: generation });
      place(anchor);
      return;
    }
    if (!pair) return;
    const model = node.model || '';
    const effort = node.effort || '';
    // Did the CELL move since the last sync? That — not "does it differ from what
    // the user has typed" — is the whole question. A live run delivers state frames
    // constantly, so comparing against the live select values raised the amber
    // warning on every frame the moment anyone touched a dropdown, which made the
    // one signal that Apply will clobber a concurrent retune worthless.
    const moved = model !== (pair.node.model || '') || effort !== (pair.node.effort || '');
    pair.node = node;
    if (!pair.dirty) {
      if (moved) paintPair(doc, pair.m, pair.e, pair.models, { model, effort });
      pair.stale.hidden = true;
      return;
    }
    // Everything past here is a DIRTY panel: the user's edit stands, and restale()
    // says whether Apply would now overwrite something.
    if (!moved) return;                  // nothing happened elsewhere; say nothing
    pair.elsewhere = true;
    restale();
  }

  /**
   * Show or hide the "changed elsewhere" warning for what is on screen RIGHT NOW.
   *
   * Driven from BOTH sides, because the condition it describes — "something landed
   * elsewhere and the panel still disagrees with it" — is settled from either.
   * `pair.elsewhere` is what keeps it honest: without it a plain local edit would
   * raise the warning (nothing landed), and running it only from syncNode left a
   * user who saw the warning and then picked the very value it named with an amber
   * "Apply will overwrite it" over a selection that would overwrite nothing —
   * degrading the one signal the panel has for a real clobber.
   */
  function restale() {
    if (!pair) return;
    const model = pair.node.model || '';
    const effort = pair.node.effort || '';
    // Matching the cell settles it for good: there is nothing left to overwrite,
    // whether the user got there by editing or the cell came back on its own.
    if (model === (pair.m.value || '') && effort === (pair.e.value || '')) pair.elsewhere = false;
    if (!pair.elsewhere || !pair.dirty) {
      pair.stale.hidden = true;
      return;
    }
    pair.stale.textContent = model
      ? `Changed elsewhere to ${model}${effort ? ` · ${effort}` : ''}. Apply will overwrite it.`
      : 'Cleared to inherit elsewhere. Apply will overwrite it.';
    pair.stale.hidden = false;
  }

  return { open, close, refresh, syncNode, isOpen: () => !!panel, anchorEl: () => anchor };
}
