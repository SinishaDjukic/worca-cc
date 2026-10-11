// test/helpers/workflows-shell.mjs — the Workflows chrome over a REAL composer engine in jsdom, without app.js.
import { JSDOM } from 'jsdom';
import { fixture, loopFixture, portsFn, AGENTS } from './graph-view-fixture.mjs';

export const RECT = { left: 0, top: 0, width: 1280, height: 720 };
const html = `<!doctype html><body><div id="wfv"><div id="wfv-stage">
  <div id="wfv-canvas" class="gv-canvas"><div id="wfv-chip" class="gv-chip" hidden></div></div>
  <button id="wfv-back"></button><button id="wfv-wf-menu" aria-expanded="false"></button>
  <input id="wfv-name"><button id="wfv-errors" hidden></button><input type="file" id="wfv-import-file" hidden>
  <button id="wfv-lib-toggle" aria-pressed="true"></button><span id="wfv-savewrap"><button id="wfv-save">Save</button></span>
  <button id="wfv-add" aria-expanded="false"></button><div id="wfc"></div>
  <button id="wfv-autolayout"></button><button id="wfv-zoom" aria-expanded="false"><span id="wfv-zoom-label">100%</span></button>
  <div id="wfv-overlay" data-canvas-keys="off"></div></div><div id="wfv-dialog-host"></div></div></body>`;

export async function bootShell({ template = fixture(), actions = {}, highlight = null } = {}) {
  const dom = new JSDOM(html, { url: 'http://localhost:4317/' });
  const doc = dom.window.document;
  const g = (id) => doc.getElementById(id);
  const { createComposer } = await import(new URL('../../ui/public/graph/composer.mjs', import.meta.url).href);
  const { createWorkflowsShell } = await import(new URL('../../ui/public/workflows/shell.mjs', import.meta.url).href);
  const q = [];
  const insBody = doc.createElement('div');
  const c = createComposer({ canvas: g('wfv-canvas'), chip: g('wfv-chip'), name: g('wfv-name'), errors: g('wfv-errors'),
    autoBtn: g('wfv-autolayout'), saveBtn: g('wfv-save'), saveWrap: g('wfv-savewrap'), insBody, dialogHost: g('wfv-dialog-host') }, {
    doc, api: { config: async () => ({ models: [{ id: 'claude-sonnet-5', label: 'Sonnet 5', efforts: ['medium', 'high'] },
      { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'] }], efforts: ['medium', 'high', 'xhigh', 'max'], subagentModels: [] }) },
    raf: (fn) => { q.push(fn); return q.length; }, viewport: () => ({ ...RECT }), portsFn, allLevels: true, highlight,
  });
  c.mount();
  c.setAgents(AGENTS);
  c.loadTemplate(template);
  const calls = [];
  const rec = (name) => (...args) => { calls.push([name, ...args]); };
  const shell = createWorkflowsShell({
    doc, composer: c,
    els: { root: g('wfv'), stage: g('wfv-stage'), canvas: g('wfv-canvas'), back: g('wfv-back'), wfMenu: g('wfv-wf-menu'),
      name: g('wfv-name'), importFile: g('wfv-import-file'), libToggle: g('wfv-lib-toggle'), add: g('wfv-add'),
      autolayout: g('wfv-autolayout'), zoom: g('wfv-zoom'), zoomLabel: g('wfv-zoom-label'), overlay: g('wfv-overlay'), inspector: insBody },
    actions: { back: rec('back'), newCanvas: rec('newCanvas'), openLibrary: rec('openLibrary'), toggleLibrary: rec('toggleLibrary'),
      importFile: rec('importFile'), exportCurrent: rec('exportCurrent'), newAgent: rec('newAgent'), newScript: rec('newScript'), ...actions },
  });
  await new Promise((r) => setTimeout(r, 0));             // api.config() lands
  return { dom, win: dom.window, doc, g, c, shell, calls, flush: () => { const l = q.splice(0); for (const fn of l) fn(); } };
}
export { fixture, loopFixture, AGENTS };
