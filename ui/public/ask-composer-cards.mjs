// ui/public/ask-composer-cards.mjs
// Ask Worca's drafted agent / script cards and its graph card: the Workflows chat's cards (workflows/card-views.mjs) on a
// chat with no canvas. A draft saves through the same actions as there (app.js wfvChatActions) or opens in its wizard
// (Edit…); its Save and Decline are free (the composer route starts no turn) and the context header reports the state on
// the next turn. The graph card saves the drafts it uses first (a declined one refuses), then asks the server to save the
// graph — Save and Decline start the workflow-card event turn — or opens it on the canvas as a NEW unsaved workflow.
import { cardKit, draftCardView, buildCardView, okChip } from './workflows/card-views.mjs';
import { renderAutoProposal } from './auto-proposal.mjs';

export const ASK_COMPOSER_CARD_TYPES = Object.freeze(['agent-draft', 'script-draft', 'workflow-build']);
/** How old the library snapshot may get while a proposed draft card is on screen (a wizard save happens elsewhere). */
export const LIBRARY_TTL_MS = 15000;

const isDraftCard = (c) => Boolean(c) && (c.type === 'agent-draft' || c.type === 'script-draft') && Boolean(c.draft) && typeof c.draft.key === 'string';
const kindOf = (c) => (c.type === 'agent-draft' ? 'agent' : 'script');
const rowsOf = (d, key) => (Array.isArray(d) ? d : d && Array.isArray(d[key]) ? d[key] : []);

/**
 * @param {{doc:Document, fetch:Function, blocks:()=>object[], postCard:(block:object, body:object)=>Promise<object>,
 *          actions?:object, openComposer?:Function|null, now?:()=>number, onChange?:()=>void}} o
 *   postCard throws {status, message} on a refusal (ask-panel postCardJson); actions = app.js askComposerActions().
 */
