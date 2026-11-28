// ui/public/design/studio.mjs — a chat with a design on the Chat page (docs/design.md, "In the chat"). The chat stays a
// plain chat: its transcript draws the design's cards through `paintCard`, and the slot above its composer holds the
// design's dock (chat.mjs inline: the plan, the build's questions and feed; its pins, Point and gear join the chat's
// composer); the tool panel's
// Design tab holds its stage (stage.mjs: the preview, the HUD and agents, the deck rail or film bar, Export). The two
// halves share one picture log and one plan list. The stage lives only while its tab is on screen: `attachStage` builds
// it into the tab and opens it from a fresh GET, `detachStage` destroys it, as the Design page's studio did on a leave.
// Nothing runs when this file loads.
import { LIVE_BUILD, pinLabel } from './stage-model.mjs';
import { createStage } from './stage.mjs';
import { createPlanList } from './plan-list.mjs';
import { createKindRow, designMoreMenu, keepStart, kindWord, makeDesign, startModelsUrl, takeStart, titleFromBrief } from './library.mjs';
import { createDesignsGrid } from './designs-grid.mjs';
import { createComposerSettings, createPicturesRow } from './composer-settings.mjs';
import { createModelPills } from './model-pills.mjs';
import { makeSwitch } from '../switch.mjs';
import { DESIGN_FAST_DEFAULT, DESIGN_FAST_LABEL } from '../../../src/shared/design-names.mjs';
import { createDesignExport } from './export-dialog.mjs';
import { createPictureLog } from './pictures.mjs';
import { iconSvg } from '../icons.mjs';

/** The store's OPEN_BUILD_STATUSES: a build in one is open (a paused one too), and the store refuses a delete. */
const OPEN_BUILD = Object.freeze([...LIVE_BUILD, 'paused']);
const isObject = (v) => typeof v === 'object' && v !== null;
const enc = encodeURIComponent;
/** The server's Build fast caps (P8, M6): `{fast, calm}`. */
const LIMITS_URL = '/api/design/limits';

/**
 * @param {{doc: Document, win: Window, host: HTMLElement, designId: string, fetch: Function, sendWs?: Function,
 *   renderMarkdown?: Function, confirm?: Function, prompt?: Function, navigate?: (hash: string) => void,
 *   createChat: (o: object) => object, showStage?: () => Promise<unknown>, setTitle?: (title: string) => void,
 *   headSlot?: HTMLElement, setComposer?: (ext: object) => ({refresh: () => void, restore: (text: string) => void}|null)}} deps
 *   `host` is the chat column's slot; `headSlot` sits beside the chat's title in its head and takes the design's kind and
 *   its ⋯ (All designs, Rename, Delete), so the chat keeps one head row; `showStage()` opens the tool panel's Design tab
 *   (it resolves once the stage is attached, or when it cannot be); `setTitle` repaints the Chat head after a Rename;
 *   `setComposer` hands the dock's pins, Point, gear and send to the Chat page's composer (ask-panel setComposerExt),
 *   which a design chat uses as every chat does.
 */
