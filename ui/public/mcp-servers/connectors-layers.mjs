// ui/public/mcp-servers/connectors-layers.mjs — the Connectors page's pop-ups on the shared Marketplace layers
// (marketplace/layers.mjs): `modal` (centred .mk-dialog) and `sheet` (right .mk-sheet) keep the open/close/onClose/
// shows/afterClose interface mcp-view.mjs, skill-import.mjs and mcp-server-import.mjs already use; `confirm` is a
// decision dialog that names what goes and opens on Cancel. Esc, the scrim, focus trap and focus return are the layers'.
import { createDialog, createSheet } from '../marketplace/layers.mjs';
import { icon } from '../icons.mjs';

function make(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function actionButtons(doc, actions) {
  return actions.map(([label, cls, fn]) => {
    // Dialog actions are 32px (docs/design-system.md › Sizes): the layer drops the callers' btn-sm.
    const b = make(doc, 'button', cls.split(' ').filter((c) => c !== 'btn-sm').join(' '), label);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  });
}

export function createConnectorLayers({ doc, win }) {
  function controller(kindOfLayer) {
    let layer = null;
    let quiet = false;                 // a programmatic close / replacement: no dismissal hooks, no afterClose
    let hooks = new Set();
    let after = null;
    const dismissed = () => {
      if (quiet) return;
      const fns = [...hooks];
      const fn = after;
      hooks = new Set();
      after = null;
      for (const f of fns) f();
      if (fn) void fn();
    };
    const take = () => {
      if (!layer) return;
      const old = layer;
      layer = null;
      quiet = true;
      old.close();
      quiet = false;
    };
    const api = {
      open(title, bodyEl, actions = [], { width = 'md', kind = 'form' } = {}) {
        // Hooks registered before open() belong to this layer; only a layer being replaced drops its own.
        const replacing = !!layer && layer.isOpen();
        take();
        if (replacing) { hooks = new Set(); after = null; }
        const opener = doc.activeElement;
        const own = kindOfLayer === 'dialog'
          ? createDialog({ doc, win, width, kind, onClose: dismissed })
          : createSheet({ doc, win, kind, onClose: dismissed });
        layer = own;
        const t = make(doc, 'h2', kindOfLayer === 'dialog' ? 'section-title' : 'subpage-title', title);
        t.id = kindOfLayer === 'dialog' ? 'mk-dialog-title' : 'mk-sheet-title';
        const foot = actionButtons(doc, actions);
        if (kindOfLayer === 'dialog') {
          const x = make(doc, 'button', 'btn btn-sm btn-quiet btn-icon mk-dlg-close');
          x.type = 'button';
          x.setAttribute('aria-label', 'Close');
          x.append(icon(doc, 'x', 16));
          x.addEventListener('click', () => own.close());
          own.replace({ head: [t, x], body: bodyEl, foot });
        } else {
          own.replace({ head: t, body: bodyEl, foot });
        }
        own.open(opener);
        return own;
      },
      close() { hooks = new Set(); after = null; take(); },
      onClose(fn) { hooks.add(fn); return () => hooks.delete(fn); },
      afterClose(fn) { after = fn; },
      shows: (node) => !!layer && layer.isOpen() && layer.body.contains(node),
    };
    return api;
  }
  const modal = controller('dialog');
  const sheet = controller('sheet');

  /** Resolves true only on the confirm click; false on Cancel, Esc, Close or the scrim; exactly once. */
  function confirm({ title, message = '', lose = [], keep = '', confirmLabel = 'Remove', danger = true }) {
    return new Promise((resolve) => {
      let done = false;
      const settle = (v) => { if (done) return; done = true; resolve(v); };
      const dlg = createDialog({ doc, win, width: 'sm', kind: 'decision', onClose: () => settle(false) });
      const t = make(doc, 'h2', 'section-title', title);
      t.id = 'mk-dialog-title';
      const x = make(doc, 'button', 'btn btn-sm btn-quiet btn-icon mk-dlg-close');
      x.type = 'button';
      x.setAttribute('aria-label', 'Close');
      x.append(icon(doc, 'x', 16));
      x.addEventListener('click', () => dlg.close());
      const body = make(doc, 'div');
      for (const line of String(message).split('\n').filter(Boolean)) body.appendChild(make(doc, 'p', '', line));
      if (lose.length) {
        const ul = make(doc, 'ul', 'cx-lose');
        for (const l of lose) { const li = make(doc, 'li'); li.append(icon(doc, 'trash', 14), make(doc, 'span', '', l)); ul.appendChild(li); }
        body.appendChild(ul);
      }
      if (keep) body.appendChild(make(doc, 'p', 'mk-meta', keep));
      const cancel = make(doc, 'button', 'btn btn-quiet', 'Cancel');
      cancel.type = 'button';
      cancel.dataset.autofocus = '';
      cancel.addEventListener('click', () => dlg.close());
      const go = make(doc, 'button', `btn ${danger ? 'btn-danger' : 'btn-primary'} mk-confirm`, confirmLabel);
      go.type = 'button';
      go.addEventListener('click', () => { settle(true); dlg.close(); });
      dlg.replace({ head: [t, x], body, foot: [cancel, go] });
      dlg.open(doc.activeElement);
    });
  }

  return { modal, sheet, confirm };
}
