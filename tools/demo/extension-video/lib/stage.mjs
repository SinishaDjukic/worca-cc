// tools/demo/extension-video/lib/stage.mjs — the demo stage: a closed-shadow overlay in the app page (captions, title
// cards, keycaps, cursor, spotlight) and the docked sidebar iframe. Node side builds the CSS; the page side is a
// small controller installed with page.evaluate and driven with window.__demoStage.
// The virtual camera (lib/camera.mjs) crops the recording in post. So that captions and keycaps come out at their
// normal size and place, they live in a HUD layer the page moves onto the camera's current crop every frame, with the
// same easing (serialised from camera.mjs). The cursor is scaled by the same factor; cards only show at the full stage.
import { readFileSync } from 'node:fs';
import { cutPiece, SHADOW_PIECES, toShadowTokens } from '../../../extension-css.mjs';
import { easeInOut, hudCapX } from './camera.mjs';

const ROOT = new URL('../../../../', import.meta.url);
const b64 = (rel) => readFileSync(new URL(rel, ROOT)).toString('base64');

export function stageCss() {
  const style = readFileSync(new URL('ui/public/style.css', ROOT), 'utf8');
  const tokens = toShadowTokens(cutPiece(style, SHADOW_PIECES.find((p) => p.name === 'tokens')).text);
  const font = (w) => `@font-face{font-family:'Stage Poppins';font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${b64(`ui/public/fonts/poppins-latin-${w}-normal.woff2`)}) format('woff2')}`;
  return `${[400, 500, 600, 700].map(font).join('\n')}\n${tokens}\n${readFileSync(new URL('../stage/stage.css', import.meta.url), 'utf8')}`;
}
export const logoDataUri = () => `data:image/png;base64,${b64('ui/public/assets/worca-logo.png')}`;

/** Dock sidebar.html (pinned to this tab) on the right; the app keeps the rest of the width. */
export async function mountSidebar(page, { extensionId, tabId, windowId, width = 440 }) {
  await page.evaluate(({ src, width }) => {
    const f = document.createElement('iframe');
    f.id = 'worca-demo-sidebar';
    f.src = src;
    f.allow = 'clipboard-read; clipboard-write';
    Object.assign(f.style, { position: 'fixed', top: '16px', right: '16px', bottom: '16px', width: `${width}px`, height: 'calc(100vh - 32px)',
      border: '0', borderRadius: '14px', boxShadow: '0 24px 60px -20px rgba(20,20,18,.35), 0 0 0 1px rgba(20,20,18,.08)',
      background: 'transparent', zIndex: '2147483000', transform: 'translateX(calc(100% + 32px))', transition: 'transform .7s cubic-bezier(.2,.8,.2,1)' });
    document.body.append(f);
  }, { src: `chrome-extension://${extensionId}/sidebar.html?tabId=${tabId}&windowId=${windowId}`, width });
  return page.frameLocator('#worca-demo-sidebar');
}

/** Slide the sidebar in and give the app the rest of the width. */
export const slideSidebarIn = (page, width = 440) => page.evaluate((width) => {
  document.documentElement.style.setProperty('transition', 'padding-right .7s cubic-bezier(.2,.8,.2,1)');
  document.documentElement.style.setProperty('padding-right', `${width + 32}px`, 'important');
  document.getElementById('worca-demo-sidebar').style.transform = 'translateX(0)';   // captions follow it (hudCapX)
}, width);

