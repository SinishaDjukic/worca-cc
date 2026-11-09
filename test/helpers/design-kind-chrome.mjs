// A rig for the deck and video chrome (ui/public/design/kind-chrome.mjs) with no stage around it: a JSDOM `.dz-wrap`,
// a `createKindChrome` posting into a list, a crew colour, and a fake rail frame host. It keeps the view state the real
// stage's model would (`selectKindChrome`) and hands the chrome a `kindChromeView` of it on every change, as the stage's
// `dispatch` does.
//
//   chrome.setPlan({sections})      the plan's sections (removed ones left out, as the model does)
//   chrome.resize({cw, ch})         the stage's size
//   chrome.onDesignFrame(frame)     a `design-build` (or a snapshot's build) sets the round's status
//   chrome.setDocMode(mode)         a newly loaded doc: the view takes `docMode`, then the chrome sees its `ready`
//   chrome.onFrameMessage(msg)      a C-6 message, passed through
import { JSDOM } from 'jsdom';
import { createKindChrome } from '../../ui/public/design/kind-chrome.mjs';
import { kindChromeView } from '../../ui/public/design/kind-view.mjs';

/** Three slides: one done, one being written, one still planned. */
export const SLIDES = Object.freeze([
  Object.freeze({ id: 's1', job: 'Title', status: 'done', agentId: 'a_1' }),
  Object.freeze({ id: 's2', job: 'Problem', status: 'writing', agentId: 'a_2' }),
  Object.freeze({ id: 's3', job: 'Ask', status: 'planned', agentId: null }),
]);

// The model's OPEN_BUILD: a round with agents at work, or paused on a question.
const LIVE = Object.freeze(['planning', 'building', 'integrating', 'paused']);

/**
 * @param {{kind?: string, sections?: object[], cw?: number, ch?: number}} [o]
 */
export function rig({ kind = 'pitch', sections = SLIDES, cw = 1096, ch = 900 } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div class="dz-wrap"></div></body></html>', { url: 'http://localhost/' });
  const win = dom.window;
  const doc = win.document;
  const wrap = doc.querySelector('.dz-wrap');
  const posts = [];
  const rails = [];
  function openRailFrame(host, { onReady } = {}) {
    const rail = {
      host, posts: [], destroyed: false, onReady,
      post(t, f) { rail.posts.push([t, f]); return true; },
      destroy() { rail.destroyed = true; },
    };
    rails.push(rail);
    return rail;
  }
  const real = createKindChrome({
    doc, wrap, kind,
    post: (t, f) => { posts.push([t, f]); return true; },
    openRailFrame,
    colorOf: () => '#86C4E3',
  });
  const state = { status: null, docMode: 'build', sections, stageW: cw, stageH: ch };
  const update = () => real.update(kindChromeView({ ...state, kind, live: LIVE.includes(state.status) }));
  update();
  const chrome = {
    setPlan({ sections: next }) {
      state.sections = next;
      update();
    },
    resize({ cw: w, ch: h }) {
      state.stageW = w;
      state.stageH = h;
      update();
    },
    onDesignFrame(f) {
      const status = f?.type === 'design-build' ? f.status : f?.type === 'design-snapshot' ? f.build?.status : undefined;
      if (typeof status !== 'string') return;
      state.status = status;
      update();
    },
    setDocMode(mode) {
      state.docMode = mode;
      update();
      real.onFrameMessage({ t: 'ready', mode });
    },
    onFrameMessage(m) { real.onFrameMessage(m); },
    pause() { real.pause(); },
    destroy() { real.destroy(); },
  };
  return { win, doc, wrap, chrome, posts, rails, of: (t) => posts.filter(([x]) => x === t).map(([, f]) => f) };
}
