// ui/public/design/view.mjs — the Design page (behind the design flag): the view app.js routes to, and the sidebar
// row's grey live count. `#design` shows the library (library.mjs); `#design/<id>` the studio, the chat column beside
// the stage (stage.mjs). app.js loads this module, and with it the whole stage graph, in every boot, so nothing here or
// there runs at load time: no window, document, matchMedia or timers until mountDesignView is called, and mount, leave,
// onHello and pushFrame start none. Only show(id) builds a stage.

import { LIVE_BUILD, pinLabel } from './stage-model.mjs';
import { createStage } from './stage.mjs';
import { createPlanList } from './plan-list.mjs';
import { createLibrary, kindWord } from './library.mjs';

/** A design id as P2 mints it; anything else on `#design/…` goes back to the library. */
const DESIGN_ID = /^d_[0-9a-f]{12}$/;

const isObject = (v) => typeof v === 'object' && v !== null;

/** The live builds, one per design: hello's list replaces them, a design-build frame moves one. A paused build is not
 *  live (L4.30): nothing runs while it waits. */
export function createDesignLive() {
  const status = new Map();   // designId -> its build's latest status
  const note = (designId, s) => {
    if (typeof designId !== 'string' || !designId) return;
    if (LIVE_BUILD.includes(s)) status.set(designId, s);
    else status.delete(designId);
  };
  return {
    hello(list) {
      status.clear();
      for (const d of Array.isArray(list) ? list : []) if (d) note(d.designId, d.status);
    },
    // Every other design-* frame reaches every socket too, and carries no status.
    frame(f) {
      if (f && f.type === 'design-build' && typeof f.status === 'string') note(f.designId, f.status);
    },
    count() { return status.size; },
  };
}

/** The Design row's grey count, as Runs paints its own (app.js updateNavCounts): hidden at zero, and the row's name
 *  says it ("Design: 2 live"). A tooltip only when it says more than the label, or on the collapsed rail, which has
 *  no label (applySidebarCollapsed leaves this row to this function). */
export function paintDesignNav(doc, count) {
  const n = Math.max(0, Math.floor(Number(count)) || 0);
  const c = doc && doc.getElementById('nav-design-count');
  if (c) { c.textContent = String(n); c.hidden = n === 0; }
  const row = doc && doc.querySelector('.nav button[data-nav="design"]');
  if (!row) return;
  const label = n ? `Design: ${n} live` : 'Design';
  if (n) row.setAttribute('aria-label', label); else row.removeAttribute('aria-label');
  if (n || row.closest('.sidebar.collapsed')) row.title = label; else row.removeAttribute('title');
}

let current = null;   // { view, live } of the one mounted view

/**
 * Mount the page into `deps.host`. `fetch` reaches C-8's routes, `sendWs` the socket, `route(id)` moves the hash
 * (`''` is the library). `createChat` is P5's seam: when given, the studio's chat is made with
 * `{doc, host, design, fetch, sendWs, renderMarkdown, confirm, setPick, onRestored, planList, unpin}` (`host` is the
 * chat column's `.dz-chat-slot`); without it the Plan list sits in that slot. `renderMarkdown` and `confirm` pass
 * through unchanged. The mount also sets `win.__design` (the proof hook, as `window.__wfv`).
 * @param {{doc: Document, win?: Window, host?: HTMLElement, fetch?: Function, sendWs?: (msg: object) => void,
 *   route?: (id: string) => void, prompt?: Function, renderMarkdown?: Function, confirm?: Function,
 *   createChat?: (o: object) => {pushDesignFrame?: Function, addPin?: Function, destroy?: Function}}} [deps]
 */
