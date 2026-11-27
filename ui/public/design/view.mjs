// ui/public/design/view.mjs — the Design page (behind the design flag): the view app.js routes to, and the sidebar
// row's grey live count. `#design` draws nothing here: app.js sends it to the design start with every design shown
// (#chat/new/design/all, studio.mjs createDesignStartPage). A design opens as its chat on the Chat page (studio.mjs,
// docs/design.md "In the chat"): `#design/<id>` hands the id to `openDesign`, which routes there. Nothing here runs at
// load time: no window, document or timers until mountDesignView is called, and mount, leave, onHello and pushFrame
// start none.

import { LIVE_BUILD } from './stage-model.mjs';

/** A design id as P2 mints it; anything else on `#design/…` goes back to `#design`. */
const DESIGN_ID = /^d_[0-9a-f]{12}$/;


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
 * Mount the page. `route(p)` moves the hash (`''` is `#design`) and `openDesign(id)` opens a design's chat; without
 * `openDesign`, `#design/<id>` goes back to `#design`. The mount also sets `win.__design` (the proof hook, as
 * `window.__wfv`).
 * @param {{doc: Document, win?: Window, route?: (p: string) => void, openDesign?: (id: string) => unknown}} [deps]
 */
export function mountDesignView(deps = {}) {
  const { doc, win, route, openDesign } = deps;
  const live = createDesignLive();
  const paint = () => paintDesignNav(doc, live.count());
  let shown = false;

  const view = {
    /** `''` draws and fetches nothing (app.js shows the design start); a design id opens its chat; anything else goes
     *  back to `#design`. */
    async show(param = '') {
      const id = typeof param === 'string' ? param : '';
      shown = true;
      if (id !== '' && DESIGN_ID.test(id) && typeof openDesign === 'function') {
        await openDesign(id);
        return;
      }
      if (id !== '') route?.('');
    },
    leave() {
      if (!shown) return;
      shown = false;
    },
    /** Every frame counts toward the nav. */
    pushFrame(f) {
      live.frame(f);
      paint();
    },
    onHello(list) {
      live.hello(list);
      paint();
    },
    destroy() {
      view.leave();
      if (current && current.view === view) current = null;
      if (win && win.__design?.view === view) delete win.__design;
    },
  };
  current = { view, live };
  if (win) win.__design = { view, pushFrame: (f) => view.pushFrame(f) };
  paint();   // nothing is live until hello says so
  return view;
}

/** app.js's socket router hands every design-* frame here; it goes to the mounted view. */
export function pushDesignFrame(f) { current?.view.pushFrame(f); }

/** app.js's hello hands its design list (and { rebooted }) here. */
export function designHello(list, opts) { current?.view.onHello(list, opts); }

/** The mounted view's live count, for app.js's rail repaint. */
export function designNavCount() { return current ? current.live.count() : 0; }