export function createDesignStudio({ doc, win, host, designId, fetch: fetchFn, sendWs = () => {}, renderMarkdown = null,
  confirm = null, prompt = null, navigate = () => {}, createChat, showStage = () => Promise.resolve(), setTitle = () => {}, headSlot = null,
  setComposer = null, onCards = () => {}, onDeleted = null }) {
  const send = (msg) => { try { sendWs(msg); } catch { /* the socket is down: a hello re-subscribes */ } };
  const make = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (cls, text, attrs) => { const b = make('button', cls, text); b.type = 'button'; for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v); return b; };
  const pictures = createPictureLog({ designId });
  const planList = createPlanList({
    doc,
    onRetry: (sectionId) => withStage().then((stage) => (stage ? stage.resume({ sections: [sectionId] }) : Promise.reject(new Error('The design is not open')))),
    onDetails: (agentId) => { void withStage().then((stage) => stage?.showAgent(agentId)); },
  });
  const st = { destroyed: false, design: null, status: '', chat: null, more: null, stage: null, exp: null, stageHost: null,
    busy: false, opening: null, composer: null };
  const root = make('div', 'dz-chat dz-chat-in-chat');
  host.replaceChildren(root);

  /** The stage, opening the Design tab first when it is not on screen (Point at the page, a plan row's Retry). */
  async function withStage() {
    if (st.stage) return st.stage;
    try { await showStage(); } catch { /* the panel could not open */ }
    if (st.opening) await st.opening;
    return st.stage;
  }

  async function loadDetail() {
    try {
      const res = await fetchFn(`/api/design/${enc(designId)}`);
      const detail = res.ok ? await res.json() : null;
      const design = isObject(detail) && isObject(detail.design) && detail.design.id === designId ? detail.design : null;
      return { status: res.status, detail: design ? detail : null, design };
    } catch {
      return { status: 0, detail: null, design: null };
    }
  }

  async function loadPictures() {
    let rows = null;
    try {
      const res = await fetchFn(`/api/design/${enc(designId)}/pictures`);
      rows = res.ok ? await res.json() : null;
    } catch { rows = null; }
    if (!st.destroyed && Array.isArray(rows)) pictures.load(rows);
  }

  function paintMissing(status) {
    const line = make('div', 'empty-line is-err');   // docs/design-system.md: the error line
    line.setAttribute('role', 'alert');
    const acts = make('span', 'el-acts');
    if (status !== 404) {
      const retry = btn('btn btn-sm', 'Try again', { 'data-dz-retry': '' });
      retry.addEventListener('click', () => { void open(); });
      acts.append(retry);
    }
    const all = btn('btn btn-sm btn-quiet', 'All designs', { 'data-dz-all': '' });
    all.addEventListener('click', () => navigate('#design'));
    acts.append(all);
    line.append(make('span', 'el-t', status === 404 ? 'Design not found' : 'Could not load the design'), acts);
    root.replaceChildren(line);
  }

  /** The head's design facts: its kind as a quiet word, then ⋯ (All designs, Rename, Delete). */
  function paintHead(design) {
    const kindEl = make('span', 'chat-head-kind', kindWord(design.kind));
    const moreBtn = btn('btn btn-sm btn-quiet btn-icon chat-head-btn', null, { 'aria-label': 'More', title: 'More', 'data-dz-more': '' });
    moreBtn.innerHTML = iconSvg('more', 16);
    headSlot?.replaceChildren(kindEl, moreBtn);
    return moreBtn;
  }

  async function open() {
    const { status, design } = await loadDetail();
    if (st.destroyed) return;
    if (!design) { paintMissing(status); return; }
    st.design = design;
    st.status = typeof design.status === 'string' ? design.status : '';
    const moreBtn = paintHead(design);
    const slot = make('div', 'dz-chat-slot');
    root.replaceChildren(slot);
    st.chat = createChat({
      doc, host: slot, design, fetch: fetchFn, sendWs: send, renderMarkdown, confirm,
      setPick: (on) => { if (st.stage) st.stage.setPick(on); else if (on) void withStage().then((stage) => stage?.setPick(true)); },
      onRestored: () => st.stage?.loadRunDoc(),
      planList,
      unpin: (pinId, path) => st.stage?.unpin(pinId, path),
      // An empty stage says the chat is reading the request, instead of showing a blank page.
      onBusy: (on) => { st.busy = !!on; st.stage?.setChatBusy(on); },
      // The design start's first message goes through the dock's own send, once.
      initial: takeStart(designId),
      pictures,
      // The Chat page draws the chat and sends (setComposer): the dock keeps the plan, the build, its live line and note.
      inline: !!setComposer,
      onCards,
      onComposerChange: () => st.composer?.refresh(),
      restore: (text) => st.composer?.restore(text),
    });
    if (setComposer && st.chat.composer) {
      st.composer = setComposer({ ...st.chat.composer }) || null;
    }
    try { onCards(); } catch { /* the Chat page's own trouble */ }   // the transcript's design cards, drawn before the dock was up
    st.more = designMoreMenu({
      doc, win, button: moreBtn, getDesign: () => st.design, fetch: fetchFn, confirm, prompt, navigate, library: true,
      buildLive: () => OPEN_BUILD.includes(st.status), onDeleted,
      onRenamed: (row) => {
        if (typeof row.title !== 'string' || !row.title) return;
        st.design.title = row.title;
        setTitle(row.title);
      },
    });
    void loadPictures();
    if (st.stageHost) await buildStage(st.stageHost);
  }

  /** The stage into the Design tab: opened from a fresh GET, so a round that ended while the tab was away shows. */
  async function buildStage(stageHost) {
    if (!st.design || st.stage || st.destroyed) return;
    const el = make('section', 'dz-stage');
    el.setAttribute('aria-label', 'Stage');
    stageHost.replaceChildren(el);
    const stage = createStage({
      doc, win, host: el, design: st.design, fetch: fetchFn, sendWs: send, pictures,
      onPicked: (p) => { st.chat?.addPin?.({ ...p, label: pinLabel(stage.model(), p) }); },
      onPlan: (rows) => { planList.paint(rows); },
      onExport: () => st.exp?.toggle(),
    });
    st.stage = stage;
    st.exp = createDesignExport({ doc, win, fetch: fetchFn, getDesign: () => st.design, anchor: stage.exportSlot });
    st.exp.setReady(st.status === 'done');
    if (st.busy) stage.setChatBusy(true);
    const { detail, design } = await loadDetail();
    if (st.stage !== stage) return;
    if (design) { st.design = { ...st.design, ...design }; st.status = typeof design.status === 'string' ? design.status : st.status; st.exp.setReady(st.status === 'done'); }
    await stage.open(detail || { design: st.design });
  }

  const ready = open();

  function detachStage() {
    st.stageHost = null;
    st.opening = null;
    const { stage, exp } = st;
    st.stage = null;
    st.exp = null;
    exp?.destroy();
    stage?.destroy();
  }

  return {
    designId,
    ready,
    /** The tool panel's Design tab mounted `stageHost`: the stage goes there. */
    attachStage(stageHost) {
      if (st.destroyed) return Promise.resolve();
      st.stageHost = stageHost;
      st.opening = ready.then(() => (st.stageHost === stageHost ? buildStage(stageHost) : null));
      return st.opening;
    },
    /** The Design tab left the screen: the stage goes, the chat stays. */
    detachStage,
    hasStage: () => !!st.stage,
    stage: () => st.stage,
    /** A design-* frame: this design's reach the picture log, the stage and the dock; the rest are dropped. */
    pushFrame(f) {
      if (st.destroyed || !isObject(f) || f.designId !== designId) return;
      // A picture lands in the log before the stage and the chat hear its frame, so both read it already counted.
      if (f.type === 'design-picture') pictures.push(f);
      st.stage?.pushFrame(f);
      st.chat?.pushDesignFrame?.(f);
      const status = f.type === 'design-build' ? f.status
        : f.type === 'design-snapshot' && isObject(f.build) && st.stage && f.buildId === st.stage.model().buildId ? f.build.status : null;
      if (typeof status === 'string') { st.status = status; st.exp?.setReady(status === 'done'); }
      else if (f.type === 'design-restored') st.exp?.setReady(true);
    },
    pushAskFrame(f) { st.chat?.pushAskFrame?.(f); },
    /** A design card of the chat's transcript: drawn by the dock once it is open, else false (the caller's fallback). */
    paintCard(host, block) { if (!st.chat?.paintCard) return false; st.chat.paintCard(host, block); return true; },
    dropCard(id) { st.chat?.dropCard?.(id); },
    repaintChat() { st.chat?.repaint?.(); },
    onHello(opts) {
      st.stage?.onHello(opts);
      st.chat?.onHello?.();
      pictures.gap();
      void loadPictures();
    },
    destroy() {
      if (st.destroyed) return;
      st.destroyed = true;
      detachStage();
      st.chat?.destroy?.();
      st.more?.destroy();
      planList.destroy();
      headSlot?.replaceChildren();
      root.remove();
    },
  };
}