export function mountDesignView(deps = {}) {
  const { doc, win, host, fetch: fetchFn, sendWs, route, renderMarkdown, confirm, createChat } = deps;
  const live = createDesignLive();
  const paint = () => paintDesignNav(doc, live.count());
  let shown = false;
  let gen = 0;          // every show and leave moves it: a slow GET of an older show paints nothing
  let lib = null;       // the library, while `#design` shows it
  let studio = null;    // { id, stage, planList, chat } of the open design

  const make = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const button = (cls, text, onClick) => {
    const b = make('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };
  const send = (msg) => { sendWs?.(msg); };

  /** Whatever the host shows goes: the library, the studio (its chat first, which may hold the Plan list), a line. */
  function close() {
    if (lib) { lib.destroy(); lib = null; }
    if (studio) {
      const s = studio;
      studio = null;
      s.chat?.destroy?.();
      s.planList.destroy();
      s.stage.destroy();
    }
    host?.replaceChildren();
  }

  /** A design that could not open: not found (or not this person's), or a failed load that can be tried again. */
  function paintMissing(id, status) {
    const back = button('btn btn-sm', 'Back to designs', () => { route?.(''); });
    const line = make('div', 'empty-line is-err');
    line.setAttribute('role', 'alert');
    const acts = make('span', 'el-acts');
    if (status === 404) {
      line.append(make('span', 'el-t', 'Design not found'));
      acts.append(back);
    } else {
      line.append(make('span', 'el-t', 'Could not load the design'), make('span', null, 'Nothing changed.'));
      acts.append(button('btn btn-sm', 'Try again', () => { void view.show(id); }), back);
    }
    line.append(acts);
    const page = make('div', 'dz-lib');
    page.append(line);
    host?.replaceChildren(page);
  }

  async function openLibrary() {
    if (studio || !lib) {
      close();
      lib = createLibrary({ doc, win, host, fetch: fetchFn, route });
    }
    await lib.show();
  }

  async function openStudio(id, my) {
    let status = 0;
    let detail = null;
    try {
      const res = await fetchFn(`/api/design/${encodeURIComponent(id)}`);
      status = res.status;
      detail = res.ok ? await res.json() : null;
    } catch {
      detail = null;
    }
    if (my !== gen) return;
    const design = isObject(detail) && isObject(detail.design) && detail.design.id === id ? detail.design : null;
    if (!design) {
      paintMissing(id, status);
      return;
    }

    // `.dz-studio > .dz-chat + section.dz-stage`: the chat head names the design and its kind; no ⋯ until P6 gives
    // it a menu (L4.15).
    const el = make('div', 'dz-studio');
    const chatEl = make('aside', 'dz-chat');
    chatEl.setAttribute('aria-label', 'Design chat');
    const head = make('div', 'chat-head');
    const titleText = typeof design.title === 'string' && design.title ? design.title : 'Untitled design';
    const title = make('span', 'dz-chat-title', titleText);
    title.title = titleText;
    head.append(title, make('span', 'dz-kind', kindWord(design.kind)));
    const slot = make('div', 'dz-chat-slot');
    chatEl.append(head, slot);
    const stageEl = make('section', 'dz-stage');
    stageEl.setAttribute('aria-label', 'Stage');
    el.append(chatEl, stageEl);
    host?.replaceChildren(el);

    let stage = null;
    let chat = null;
    const planList = createPlanList({
      doc,
      // The list keeps its button disabled until the call settles, and shows a refusal in the row or card.
      onRetry: (sectionId) => (stage ? stage.resume({ sections: [sectionId] }) : Promise.reject(new Error('The stage is not open'))),
      onDetails: (agentId) => { stage?.showAgent(agentId); },
    });
    stage = createStage({
      doc, win, host: stageEl, design, fetch: fetchFn, sendWs: send,
      // The chip and the box read the same tag.
      onPicked: (p) => { chat?.addPin?.({ ...p, label: pinLabel(stage.model(), p) }); },
      onPlan: (rows) => { planList.paint(rows); },
    });
    if (typeof createChat === 'function') {
      chat = createChat({
        doc, host: slot, design, fetch: fetchFn, sendWs: send, renderMarkdown, confirm,
        setPick: (on) => stage.setPick(on),
        onRestored: () => stage.loadRunDoc(),
        planList,
        unpin: (pinId, path) => stage.unpin(pinId, path),
      });
    } else {
      slot.append(planList.el);
    }
    studio = { id, stage, planList, chat };
    await stage.open(detail);
  }

  const view = {
    /** `''` the library, a design id its studio; anything else goes back to the library. */
    async show(param = '') {
      const id = typeof param === 'string' ? param : '';
      if (id && studio?.id === id) return;   // already open: a second route keeps the stage as it is
      const my = ++gen;
      shown = true;
      if (id === '') {
        await openLibrary();
        return;
      }
      close();
      if (!DESIGN_ID.test(id)) {
        route?.('');
        return;
      }
      await openStudio(id, my);
    },
    leave() {
      if (!shown) return;
      shown = false;
      gen += 1;
      close();
    },
    /** Every frame counts toward the nav; only the open design's reach its stage and its chat (text deltas too). */
    pushFrame(f) {
      live.frame(f);
      paint();
      if (!studio || !isObject(f) || f.designId !== studio.id) return;
      const { stage, chat } = studio;
      stage.pushFrame(f);
      chat?.pushDesignFrame?.(f);
    },
    onHello(list, opts) {
      live.hello(list);
      paint();
      studio?.stage.onHello(opts);
    },
    /** The open stage, or null. */
    stage() { return studio ? studio.stage : null; },
    destroy() {
      view.leave();
      if (current && current.view === view) current = null;
      if (win && win.__design?.view === view) delete win.__design;
    },
  };
  current = { view, live };
  if (win) win.__design = { view, stage: () => view.stage(), pushFrame: (f) => view.pushFrame(f) };
  paint();   // nothing is live until hello says so
  return view;
}

/** app.js's socket router hands every design-* frame here; it goes to the mounted view. */
export function pushDesignFrame(f) { current?.view.pushFrame(f); }

/** app.js's hello hands its design list (and { rebooted }) here. */
export function designHello(list, opts) { current?.view.onHello(list, opts); }

/** The mounted view's live count, for app.js's rail repaint. */
export function designNavCount() { return current ? current.live.count() : 0; }
