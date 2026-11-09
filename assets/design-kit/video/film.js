/* film.js — the video film player. One paused GSAP master timeline; the only clock is F.seek(t), so a frame is a
   pure function of film time and any seek order gives the same frame. Globals: gsap, FILM_PLAN
   ({w, h, fps, embedded, scenes: [{id, duration}]}). Scene scripts register with F.scene(id, build), and the doc calls
   F.start() once after them. On document: `filmtime` {t, playing, dur} on every render, `filmscene` {id} when the
   scene under the playhead changes. Embedded in worca the film waits for the parent; opened alone it plays, with
   keys and a bar. */
(function () {
  'use strict';
  const P = window.FILM_PLAN || {};
  const W = P.w || 1920, H = P.h || 1080, FPS = P.fps || 60;
  const embedded = !!P.embedded;

  // Each scene's window comes from the plan's durations, in plan order: start is the running sum.
  const windows = [];
  let sum = 0;
  for (const s of P.scenes || []) {
    const d = Number(s.duration);
    const dur = Number.isFinite(d) && d > 0 ? d : 0;
    windows.push({ id: String(s.id), start: sum, end: sum + dur, dur });
    sum += dur;
  }

  const F = window.F = {
    W, H, FPS, DUR: sum,
    master: gsap.timeline({ paused: true }),
    scenes: [], hooks: [], violations: [],
    t: 0, playing: false,
  };
  gsap.ticker.lagSmoothing(0);
  const violation = (msg) => { if (!F.violations.includes(msg)) { F.violations.push(msg); console.warn('[film] ' + msg); } };
  F.violation = violation;
  // A scene whose onFrame hook or tween callback threw: reported once per scene and kind, whatever each frame's
  // message, and the other scenes go on.
  const failed = new Set();
  const sceneFailed = (id, what, e) => {
    const key = id + ' ' + what;
    if (!failed.has(key)) { failed.add(key); violation(`scene ${id} ${what} failed: ${(e && e.stack) || e}`); }
  };

  // GSAP runs these inside the master's render with no try, so one that threw stopped the seek, the start or the play
  // loop of the whole film (review M1): a count-up whose element is missing is the usual one.
  const CALLBACKS = ['onStart', 'onUpdate', 'onComplete', 'onRepeat', 'onReverseComplete', 'onInterrupt'];
  const guarded = new WeakSet();
  /** Every animation under a timeline, a tween's own timeline too: keyframe and stagger callbacks live on its children. */
  function animationsOf(tl) {
    const all = [];
    const walk = (a) => {
      all.push(a);
      if (a.timeline) walk(a.timeline);
      if (typeof a.getChildren === 'function') for (const c of a.getChildren(false, true, true)) walk(c);
    };
    walk(tl);
    return all;
  }
  /** Wraps every callback of a scene's timeline (`tl.call` is an onComplete and an onReverseComplete) in a try. */
  function guardCallbacks(S) {
    for (const a of animationsOf(S.tl)) {
      for (const type of CALLBACKS) {
        const fn = a.vars && a.vars[type];
        if (typeof fn !== 'function' || guarded.has(fn)) continue;
        const safe = function () {
          try { return fn.apply(this, arguments); } catch (e) { sceneFailed(S.id, type, e); }
        };
        guarded.add(safe);
        a.eventCallback(type, safe);   // the params stay: eventCallback writes them only when given
      }
    }
  }

  const stage = document.querySelector('[data-film]');
  const rootOf = (id) => {
    if (stage) for (const el of stage.children) if (el.getAttribute('data-section') === id) return el;
    return null;
  };

  /** mulberry32: the same seed gives the same sequence on every render. */
  const random = (seed) => {
    let a = seed | 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  function makeScene(w, root) {
    const S = { id: w.id, start: w.start, end: w.end, dur: w.dur, root, tl: gsap.timeline() };
    S.onFrame = (fn) => {
      F.hooks.push((t) => {
        try { fn(t - S.start, t); } catch (e) { sceneFailed(S.id, 'onFrame', e); }
      });
    };
    /** Scene entrance on the scene root. kinds: cut | fade | zoom | slide-left | slide-up | iris | drop */
    S.enter = (kind = 'cut', { at = 0, dur = 0.45 } = {}) => {
      const tl = S.tl, r = S.root;
      if (kind === 'fade') tl.fromTo(r, { opacity: 0 }, { opacity: 1, duration: dur, immediateRender: false }, at);
      else if (kind === 'zoom') tl.fromTo(r, { scale: 1.18, opacity: 0 }, { scale: 1, opacity: 1, duration: dur, ease: 'power3.out', immediateRender: false }, at);
      else if (kind === 'slide-left') tl.fromTo(r, { xPercent: 100 }, { xPercent: 0, duration: dur, ease: 'power3.out', immediateRender: false }, at);
      else if (kind === 'slide-up') tl.fromTo(r, { yPercent: 100 }, { yPercent: 0, duration: dur, ease: 'power3.out', immediateRender: false }, at);
      else if (kind === 'iris') tl.fromTo(r, { clipPath: 'circle(0.1px at 50% 50%)' }, { clipPath: 'circle(75% at 50% 50%)', duration: dur, ease: 'power2.inOut', immediateRender: false }, at);
      else if (kind === 'drop') tl.fromTo(r, { yPercent: -100 }, { yPercent: 0, duration: dur, ease: 'bounce.out', immediateRender: false }, at);
      return S;
    };
    /** Scene exit, ending at the scene's window end. kinds: cut | fade | zoom | slide-left | slide-up | iris */
    S.exit = (kind = 'cut', { dur = 0.4 } = {}) => {
      const at = S.dur - dur, tl = S.tl, r = S.root;
      if (kind === 'fade') tl.to(r, { opacity: 0, duration: dur }, at);
      else if (kind === 'zoom') tl.to(r, { scale: 1.25, opacity: 0, duration: dur, ease: 'power3.in' }, at);
      else if (kind === 'slide-left') tl.to(r, { xPercent: -100, duration: dur, ease: 'power3.in' }, at);
      else if (kind === 'slide-up') tl.to(r, { yPercent: -100, duration: dur, ease: 'power3.in' }, at);
      else if (kind === 'iris') tl.to(r, { clipPath: 'circle(0.1px at 50% 50%)', duration: dur, ease: 'power2.inOut' }, at);
      return S;
    };
    S.random = random;
    return S;
  }

  /* ---------- registration + start ---------- */
  const defs = [];
  /** Register a scene's script: F.scene(id, function (root, S) { … }). Timing comes from FILM_PLAN. */
  F.scene = (id, build) => { defs.push({ id: String(id), build }); };

  let started = false, last = null, bar = null;

  F.start = function () {
    if (started) return;
    started = true;
    windows.forEach((w, i) => {
      const root = rootOf(w.id);
      const S = makeScene(w, root);
      F.scenes.push(S);
      // The display the author gave the root, read before anything hides it: a flex root stays flex at play.
      let display = 'block';
      if (root) { display = getComputedStyle(root).display; if (!display || display === 'none') display = 'block'; }
      const def = defs.find((d) => d.id === w.id);
      if (root && def) {
        // A build (or its first render) that throws part-way leaves the composed state: its tweens and its hooks go.
        const hooks = F.hooks.length;
        try {
          def.build(root, S);
          guardCallbacks(S);
          // The scene rendered once alone, so a function-based value that throws throws here. The soft invalidate
          // lets the master's prime below record every start value again, in film order (a later scene's tween of a
          // target an earlier scene moved starts where that scene left it).
          S.tl.progress(1, true).progress(0, true).invalidate(true);
        } catch (e) {
          F.hooks.length = hooks;
          S.tl.clear();
          violation(`scene ${w.id} build failed: ${(e && e.stack) || e}`);
        }
      }
      if (S.tl.duration() > S.dur + 0.001) violation(`scene ${w.id} timeline runs ${S.tl.duration().toFixed(2)}s > its ${S.dur.toFixed(2)}s window`);
      // A scene with no element keeps its window, and the stage shows black there. The root's show goes in before the
      // scene's timeline at the same time, so GSAP starts the scene's tweens up (and runs their function values, in the
      // prime below too) with the root shown: a value that measures layout reads the scene as it plays (review cycle 3).
      if (root) {
        gsap.set(root, { display: 'none' });
        F.master.set(root, { display }, w.start);
      }
      F.master.add(S.tl, w.start);
      // The last scene stays displayed at the film's end: a player stops there, and a black end is a bug.
      if (root && i < windows.length - 1) F.master.set(root, { display: 'none' }, w.end);
    });
    // keep the master exactly the film's length
    F.master.set({}, {}, F.DUR);
    for (const d of defs) if (!windows.some((w) => w.id === d.id)) violation('script for unknown scene ' + d.id);
    // Prime: render the whole film once forward and back, so every tween records its start values in timeline
    // order now, and a first seek to any time renders exactly what continuous playback would.
    let held = null;
    try {
      try {
        F.master.progress(1, true).progress(0, true);
      } finally {
        // Fitted right after the prime, whatever it threw: a function value measures the stage at its own size, whatever
        // the window's, and the first frame already sees the fitted stage.
        fit();
        addEventListener('resize', fit);
      }
      if (!embedded) { held = heldTime(); alone(); }
      render(held == null ? 0 : held);
    } finally {
      // Shown whatever threw on the way: a hidden stage blacks out every good scene with the bad one.
      if (stage) stage.style.visibility = 'visible';
    }
    if (!embedded && held == null && !reduced()) F.play();
  };

  /* ---------- render + clock ---------- */
  const clamp = (t) => Math.max(0, Math.min(F.DUR, t));
  const sceneAt = (t) => F.scenes.find((s) => t >= s.start && t < s.end) || F.scenes[F.scenes.length - 1];
  const emit = (type, detail) => document.dispatchEvent(new CustomEvent(type, { detail }));

  function render(t) {
    F.t = t;
    // +1 µs: a seek that lands exactly on a scene's start (from a later time) would otherwise revert that scene's
    // zero-time set()s (GSAP renders zero-duration tweens at their own start as "before" when moving backwards).
    F.master.totalTime(Math.min(F.DUR, t + 1e-6), false);
    for (const h of F.hooks) h(t);
    if (bar) bar.firstChild.style.width = (F.DUR ? (t / F.DUR) * 100 : 0) + '%';
    emit('filmtime', { t, playing: F.playing, dur: F.DUR });
    const s = sceneAt(t);
    if (s && s.id !== last) { last = s.id; emit('filmscene', { id: s.id }); }
  }

  // The clock is this file's own requestAnimationFrame loop, anchored at play() and re-anchored by a seek.
  let wall0 = 0, t0 = 0, frame = 0, pending = false;
  function schedule() { if (!pending) { pending = true; frame = requestAnimationFrame(tick); } }
  function tick() {
    pending = false;
    if (!F.playing) return;
    const t = t0 + (performance.now() - wall0) / 1000;
    if (t >= F.DUR) { F.playing = false; render(F.DUR); return; }
    // The next frame is asked for whatever this one threw: a frame that throws must not leave play stuck on.
    try { render(t); } finally { schedule(); }
  }

  /** The one clock: render film time t (seconds), clamped to [0, DUR]. While playing, play carries on from t. */
  F.seek = function (t) {
    if (!started) return;
    const x = Number(t);
    if (!Number.isFinite(x)) return;
    const c = clamp(x);
    if (F.playing) { wall0 = performance.now(); t0 = c; }
    render(c);
  };

  F.play = function () {
    if (!started) return;
    const from = F.t >= F.DUR - 1e-3 ? 0 : F.t;
    F.playing = true; wall0 = performance.now(); t0 = from;
    render(from);
    schedule();
  };

  F.pause = function () {
    if (!started) return;
    F.playing = false;
    if (pending) { cancelAnimationFrame(frame); pending = false; }
    render(F.t);
  };

  /* ---------- stage fit ---------- */
  function fit() {
    if (!stage) return;
    const s = Math.min(innerWidth / W, innerHeight / H);
    stage.style.transform = `translate(${(innerWidth - W * s) / 2}px, ${(innerHeight - H * s) / 2}px) scale(${s})`;
  }

  /* ---------- opened alone: keys, a bar, autoplay ---------- */
  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function heldTime() {
    const m = /^#t=([\d.]+)$/.exec(location.hash);
    const v = m ? Number(m[1]) : NaN;
    return Number.isFinite(v) ? clamp(v) : null;
  }
  const toggle = () => (F.playing ? F.pause() : F.play());
  function onKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;   // browser shortcuts (Cmd+←, Alt+←) stay the browser's
    const fr = 1 / FPS;
    if (e.key === ' ') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); F.seek(F.t + (e.shiftKey ? fr : 1)); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); F.seek(F.t - (e.shiftKey ? fr : 1)); }
    else if (e.key === 'Home') { e.preventDefault(); F.seek(0); }
    else if (e.key === 'End') { e.preventDefault(); F.seek(F.DUR); }
  }
  function alone() {
    bar = document.createElement('div');
    bar.setAttribute('data-film-bar', '');
    bar.appendChild(document.createElement('i'));
    document.body.appendChild(bar);
    bar.addEventListener('click', (e) => {
      const r = bar.getBoundingClientRect();
      F.seek(((e.clientX - r.left) / (r.width || innerWidth)) * F.DUR);
    });
    if (stage) stage.addEventListener('click', toggle);
    document.addEventListener('keydown', onKey);
  }
})();