/**
 * A new design chat (#chat/new/design, the sidebar's Design): what to design over the Chat page's own composer, which
 * `setComposer` lends the design's controls (ask-panel setComposerExt): the kind as a pill beside the project (the
 * chat's scope pill), the gear with the Lead and Builders models, Build fast and Pictures, and the send, which makes
 * the design (makeDesign: the engine gate's dialog included), keeps the message for its chat (keepStart) and opens it
 * through `navigate('#design/<id>')`. Under the kinds sit the designs (designs-grid.mjs): the newest nine, Show all
 * designs and a search; there is no All designs button. `all` starts with every design shown (`#design`), and
 * `onAll(all)` hears Show all designs and Show fewer. The Build fast label reads the server's cap.
 * @param {{doc: Document, win: Window, host: HTMLElement, fetch: Function, navigate: (hash: string) => void,
 *   setComposer?: (ext: object) => object|null, all?: boolean, onAll?: (all: boolean) => void}} deps
 */
export function createDesignStartPage({ doc, win, host, fetch: fetchFn, navigate, setComposer = null, all = false, onAll = () => {} }) {
  const make = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  // The chat home's own layout (chat-shell.css .chat-home, .chat-hero-slot), so a new design starts as a new chat does.
  const root = make('div', 'chat-home dz-start-in-chat');
  const hero = make('div', 'chat-hero-slot dz-start-hero');
  const slot = make('div', 'dz-start-composer');
  // The kind: the Design page's own row of buttons, under the composer (picked before the first send).
  const kindRow = createKindRow(doc, { value: 'web', onPick: (k) => { kind = k; } });
  hero.append(make('h1', 'chat-home-title', 'What should we design?'), slot, kindRow.el);
  // The designs under the hero: what is below it cannot move the heading (.chat-home is a top-aligned column).
  const grid = createDesignsGrid({ doc, win, fetch: fetchFn, navigate, all, onAll });
  root.append(hero, grid.el);
  host.replaceChildren(root);

  let destroyed = false;
  let kind = 'web';
  let projectKey = null;
  let gate = null;
  // The gear: the models on the engine a design made now would build on (the project's or the Default engine), Build
  // fast (on for a new design) and Pictures.
  const settings = createComposerSettings({ doc, win, mode: 'up-end', onOpen: () => { void pics.load().then((c) => { if (c) settings.reposition(); }); } });
  const pills = createModelPills({ doc, win, fetch: fetchFn, mode: 'beside', parent: settings.panel,
    url: () => startModelsUrl(projectKey) });
  const sw = makeSwitch(doc, { label: 'Build fast', checked: DESIGN_FAST_DEFAULT, rowClass: 'dz-fast', inputClass: 'dz-fast-input' });
  const capEl = make('span', 'dz-fast-cap dz-fast-n', DESIGN_FAST_LABEL);
  sw.row.append(capEl);
  sw.input.addEventListener('change', () => { capEl.hidden = !sw.input.checked; });
  const pics = createPicturesRow({ doc, fetch: fetchFn });
  settings.fill(pills.el, settings.divider(), sw.row, pics.el);
  void pills.load();
  void pics.load();
  void grid.open();

  /** P8 (M6): the crew Build fast allows on this server, asked once per start. An answer without whole `fast` and
   *  `calm` numbers, or none, leaves DESIGN_FAST_LABEL. */
  async function loadLimits() {
    let body = null;
    try {
      const res = await fetchFn(LIMITS_URL);
      body = res.ok ? await res.json() : null;
    } catch {
      body = null;
    }
    if (destroyed || !isObject(body) || !Number.isInteger(body.fast) || !Number.isInteger(body.calm)) return;
    capEl.textContent = `up to ${body.fast}`;
  }
  void loadLimits();

  const composer = setComposer ? setComposer({
    composerSlot: slot,
    placeholder: 'A landing page, a report, a deck, a pitch, a film',
    sets: false,
    endNodes: [settings.el],
    onScope: (key) => {
      if ((key || null) === projectKey) return;
      projectKey = key || null;
      void pills.load();
    },
    async send({ text, files = [], projectKey: key = null }) {
      const models = pills.picks();
      const body = { kind, fast: sw.input.checked, title: titleFromBrief(text), ...(key ? { projectKey: key } : {}),
        ...(Object.keys(models).length ? { models } : {}), ...(pics.ready() ? { pictures: pics.input.checked } : {}) };
      const r = await makeDesign({ doc, fetch: fetchFn, body, engine: () => pills.engine(), onGate: (g) => { gate = g; } });
      if (destroyed) return { ok: false, quiet: true };
      if (!r.ok) return { ok: false, error: r.error, quiet: !!r.canceled };
      keepStart(r.id, { text, files });
      navigate(`#design/${encodeURIComponent(r.id)}`);
      return { ok: true };
    },
  }) : null;
  void composer;
  return {
    /** A design-* frame: the designs' tiles take it (a status or a picture in place, a round's end loads them again). */
    pushFrame(f) { grid.pushFrame(f); },
    pushAskFrame() {}, repaintChat() {},
    /** A hello (the socket came back): the designs load again. */
    onHello() { void grid.open(); },
    attachStage() { return Promise.resolve(); }, detachStage() {}, hasStage: () => false, stage: () => null,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      gate?.close();
      grid.destroy();
      pills.destroy();
      settings.destroy();
      root.remove();
    },
  };
}