/** Install the overlay controller; returns helpers that call into it. */
export async function installStage(page) {
  await page.evaluate(({ css, logo, easeSrc, capXSrc }) => {
    const host = document.createElement('worca-demo-stage');
    Object.assign(host.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147483647' });
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${css}</style>
      <div class="card" data-card hidden><img class="logo" src="${logo}" alt=""><h1 data-t></h1><p data-s></p><div class="chips" data-chips></div></div>
      <div class="spot" data-spot></div>
      <div class="hud" data-hud><div class="cap" data-cap><span class="kick" data-k></span><strong data-t></strong><span class="sub" data-s></span></div>
      <div class="keys" data-keys></div></div>
      <svg class="cursor" data-cursor viewBox="0 0 24 24"><path d="M4 2l15 9.5-6.6 1.4L9 20z"/></svg>`;
    document.documentElement.append(host);
    const $ = (s) => root.querySelector(s);
    const ease = (0, eval)(`(${easeSrc})`); const capX = (0, eval)(`(${capXSrc})`);
    const full = () => ({ x: 0, y: 0, width: innerWidth, height: innerHeight });
    let cam = { from: full(), to: full(), t: 0, ms: 0 };
    const camAt = (now) => {
      const e = ease(cam.ms > 0 ? (now - cam.t) / cam.ms : 1);
      return Object.fromEntries(['x', 'y', 'width', 'height'].map((k) => [k, cam.from[k] + (cam.to[k] - cam.from[k]) * e]));
    };
    let capTimer = 0;
    const hud = $('[data-hud]');
    const frame = () => {
      const r = camAt(Date.now()); const s = r.width / innerWidth;
      hud.style.transform = `translate(${r.x}px,${r.y}px) scale(${s})`;
      host.style.setProperty('--cam-s', String(s));
      const side = document.getElementById('worca-demo-sidebar')?.getBoundingClientRect();
      hud.style.setProperty('--cap-x', `${capX(r, side && side.left < innerWidth ? side.left : null, innerWidth)}px`);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    window.__demoStage = {
      /** Start an eased move to `rect` (CSS px) from wherever the camera is; returns its start time (epoch ms). */
      camera(rect, ms) { const t = Date.now(); cam = { from: camAt(t), to: rect, t, ms }; return t; },
      card({ title, sub, chips = [], instant = false }) {
        const c = $('[data-card]');
        c.querySelector('[data-t]').textContent = title;
        c.querySelector('[data-s]').innerHTML = sub;
        c.querySelector('[data-chips]').replaceChildren(...chips.map((t) => Object.assign(document.createElement('span'), { textContent: t })));
        c.hidden = false;
        if (instant) c.classList.add('in');
        else requestAnimationFrame(() => requestAnimationFrame(() => c.classList.add('in')));
      },
      hideCard() { const c = $('[data-card]'); c.classList.remove('in'); setTimeout(() => { c.hidden = true; }, 800); },
      /** Show a caption and hide it by itself after `holdMs`: the script carries on while it is read. */
      caption({ kicker, title, sub }, holdMs) {
        const c = $('[data-cap]');
        clearTimeout(capTimer);
        if (holdMs) capTimer = setTimeout(() => c.classList.remove('in'), holdMs);
        c.querySelector('[data-k]').textContent = kicker;
        c.querySelector('[data-t]').textContent = title;
        c.querySelector('[data-s]').textContent = sub || '';
        c.classList.add('in');
      },
      hideCaption() { clearTimeout(capTimer); $('[data-cap]').classList.remove('in'); },
      keys(list) {
        const k = $('[data-keys]');
        k.replaceChildren(...list.map((t) => Object.assign(document.createElement('kbd'), { textContent: t })));
        k.classList.add('in');
        setTimeout(() => k.classList.remove('in'), 1400);
      },
      cursor(x, y, down) { const c = $('[data-cursor]'); c.style.setProperty('--cx', `${x}px`); c.style.setProperty('--cy', `${y}px`); c.classList.toggle('down', !!down); },
      spot(r) {
        const s = $('[data-spot]');
        if (!r) { s.classList.remove('in'); return; }
        Object.assign(s.style, { left: `${r.x - 8}px`, top: `${r.y - 8}px`, width: `${r.width + 16}px`, height: `${r.height + 16}px` });
        s.classList.add('in');
      },
      hidden(on) { host.style.visibility = on ? 'hidden' : 'visible'; },
    };
  }, { css: stageCss(), logo: logoDataUri(), easeSrc: easeInOut.toString(), capXSrc: hudCapX.toString() });
  const call = (fn, ...a) => page.evaluate(([fn, a]) => window.__demoStage[fn](...a), [fn, a]);
  return {
    card: (o) => call('card', o), hideCard: () => call('hideCard'), caption: (o, holdMs) => call('caption', o, holdMs), hideCaption: () => call('hideCaption'),
    keys: (l) => call('keys', l), cursor: (x, y, d) => call('cursor', x, y, d), spot: (r) => call('spot', r ?? null), hidden: (on) => call('hidden', on), camera: (rect, ms) => call('camera', rect, ms),
  };
}
