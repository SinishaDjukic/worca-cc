// test/helpers/composer-shell.mjs
// The composer's jsdom host, in test/helpers/ rather than in a *.test.mjs file:
// node:test registers a test on module evaluation, so importing a test file for
// its fixtures re-runs that whole file inside the importing process.
//
// It builds the element set the composer engine binds (the chip as the canvas's
// child; no palette, rail or tablist — the Workflows view hosts the inspector
// body in its More popover) and hands back an injected `raf` queue so "60 moves
// ⇒ 1 frame" stays observable where jsdom has neither layout nor animation frames.
import { JSDOM } from 'jsdom';
import { fixture, portsFn, AGENTS } from './graph-view-fixture.mjs';

const composerPath = new URL('../../ui/public/graph/composer.mjs', import.meta.url).href;

/** The stage rect `viewport` injects — jsdom measures every box as 0×0. */
export const RECT = { left: 0, top: 0, width: 1280, height: 560 };

export const IDS = ['gv-canvas', 'gv-chip', 'gv-name', 'gv-errors', 'gv-autolayout', 'gv-save', 'gv-ins-body', 'gv-dialog-host'];

export function shell() {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/' });
  const doc = dom.window.document;
  const el = {};
  for (const id of IDS) {
    const tag = id === 'gv-name' ? 'input' : (/^gv-(save|autolayout|errors)$/.test(id) ? 'button' : 'div');
    const n = doc.createElement(tag);
    n.id = id;
    doc.body.appendChild(n);
  }
  // the chip is the stage's SIBLING inside the canvas host
  doc.getElementById('gv-canvas').append(doc.getElementById('gv-chip'));
  for (const id of IDS) el[id.replace(/^gv-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = doc.getElementById(id);
  const q = [];
  return {
    dom, win: dom.window, doc, el,
    hostEls: {
      canvas: el.canvas, chip: el.chip, name: el.name, errors: el.errors,
      autoBtn: el.autolayout, saveBtn: el.save, insBody: el.insBody, dialogHost: el.dialogHost,
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
