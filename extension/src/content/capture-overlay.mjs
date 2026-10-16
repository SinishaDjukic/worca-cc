// extension/src/content/capture-overlay.mjs — the area capture's overlay: a Shadow-DOM layer (closed; open in test builds)
// that dims the page with a crosshair. Drag a rectangle, Esc (or a right click) cancels. Only trusted input counts.
// The overlay is GONE (and two frames painted) before onDone, so it never appears in the screenshot.
import { normalizeRect, MIN_SIDE } from '../capture-geometry.mjs';

/** @param {{doc:Document, win:Window, css:string, open:boolean, onDone:(rect:object, skip:(n:Node)=>boolean)=>void, onCancel:()=>void}} o → cancel() */
export function startCapture({ doc, win, css, open, onDone, onCancel }) {
  const mount = (tag) => { const h = doc.createElement(tag); h.setAttribute('data-worca-capture', ''); return { h, r: h.attachShadow({ mode: open ? 'open' : 'closed' }) }; };
  let made;
  try { made = mount('worca-capture'); } catch { made = mount('div'); }
  const { h: host, r: root } = made;
  for (const [k, v] of [['position', 'fixed'], ['inset', '0'], ['z-index', '2147483647'], ['display', 'block']]) host.style.setProperty(k, v, 'important');
  try { const s = new win.CSSStyleSheet(); s.replaceSync(css); root.adoptedStyleSheets = [s]; } catch { const s = doc.createElement('style'); s.textContent = css; root.append(s); }
  const layer = doc.createElement('div'); layer.className = 'wx-cap';
  const box = doc.createElement('div'); box.className = 'wx-cap-box'; box.hidden = true;
  const hint = doc.createElement('div'); hint.className = 'wx-cap-hint'; hint.textContent = 'Drag to capture an area · Esc to cancel';
  layer.append(box, hint);
  root.append(layer);
  doc.documentElement.append(host);
  const viewport = () => ({ width: win.innerWidth, height: win.innerHeight });
  let start = null; let done = false;
  const end = () => { done = true; win.removeEventListener('keydown', onKey, true); host.remove(); };
  const cancel = () => { if (done) return; end(); onCancel(); };
  const onKey = (e) => { if (e.isTrusted && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(); } };
  layer.addEventListener('pointerdown', (e) => {
    if (!e.isTrusted) return;
    e.preventDefault();
    if (e.button !== 0) { cancel(); return; }
    start = { x: e.clientX, y: e.clientY };
    layer.setPointerCapture?.(e.pointerId);
    layer.classList.add('is-dragging');
  });
  layer.addEventListener('pointermove', (e) => {
    if (!start || !e.isTrusted) return;
    const r = normalizeRect(start, { x: e.clientX, y: e.clientY }, viewport());
    Object.assign(box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
    box.hidden = false;
  });
  layer.addEventListener('pointerup', (e) => {
    if (!start || !e.isTrusted || done) return;
    const r = normalizeRect(start, { x: e.clientX, y: e.clientY }, viewport());
    start = null;
    if (r.width < MIN_SIDE || r.height < MIN_SIDE) { cancel(); return; }
    host.style.setProperty('display', 'none', 'important');   // out of elementsFromPoint and out of the screenshot
    const isHost = (n) => n === host;
    end();
    win.requestAnimationFrame(() => win.requestAnimationFrame(() => onDone(r, isHost)));
  });
  layer.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); });
  win.addEventListener('keydown', onKey, true);
  return cancel;
}
