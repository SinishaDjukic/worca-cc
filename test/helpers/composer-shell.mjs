// test/helpers/composer-shell.mjs
// The composer's jsdom host, in test/helpers/ rather than in a *.test.mjs file:
// node:test registers a test on module evaluation, so importing a test file for
// its fixtures re-runs that whole file inside the importing process.
//
// It builds the #gv-* element set index.html gives the composer (the chip and
// the rail as the canvas's siblings, the tablist inside #gv-ins-tabs) and hands
// back an injected `raf` queue so "60 moves ⇒ 1 frame" stays observable where
// jsdom has neither layout nor animation frames.
import { JSDOM } from 'jsdom';
import { fixture, portsFn, AGENTS } from './graph-view-fixture.mjs';

const composerPath = new URL('../../ui/public/graph/composer.mjs', import.meta.url).href;

/** The stage rect `viewport` injects — jsdom measures every box as 0×0. */
export const RECT = { left: 0, top: 0, width: 1280, height: 560 };

export const IDS = ['gv-canvas', 'gv-chip', 'gv-head', 'gv-name', 'gv-errors', 'gv-new', 'gv-autolayout',
  'gv-save', 'gv-ins-rail', 'gv-ins-body', 'gv-ins-toggle', 'gv-ins-tabs', 'gv-palette', 'gv-agent-filter',
  'gv-saved-list', 'gv-saved-count', 'gv-archived', 'gv-dialog-host'];

export function shell() {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/' });
  const doc = dom.window.document;
  const el = {};
  for (const id of IDS) {
    // Anchored: a loose /save/ also matches gv-saved-list and gv-saved-count,
    // which are containers, not buttons.
    const tag = /^gv-(name|agent-filter)$/.test(id) ? 'input'
      : (/^gv-(save|new|autolayout|errors|ins-toggle)$/.test(id) ? 'button' : 'div');
    const n = doc.createElement(tag);
    n.id = id;
    doc.body.appendChild(n);
  }
  // chip and rail are the stage's SIBLINGS inside the canvas host, exactly as in index.html
  doc.getElementById('gv-canvas').append(doc.getElementById('gv-chip'), doc.getElementById('gv-ins-rail'));
  // …and the tablist is the rail's own top row, mirroring index.html.
  for (const tab of ['agents', 'info']) {
    const b = doc.createElement('button');
    b.type = 'button'; b.dataset.tab = tab; b.textContent = tab;
    doc.getElementById('gv-ins-tabs').appendChild(b);
  }
  for (const id of IDS) el[id.replace(/^gv-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = doc.getElementById(id);
  const q = [];
  return {
    dom, win: dom.window, doc, el,
    hostEls: {
      canvas: el.canvas, chip: el.chip, head: el.head, name: el.name, errors: el.errors,
      newBtn: el.new, autoBtn: el.autolayout, saveBtn: el.save, insRail: el.insRail, insBody: el.insBody,
      insToggle: el.insToggle, insTabs: el.insTabs, palette: el.palette, filter: el.agentFilter,
      savedList: el.savedList, savedCount: el.savedCount, archived: el.archived, dialogHost: el.dialogHost,
    },
    raf: (fn) => { q.push(fn); return q.length; },
    flush: () => { const l = q.splice(0, q.length); for (const fn of l) fn(); return l.length; },
    frames: () => q.length,
  };
}

export const API = {
  agents: async () => Object.values(AGENTS),
  agentsAll: async () => Object.values(AGENTS),
  config: async () => ({ models: [{ id: 'sonnet', label: 'Sonnet' }], efforts: ['low', 'high'] }),
  listWorkflows: async () => [],
  listArchived: async () => [],
  readWorkflow: async () => null,
  saveWorkflow: async () => ({ ok: true, workflow: { id: 'wf_x' } }),
  deleteWorkflow: async () => ({ ok: true }),
};

/** A mounted composer over the shell. `overrides.template === null` opens a
 *  fresh canvas; omitting it loads the shared proto fixture. */
export async function open(overrides = {}) {
  const s = shell();
  const { createComposer } = await import(composerPath);
  const c = createComposer(s.hostEls, {
    doc: s.doc, api: { ...API, ...(overrides.api || {}) }, raf: s.raf,
    viewport: () => ({ ...RECT }), storage: overrides.storage || null, portsFn,
  });
  c.mount();
  c.loadTemplate(overrides.template === undefined ? fixture() : overrides.template);
  return { ...s, c };
}
