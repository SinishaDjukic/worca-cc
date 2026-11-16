// A list redrawn on live data (docs/rail/components.md `comp.keyed-patch`): patched by key, so an item whose drawing did
// not change keeps its node (and the focus, caret, scroll and selection in it); live redraws wait for the next frame.

const MEMO = new WeakMap();   // container -> Map(key -> { html, nodes }) in order, the last strings drawn (never the DOM's)

/** The nodes one item's string parses to, in its container's document. */
function parse(doc, html) {
  const t = doc.createElement('template');
  t.innerHTML = html;
  return [...t.content.childNodes];
}

/** Elements matching `sel` among `nodes` and inside them, in document order. */
function matching(nodes, sel) {
  const out = [];
  for (const n of nodes) {
    if (n.nodeType !== 1) continue;
    if (n.matches(sel)) out.push(n);
    out.push(...n.querySelectorAll(sel));
  }
  return out;
}

/**
 * The n-th old element matching `sel` takes the place of the n-th new one. Only the attributes the drawing changed
 * (`drawn`, the old string's own nodes, against the new) reach it: what the page set on it since (an orb canvas's
 * DPR-sized width and height, its data-phase) stays.
 */
function carryOver(drawn, oldNodes, newNodes, sel) {
  const before = matching(drawn, sel), was = matching(oldNodes, sel), now = matching(newNodes, sel);
  for (let i = 0; i < Math.min(was.length, now.length); i++) {
    const o = was[i], n = now[i], d = before[i] || o;
    for (const a of [...d.attributes]) if (!n.hasAttribute(a.name)) o.removeAttribute(a.name);
    for (const a of [...n.attributes]) if (d.getAttribute(a.name) !== a.value) o.setAttribute(a.name, a.value);
    const at = newNodes.indexOf(n);
    if (at >= 0) newNodes[at] = o;
    else n.replaceWith(o);
  }
}

/** Unique keys: a repeated key becomes `k#2`, `k#3`, … in order. */
function uniqueKeys(items) {
  const seen = new Map();
  return items.map((x) => {
    const k = String(x.key), n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    return { key: n > 1 ? `${k}#${n}` : k, html: String(x.html ?? '') };
  });
}

/** Whether the container still holds exactly the nodes last drawn into it. */
function intact(container, memo) {
  let count = 0;
  for (const { nodes } of memo.values()) for (const n of nodes) { if (n.parentNode !== container) return false; count++; }
  return count === container.childNodes.length;
}

/**
 * Draws `items` (`[{ key, html }]`, in order) into `container`, touching only what changed: the same key with the same
 * string keeps its nodes (moved only when the order changed), a changed string is replaced, a new key is inserted at its
 * place, a gone key removed. The first call, or a container someone else changed, is built once. `carry` (a selector):
 * in a replaced item, the n-th old element matching it stays in place of the n-th new one, taking the attributes the
 * drawing changed (an orb's canvas keeps turning, at its DPR size). Returns `{ kept, replaced, added, removed }`.
 */
export function patchKeyed(container, items, { carry } = {}) {
  const doc = container.ownerDocument, list = uniqueKeys(items || []);
  const memo = MEMO.get(container);
  const next = new Map();
  if (!memo || !intact(container, memo)) {
    for (const x of list) next.set(x.key, { html: x.html, nodes: parse(doc, x.html) });
    container.replaceChildren(...[...next.values()].flatMap((x) => x.nodes));
    MEMO.set(container, next);
    return { kept: 0, replaced: 0, added: list.length, removed: 0 };
  }
  const counts = { kept: 0, replaced: 0, added: 0, removed: 0 };
  const drop = [];
  for (const x of list) {
    const was = memo.get(x.key);
    if (was && was.html === x.html) { next.set(x.key, was); counts.kept++; continue; }
    const nodes = parse(doc, x.html);
    if (was) { if (carry) carryOver(parse(doc, was.html), was.nodes, nodes, carry); drop.push(...was.nodes); counts.replaced++; }
    else counts.added++;
    next.set(x.key, { html: x.html, nodes });
  }
  for (const [k, was] of memo) if (!next.has(k)) { drop.push(...was.nodes); counts.removed++; }
  for (const n of drop) if (n.parentNode === container) n.remove();
  let cursor = container.firstChild;
  for (const { nodes } of next.values()) {
    for (const n of nodes) {
      if (n === cursor) cursor = cursor.nextSibling;
      else container.insertBefore(n, cursor);
    }
  }
  MEMO.set(container, next);
  return counts;
}

/**
 * Draws a region made of named parts (docs/rail/components.md `comp.patch-parts`): `parts` is `{ name: html }`, drawn in
 * its key order, and patched by name with `patchKeyed`, so a part whose string did not change keeps its nodes (its focus,
 * caret, scroll, an open menu), a changed part is replaced with its neighbours kept, an empty part (`''`, null,
 * undefined) draws nothing, and a redraw that changes nothing writes nothing. Part names are never integer-like: JS
 * would reorder them. Returns `{ kept, replaced, added, removed }`.
 */
export function patchParts(container, parts, { carry } = {}) {
  return patchKeyed(container, Object.entries(parts).map(([key, html]) => ({ key, html })), { carry });
}

/**
 * `fn` once per animation frame however often `request()` is called before it (`setTimeout` 16 ms without
 * requestAnimationFrame). `flush()` runs a pending `fn` now; `cancel()` drops it. A background tab's frames pause, so a
 * pending `fn` waits until the tab is seen again.
 */
export function frameBatch(win, fn) {
  let pending = false, id = 0, raf = false, ask = 0;
  const run = (n) => { if (!pending || n !== ask) return; pending = false; fn(); };   // a frame that was cancelled does nothing
  const cancel = () => {
    if (!pending) return;
    pending = false;
    if (raf) win.cancelAnimationFrame?.(id); else win.clearTimeout?.(id);
  };
  return {
    request() {
      if (pending) return;
      pending = true;
      raf = typeof win.requestAnimationFrame === 'function';
      const n = ++ask;
      id = raf ? win.requestAnimationFrame(() => run(n)) : win.setTimeout(() => run(n), 16);
    },
    flush() { if (!pending) return; cancel(); fn(); },
    cancel,
  };
}
