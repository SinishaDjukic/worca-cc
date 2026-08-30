/* deck-enhance.js
 * Adds three behaviors on top of <deck-stage>:
 *   1) keyboard-stepped reveals via [data-step] (←/→ steps; advances slide
 *      only when current slide has no more steps)
 *   2) hover tooltips via [data-tip]
 *   3) slide entrance class (.is-active) so CSS can fade title blocks in
 *
 * Deferred boot: in a Design Component the <deck-stage> element mounts after
 * this script runs, so we poll until it exists before wiring anything up.
 */
(function () {
  function run(stage) {
  if (window.__deckEnhanceRan) return;
  window.__deckEnhanceRan = true;

  function slides() {
    return Array.from(stage.children).filter((c) => c.tagName === 'SECTION');
  }

  // ---- Step state -------------------------------------------------------
  const slideStep = new WeakMap(); // section -> current step (0 = none revealed)

  function applyStep(slide, step) {
    const all = slide.querySelectorAll('[data-step]');
    all.forEach((el) => {
      const s = parseInt(el.getAttribute('data-step'), 10) || 0;
      el.classList.toggle('step-visible', s <= step);
      el.classList.toggle('step-current', s === step);
      el.classList.toggle('step-past', s > 0 && s < step);
    });
    slideStep.set(slide, step);
    updateDots(slide, step);
  }

  function maxStep(slide) {
    let m = 0;
    slide.querySelectorAll('[data-step]').forEach((el) => {
      const s = parseInt(el.getAttribute('data-step'), 10) || 0;
      if (s > m) m = s;
    });
    return m;
  }

  function ensureDots(slide) {
    const m = maxStep(slide);
    let dots = slide.querySelector('.step-dots');
    if (m === 0) {
      if (dots) dots.remove();
      return null;
    }
    if (!dots) {
      dots = document.createElement('div');
      dots.className = 'step-dots';
      for (let i = 1; i <= m; i++) {
        const d = document.createElement('span');
        d.className = 'dot';
        d.dataset.idx = String(i);
        dots.appendChild(d);
      }
      slide.appendChild(dots);
    }
    dots.classList.add('has-steps');
    return dots;
  }

  function updateDots(slide, step) {
    const dots = slide.querySelector('.step-dots');
    if (!dots) return;
    [...dots.children].forEach((d, i) => {
      const idx = i + 1;
      d.classList.toggle('on', idx <= step);
      d.classList.toggle('current', idx === step);
    });
  }

  function initSlide(slide) {
    ensureDots(slide);
    applyStep(slide, 0);
  }

  function activate(idx) {
    slides().forEach((s, i) => s.classList.toggle('is-active', i === idx));
    const s = slides()[idx];
    if (s && !slideStep.has(s)) initSlide(s);
  }

  // ---- Init -------------------------------------------------------------
  function initAll() {
    slides().forEach(initSlide);
    activate(0);
  }

  initAll();

  // Track active slide via deck-stage's postMessage
  let currentIdx = 0;
  window.addEventListener('message', (e) => {
    if (e.data && typeof e.data.slideIndexChanged === 'number') {
      currentIdx = e.data.slideIndexChanged;
      const s = slides()[currentIdx];
      if (s) applyStep(s, 0);
      activate(currentIdx);
    }
  });

  // ---- Edit-mode detection --------------------------------------------
  function isInEditMode() {
    const ae = document.activeElement;
    if (ae && (ae.isContentEditable || /^(input|textarea|select)$/i.test(ae.tagName))) return true;
    if (document.querySelector('[contenteditable="true"]')) return true;
    if (document.querySelector('[data-cc-id], [data-dm-ref], [data-om-edit]')) return true;
    if (document.body && (document.body.classList.contains('om-editing') ||
                          document.body.classList.contains('om-edit-mode') ||
                          document.body.dataset.editMode === 'true')) return true;
    return false;
  }

  // ---- Key interception (capture phase, before deck-stage) --------------
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      const navKey = (
        k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' ||
        k === ' ' || k === 'Spacebar' ||
        k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' ||
        k === 'Backspace' || k === 'Home' || k === 'End'
      );

      if (isInEditMode()) {
        if (navKey || k === 'f' || k === 'F' || k === 's' || k === 'S') e.stopImmediatePropagation();
        return;
      }

      if (k === 'f' || k === 'F') {
        e.stopImmediatePropagation();
        e.preventDefault();
        toggleFullscreen();
        return;
      }

      if (k === 's' || k === 'S') {
        e.stopImmediatePropagation();
        e.preventDefault();
        toggleRail();
        return;
      }

      const slide = slides()[currentIdx];
      if (!slide) return;
      const m = maxStep(slide);
      const cur = slideStep.get(slide) || 0;

      const FWD = (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Spacebar');
      const BACK = (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace');
      const UPDOWN = (k === 'ArrowUp' || k === 'ArrowDown');

      if (m > 0 && FWD && cur < m) {
        e.stopImmediatePropagation();
        e.preventDefault();
        applyStep(slide, cur + 1);
        return;
      }
      if (m > 0 && BACK && cur > 0) {
        e.stopImmediatePropagation();
        e.preventDefault();
        applyStep(slide, cur - 1);
        return;
      }

      if (UPDOWN) {
        e.stopImmediatePropagation();
        e.preventDefault();
        if (FWD) stage.next && stage.next();
        else if (BACK) stage.prev && stage.prev();
      }
    },
    true
  );

  // ---- Fullscreen helper -----------------------------------------------
  function toggleFullscreen() {
    const el = document.documentElement;
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    try {
      if (!isFs) {
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (req) req.call(el);
      } else {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) exit.call(document);
      }
    } catch (err) { /* fullscreen denied (e.g. iframe perms) — silent */ }
  }

  // The Fullscreen API isn't available for arbitrary elements on iOS (every
  // iOS browser is WebKit), so the button would be a dead control there. Detect
  // real support and omit it when missing — which also frees bar width.
  const fsDocEl = document.documentElement;
  const FS_SUPPORTED = !!(
    (document.fullscreenEnabled || document.webkitFullscreenEnabled) &&
    (fsDocEl.requestFullscreen || fsDocEl.webkitRequestFullscreen)
  );

  // ---- Thumbnail rail toggle ------------------------------------------
  let railVisible = true;
  try {
    railVisible = localStorage.getItem('deck-stage.railVisible') !== '0';
  } catch (e) {}
  function toggleRail() {
    railVisible = !railVisible;
    try { window.postMessage({ type: '__deck_rail_visible', on: railVisible }, '*'); } catch (e) {}
  }

  // ---- Inject "Fullscreen (F)" + "Slides (S)" buttons into overlay ----
  function injectFullscreenBtn() {
    const sr = stage.shadowRoot;
    if (!sr) return;
    const reset = sr.querySelector('.btn.reset');
    if (!reset) return;
    // Guard on the rail button (always inserted) so a missing Fullscreen button
    // on unsupported platforms doesn't defeat the re-entry check.
    if (sr.querySelector('.btn.rail-toggle')) return;

    const mkDivider = () => { const d = document.createElement('span'); d.className = 'divider'; return d; };
    const mkBtn = (label, kbd, title, handler, extraClass) => {
      const b = document.createElement('button');
      b.className = 'btn reset ' + extraClass;
      b.type = 'button';
      b.setAttribute('aria-label', title);
      b.setAttribute('title', title);
      b.innerHTML = label + '<span class="kbd">' + kbd + '</span>';
      b.addEventListener('click', handler);
      return b;
    };

    // Reset │ [Fullscreen │] Slides — Fullscreen is omitted where the API
    // isn't usable (e.g. iOS), which also keeps the bar from overflowing.
    const nodes = [mkDivider()];
    if (FS_SUPPORTED) {
      nodes.push(mkBtn('Fullscreen', 'F', 'Fullscreen (F)', toggleFullscreen, 'fullscreen'));
      nodes.push(mkDivider());
    }
    nodes.push(mkBtn('Slides', 'S', 'Toggle slide list (S)', toggleRail, 'rail-toggle'));

    let after = reset;
    for (const n of nodes) {
      reset.parentNode.insertBefore(n, after.nextSibling);
      after = n;
    }
  }

  let injectTries = 0;
  function tryInject() {
    injectFullscreenBtn();
    if (!stage.shadowRoot || !stage.shadowRoot.querySelector('.btn.rail-toggle')) {
      if (++injectTries < 120) setTimeout(tryInject, 50);
    }
  }
  tryInject();

  // ---- On-screen prev/next button interception -------------------------
  window.addEventListener(
    'click',
    (e) => {
      if (isInEditMode()) return;
      const path = (typeof e.composedPath === 'function') ? e.composedPath() : [];
      let isNext = false, isPrev = false;
      for (const n of path) {
        if (n && n.classList) {
          // The control-bar buttons (.next/.prev) and the mobile tap zones
          // (.tapzone--fwd/.tapzone--back) share ONE step-then-slide path: a
          // forward gesture reveals the next [data-step] and only advances the
          // slide once the current slide's steps are exhausted. Without the
          // tapzone classes here, taps would fall through to deck-stage and jump
          // a whole slide, skipping the animation.
          if (n.classList.contains('next') || n.classList.contains('tapzone--fwd')) { isNext = true; break; }
          if (n.classList.contains('prev') || n.classList.contains('tapzone--back')) { isPrev = true; break; }
        }
      }
      if (!isNext && !isPrev) return;

      const slide = slides()[currentIdx];
      if (!slide) return;
      const m = maxStep(slide);
      if (m === 0) return;
      const cur = slideStep.get(slide) || 0;

      if (isNext && cur < m) {
        e.stopImmediatePropagation();
        e.preventDefault();
        applyStep(slide, cur + 1);
      } else if (isPrev && cur > 0) {
        e.stopImmediatePropagation();
        e.preventDefault();
        applyStep(slide, cur - 1);
      }
    },
    true
  );

  // ---- Tooltip ----------------------------------------------------------
  const tip = document.createElement('div');
  tip.id = 'deck-tip';
  document.body.appendChild(tip);

  let tipTarget = null;
  function positionTip(target) {
    const wasShown = tip.classList.contains('show');
    if (!wasShown) {
      tip.style.visibility = 'hidden';
      tip.classList.add('show');
    }
    const tipW = tip.offsetWidth;
    const tipH = tip.offsetHeight;
    if (!wasShown) {
      tip.classList.remove('show');
      tip.style.visibility = '';
    }

    const r = target.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 12;
    const gap = 14;

    const spaceAbove = r.top;
    const spaceBelow = vh - r.bottom;
    let placeAbove = spaceAbove >= tipH + gap + margin || spaceAbove >= spaceBelow;
    if (placeAbove && spaceAbove < tipH + gap + margin) placeAbove = false;

    let top;
    if (placeAbove) {
      top = Math.max(margin, r.top - tipH - gap);
    } else {
      top = Math.min(vh - tipH - margin, r.bottom + gap);
    }

    const centerX = r.left + r.width / 2;
    let left = centerX - tipW / 2;
    left = Math.max(margin, Math.min(vw - tipW - margin, left));

    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
    tip.style.transform = 'none';

    const arrowX = Math.max(14, Math.min(tipW - 14, centerX - left));
    tip.style.setProperty('--tip-arrow-x', arrowX + 'px');
    tip.classList.toggle('below', !placeAbove);
  }

  document.addEventListener('mouseover', (e) => {
    const t = e.target && e.target.closest && e.target.closest('[data-tip]');
    if (!t) return;
    const hiddenStep = t.closest('[data-step]:not(.step-visible)');
    if (hiddenStep) return;
    tipTarget = t;
    tip.textContent = t.getAttribute('data-tip');
    positionTip(t);
    tip.classList.add('show');
  });
  document.addEventListener('mouseout', (e) => {
    const t = e.target && e.target.closest && e.target.closest('[data-tip]');
    if (!t) return;
    if (tipTarget === t) {
      tip.classList.remove('show');
      tipTarget = null;
    }
  });
  window.addEventListener('scroll', () => { if (tipTarget) positionTip(tipTarget); }, true);
  window.addEventListener('resize', () => { if (tipTarget) positionTip(tipTarget); });

  // Safety net: if deck-stage re-slots or re-clones its sections, re-init any
  // new slides and re-apply the active class so content never stays hidden.
  try {
    const mo = new MutationObserver(() => {
      slides().forEach((s) => { if (!slideStep.has(s)) initSlide(s); });
      activate(currentIdx);
    });
    mo.observe(stage, { childList: true });
  } catch (e) {}

  } // end run()

  // ---- Deferred boot: wait for <deck-stage> AND its slides to mount ----
  // In a Design Component the <deck-stage> element is created/upgraded a tick
  // before its <section> children are slotted in, so we must wait for the
  // sections to actually be present — not just the element. We poll with
  // setTimeout (not requestAnimationFrame, which is paused when the preview
  // tab isn't in the foreground) and also boot on customElements upgrade.
  let bootTries = 0;
  function tryRun() {
    const stage = document.querySelector('deck-stage');
    if (stage && stage.querySelectorAll('section').length > 0) { run(stage); return true; }
    return false;
  }
  function boot() {
    if (tryRun()) return;
    if (++bootTries < 600) setTimeout(boot, 50);
  }
  if (window.customElements && customElements.whenDefined) {
    customElements.whenDefined('deck-stage').then(() => setTimeout(tryRun, 0));
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