export function createAskComposerCards({ doc, fetch, blocks = () => [], postCard, actions = {}, openComposer = null, now = () => Date.now(), onChange = () => {} }) {
  const { h, button } = cardKit(doc, { onChange });
  const act = (name, ...a) => (actions && typeof actions[name] === 'function' ? actions[name](...a) : undefined);
  // The library's keys, read here: app.js's own registry stays empty until the Workflows view mounted once.
  // descs: key → the description the composer's card footer shows (Ask's graph cards draw the same footer).
  const lib = { agents: new Set(), scripts: new Set(), descs: new Map(), at: -Infinity, tried: -Infinity, loading: null };
  const flipped = new Set();            // draft cards this page recorded saved (once each)
  const savedFrom = new Map();          // draft key → the card whose program this page saved under it (its Save, or its wizard)
  const recordFailed = new Map();       // draft card id → when the sweep's record failed (retried at the TTL; its Save records it)
  const errEls = new Map();             // card id → its error line
  const serverCmds = new Map();         // graph card id → the commands a 409 SCRIPTS_UNCONFIRMED listed (D10: shown, then confirmed)

  function loadLibrary() {
    if (lib.loading) return lib.loading;
    lib.tried = now();                    // a failing library is retried at the TTL, never on every render
    lib.loading = (async () => {
      try {
        const [a, s] = await Promise.all([fetch('/api/agents?all=1'), fetch('/api/scripts')]);
        if (!a || !a.ok || !s || !s.ok) return false;
        const [ad, sd] = await Promise.all([a.json(), s.json()]);
        lib.agents = new Set(rowsOf(ad, 'agents').map((x) => x && x.key).filter(Boolean));
        lib.scripts = new Set(rowsOf(sd, 'scripts').map((x) => x && x.key).filter(Boolean));
        lib.descs = new Map([...rowsOf(sd, 'scripts'), ...rowsOf(ad, 'agents')]
          .filter((x) => x && typeof x.key === 'string').map((x) => [x.key, String(x.description || '')]));
        lib.at = now();
        return true;
      } catch { return false; } finally { lib.loading = null; }
    })();
    return lib.loading;
  }
  const libraryHas = (key, kind) => (kind !== 'script' && lib.agents.has(key)) || (kind !== 'agent' && lib.scripts.has(key));
  const flip = async (b, body) => {
    try { return { ok: true, body: await postCard(b, body) }; }
    catch (e) { return { ok: false, status: (e && e.status) || 0, error: (e && e.message) || 'failed', body: (e && e.body) || null }; }
  };
  const draftBlocks = () => blocks().filter((x) => x && x.kind === 'card' && isDraftCard(x.card));
  const findDraft = (key) => { let found = null; for (const x of draftBlocks()) if (x.card.draft.key === key) found = x; return found; };
  // D12 on the cards' own buttons: the newest card of a key decides. An older proposed card is replaced; and the library
  // holding a key stands for a card only when no OTHER card of the key put it there (saved here, or saved before a reload).
  const superseded = (x) => { const n = findDraft(x.card.draft.key); return Boolean(n) && n.id !== x.id; };
  const savedByOther = (x) => {
    const key = x.card.draft.key;
    if (savedFrom.has(key)) return savedFrom.get(key) !== x.id;
    return draftBlocks().some((y) => y.id !== x.id && y.card.draft.key === key && (y.state === 'saved' || y.state === 'added'));
  };
  /** The library holds this card's key through THIS card (its wizard, Edit…): it is saved, and only needs recording. */
  const heldFor = (x) => libraryHas(x.card.draft.key, kindOf(x.card)) && !savedByOther(x);
  const retryLater = (x) => recordFailed.has(x.id) && now() - recordFailed.get(x.id) <= LIBRARY_TTL_MS;
  function fail(b, text) {
    const line = errEls.get(b.id);
    if (line) { line.textContent = text; line.hidden = false; }
    act('notify', { tone: 'err', title: text });
    return { ok: false, error: text };
  }

  /** One draft: through the Workflows chat's save action — or, when the library holds its key already (its wizard saved
   *  it), just recorded — then the card flips saved (free). A 409 means the card moved on meanwhile: not an error. */
  async function saveDraft(b) {
    const c = b.card;
    const kind = kindOf(c);
    if (superseded(b)) return fail(b, `Not saved: a newer draft of "${c.draft.key}" replaced this one.`);
    const r = heldFor(b) ? { ok: true, key: c.draft.key }
      : kind === 'agent' ? await act('saveAgentDraft', c.draft) : await act('saveScriptDraft', c.draft);
    if (!r || !r.ok) return fail(b, `Not saved: ${(r && r.error) || 'failed'}`);
    (kind === 'agent' ? lib.agents : lib.scripts).add(r.key);
    savedFrom.set(c.draft.key, b.id);
    recordFailed.delete(b.id);
    // Always post (a sweep that already posted makes this a 409, which is fine): after a sweep's POST failed, a user's
    // Save must still be able to record the card.
    flipped.add(b.id);
    const f = await flip(b, { state: 'saved', card: { savedKey: r.key } });
    if (!f.ok && f.status !== 409) {
      flipped.delete(b.id);                 // not recorded: shown unsaved (its Save records it), the sweep retries at the TTL
      recordFailed.set(b.id, now());
      return fail(b, `Saved, but the card was not updated: ${f.error}`);
    }
    return { ok: true, key: r.key };
  }
  /** The drafts a graph card uses, saved first (the composer's Apply): a declined or failed one refuses. */
  async function saveBuildDrafts(b) {
    for (const key of b.card.drafts || []) {
      const d = findDraft(key);
      // A key another card of it saved is no save of the newest card's program: that card saves as itself (D12).
      if (libraryHas(key) && !(d && d.state === 'proposed' && savedByOther(d))) continue;
      if (!d) return fail(b, `The draft "${key}" is no longer in this chat.`);
      if (d.state === 'declined' || d.state === 'failed') return fail(b, `Not saved: this workflow needs "${key}", which was ${d.state === 'declined' ? 'declined' : 'not saved'}.`);
      if (d.state === 'proposed') { const s = await saveDraft(d); if (!s.ok) return s; }
    }
    return { ok: true };
  }
  async function saveBuild(b) {
    const s = await saveBuildDrafts(b);
    if (!s.ok) return;
    // D10: the card showed every command / code its script steps run (commandsOf) — this Save confirms exactly that
    // list. The server re-derives the list over the real registry and refuses (409 SCRIPTS_UNCONFIRMED) when it is
    // non-empty and differs from the list this body confirms.
    const list = serverCmds.get(b.id) || (Array.isArray(b.card.scriptNodes) ? b.card.scriptNodes : []);
    const shown = list.length > 0;
    const f = await flip(b, { state: 'saved', ...(shown ? { acceptScripts: list.map((n) => ({ nodeId: n && n.nodeId, params: (n && n.params) || {} })) } : {}) });
    // The real registry lists commands the card did not show (a script changed since the proposal): show the server's
    // list in place of the card's, and the next Save confirms it — never a Save that can only be refused again.
    const listed = !f.ok && f.status === 409 && f.body && f.body.code === 'SCRIPTS_UNCONFIRMED' && Array.isArray(f.body.scriptNodes) ? f.body.scriptNodes : [];
    if (listed.length) {
      serverCmds.set(b.id, listed);
      const card = errEls.get(b.id) && errEls.get(b.id).parentNode;
      const box = commandsOf({ scriptNodes: listed });
      if (card && box) { const old = card.querySelector('.gv-import-scripts'); if (old) old.replaceWith(box); else card.insertBefore(box, card.querySelector('.wfc-actions')); }
      fail(b, 'Not saved. Check the commands this workflow runs (listed above), then save again to confirm them.');
      return;
    }
    if (!f.ok) { fail(b, `Not saved: ${f.error}`); return; }
    const turn = f.body && f.body.turn;
    if (turn && turn.error) fail(b, `Saved. Chat could not reply: ${turn.error}`);
  }
  async function openBuild(b) {
    if (b.state === 'saved' && b.workflowId) { if (typeof openComposer === 'function') openComposer(b.workflowId); return; }
    const s = await saveBuildDrafts(b);
    if (!s.ok) return;
    const c = b.card;
    await act('openBuild', { name: c.name || '', domain: c.domain || '', nodes: c.workflow.nodes, wires: c.workflow.wires });
  }
  async function decline(b) {
    const f = await flip(b, { state: 'declined' });
    if (!f.ok) fail(b, `Not declined: ${f.error}`);
  }

  /** The footer text a graph card shows for `key` (the composer's description): the newest live draft of it in this
   *  chat, else the library row. '' until the library loads — the footer is full height either way. */
  function describeKey(key) {
    const d = findDraft(key);
    const own = d && d.state !== 'declined' && d.state !== 'failed' && d.card.draft.meta && d.card.draft.meta.description;
    return own ? String(own) : (lib.descs.get(key) || '');
  }
  /** The graph from the manifest build_workflow made (composer-deps.mjs), drawn as the Workflows canvas draws it — the
   *  same x/y (build_workflow laid it out with the description footer billed), scale 1, lanes, no chip band (the model
   *  shows in the label row) — in a pannable well whose Expand is this card's Open in Workflows. */
  function graphOf(b) {
    const c = b.card;
    const m = c.manifest;
    if (!m || !m.graph || !Array.isArray(m.graph.nodes) || !m.graph.nodes.length) return null;
    return renderAutoProposal({ name: c.name || '', manifest: { version: 2, graph: m.graph }, nodes: {}, order: null },
      { doc, order: ['graph'], editableName: false, pick: false, canvas: true, chips: false,
        descriptionOf: describeKey, onExpand: () => openBuild(b) });
  }
  /** D10: every command / code a script step runs, shown as the Import dialog shows them (app.js gvConfirmScriptImport:
   *  workflow-share.mjs's SCRIPT_IMPORT_NOTICE sentence and the same classes), above the buttons. */
  function commandsOf(c) {
    const list = Array.isArray(c.scriptNodes) ? c.scriptNodes : [];
    if (!list.length) return null;
    const box = h('div', 'gv-import-scripts');
    box.appendChild(h('p', '', "These commands run on this machine with worca's privileges when the workflow runs."));
    for (const n of list) {
      for (const [id, value] of Object.entries((n && n.params) || {})) {
        box.append(h('div', 'gv-import-script-h', `${n.displayName || n.key} (${n.nodeId}, ${n.runtime}) · ${id}`), h('pre', 'mono gv-import-script-v', String(value)));
      }
    }
    return box;
  }
  function renderBuild(b) {
    const c = b.card;
    const handle = b.state === 'declined' || b.state === 'failed' ? null : graphOf(b);
    const el = buildCardView(b, { h, graph: handle ? handle.el : null, title: b.state === 'saved' ? 'Saved workflow' : 'Proposed workflow', actions: (row) => {
      if (b.state === 'proposed') {
        row.append(button('Decline', 'btn btn-sm', () => decline(b)), h('span', 'wfc-spacer'),
          button('Open in Workflows', 'btn btn-sm', () => openBuild(b)),
          button(c.thenRun ? 'Save & propose' : 'Save as workflow', 'btn btn-sm btn-primary', () => saveBuild(b)));
      } else if (b.state === 'saved') {
        row.append(okChip(h, `Saved as ${b.workflowId || c.name}`), h('span', 'wfc-spacer'), button('Open in Workflows', 'btn btn-sm', () => openBuild(b)));
      } else {
        row.appendChild(h('span', 'wfc-muted', String(b.state || '')));
      }
    } });
    const cmds = b.state === 'proposed' || b.state === 'saved' ? commandsOf(serverCmds.has(b.id) ? { scriptNodes: serverCmds.get(b.id) } : c) : null;
    if (cmds) el.insertBefore(cmds, el.querySelector('.wfc-actions'));
    return { el, handle };
  }
  /** What a draft card shows (D12): an older proposed card of its key is replaced; a key the library holds by now through
   *  this card (its wizard, Edit…) shows saved once sweep() could record it — a failed record shows it unsaved again. */
  function draftView(b) {
    if (b.state !== 'proposed') return b.state;
    if (superseded(b)) return 'superseded';
    return heldFor(b) && !recordFailed.has(b.id) ? 'saved' : 'proposed';
  }
  function renderDraft(b) {
    const c = b.card;
    const isAgent = c.type === 'agent-draft';
    return draftCardView(b, { h, button, state: draftView(b),
      onEdit: (d) => act(isAgent ? 'openAgentDraft' : 'openScriptDraft', d),
      onDecline: () => decline(b),
      onSave: () => saveDraft(b) });
  }

  return {
    /** A built card for ask-panel's buildCard: {el, handle?, dispose?} (handle.parts.graph + relayout for relayoutCards). */
    render(b) {
      const built = b.card && b.card.type === 'workflow-build' ? renderBuild(b) : { el: renderDraft(b), handle: null };
      const err = h('p', 'wfc-err');
      err.hidden = true;
      err.setAttribute('role', 'status');
      built.el.appendChild(err);
      errEls.set(b.id, err);
      const wrap = h('div', 'ask-ccard');
      wrap.dataset.cardId = b.id;
      wrap.appendChild(built.el);
      return { el: wrap, ...(built.handle ? { handle: built.handle, dispose: () => built.handle.destroy() } : {}) };
    },
    /** What a card shows (ask-panel's card cache rebuilds it when this changes, not only on a state change). */
    view(b) { return b && b.card && b.card.type === 'workflow-build' ? String(b.state || '') : draftView(b); },
    /** Every render: while a proposed draft card is showing, re-read a stale library and record saved each NEWEST draft
     *  whose key it holds through that card (saved through Edit…'s wizard — the card was never told). Once per card; a
     *  record that failed is retried at the TTL. */
    async sweep() {
      const pending = draftBlocks().filter((x) => x.state === 'proposed' && !flipped.has(x.id) && !retryLater(x) && !superseded(x));
      if (!pending.length) return;
      if (now() - Math.max(lib.at, lib.tried) > LIBRARY_TTL_MS && !(await loadLibrary())) return;
      for (const x of pending) {
        if (flipped.has(x.id) || superseded(x) || !heldFor(x)) continue;
        flipped.add(x.id);
        savedFrom.set(x.card.draft.key, x.id);
        const f = await flip(x, { state: 'saved', card: { savedKey: x.card.draft.key } });
        if (f.ok || f.status === 409) recordFailed.delete(x.id);
        else { flipped.delete(x.id); recordFailed.set(x.id, now()); }
      }
    },
    /** The chat was hidden (a wizard, another view): the next sweep re-reads the library. */
    stale() { lib.at = -Infinity; lib.tried = -Infinity; },
    /** A graph card's description footer for `key` (describeKey). */
    describe: describeKey,
    /** When the library behind `describe` last loaded: ask-panel repaints the footers once it moves. */
    describedAt: () => lib.at,
    /** While a graph card shows (the Chat page open): load the library once per page open for the footers — sharing the
     *  sweep's load and its failure back-off (lib.tried, the TTL), never a load per render; onChange once it landed. */
    async describeGraphs() {
      const at = lib.at;
      if (lib.loading) await lib.loading;
      else if (lib.at === -Infinity && now() - lib.tried > LIBRARY_TTL_MS) await loadLibrary();
      if (lib.at !== at) onChange();
    },
  };
}
