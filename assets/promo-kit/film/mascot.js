/* mascot.js — the mascot crew: round clay creatures in profile (one eye, a long nose that does the work,
   two antennae, stubby legs — no arms or hands, like the reference), drawn in SVG with clay shading. API: CONTRACT.md "Mascot API" (+ a few extras, see the bottom).

   How it works: while a scene builds, every action records data — locomotion segments, additive effects,
   pose layers, FX — in plain JS. One per-frame hook (pushed into F.hooks) evaluates the whole rig as a pure
   function of the scene's local time (t - tl.startTime()) and writes SVG attributes. Nothing on the mascot is
   tweened by GSAP, so actions at arbitrary times compose (walk while waving, squash twice, hop mid-walk) and the
   export can seek frames in any order. The only build-time side effects are sound cues and an empty tl.set() at
   the end of each action (so kit flags a mascot action that overruns its scene).

   Scene authors may tween `m.el` themselves (x/y/rotation/scale/opacity — it is a 0×0 box at the ground point,
   positioned through left/top); the rig never writes its transform. */
(function () {
  'use strict';
  const SVGNS = 'http://www.w3.org/2000/svg';
  const W = 1920, H = 1080, TAU = Math.PI * 2, RAD = Math.PI / 180;
  const INK = '#19191B';

  /* ---------- math + easing (pure) ---------- */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, u) => a + (b - a) * u;
  const c01 = (u) => clamp(u, 0, 1);
  const smooth = (u) => { u = c01(u); return u * u * (3 - 2 * u); };
  const sio = (u) => 0.5 - 0.5 * Math.cos(Math.PI * c01(u));
  const p2o = (u) => { u = c01(u); return 1 - (1 - u) * (1 - u); };
  const p2i = (u) => { u = c01(u); return u * u; };
  const p3o = (u) => { u = c01(u); return 1 - (1 - u) ** 3; };
  const p3io = (u) => { u = c01(u); return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2; };
  const backOut = (u, s = 1.9) => { u = c01(u) - 1; return u * u * ((s + 1) * u + s) + 1; };
  const backIn = (u, s = 1.7) => { u = c01(u); return u * u * ((s + 1) * u - s); };
  const bump = (u) => (u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u));
  /** damped oscillation that starts at 1 (an impulse settling): freq Hz, decay 1/s */
  const ring = (tau, freq, decay) => (tau < 0 ? 0 : Math.exp(-decay * tau) * Math.cos(TAU * freq * tau));
  /** 0→1 window with fades: 1 inside [a+fi, b-fo] */
  const win = (t, a, b, fi, fo) => (t < a || t > b ? 0 : Math.min(fi > 0 ? smooth((t - a) / fi) : 1, fo > 0 ? smooth((b - t) / fo) : 1));
  const f2 = (v) => String(Math.round(v * 100) / 100);
  const EASES = { linear: (u) => c01(u), sine: sio, power2out: p2o, power2in: p2i, power3out: p3o, power3inout: p3io, back: backOut, backin: backIn, smooth };
  const easeOf = (e, d) => (typeof e === 'function' ? e : EASES[String(e || '').replace(/[^a-z0-9]/gi, '').toLowerCase()] || d);

  /** seeded PRNG (mulberry32) */
  function prng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

  /* ---------- colour ---------- */
  const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  /** k > 0 mixes toward white, k < 0 toward black */
  const tint = (c, k) => '#' + rgb(c).map((v) => clamp(Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k)), 0, 255).toString(16).padStart(2, '0')).join('');
  /** warm shadow: toward a deep red-brown rather than black, like clay */
  const shade = (c, k) => { const [r, g, b] = rgb(c); const T = [70, 22, 12]; return '#' + [r, g, b].map((v, i) => clamp(Math.round(lerp(v, T[i], k)), 0, 255).toString(16).padStart(2, '0')).join(''); };

  /* ---------- SVG helpers ---------- */
  function S(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function setA(e, k, v) { const c = e.__c || (e.__c = {}); if (c[k] !== v) { c[k] = v; e.setAttribute(k, v); } }
  function setSt(e, k, v) { const c = e.__s || (e.__s = {}); if (c[k] !== v) { c[k] = v; e.style[k] = v; } }
  function vis(e, on) { setA(e, 'display', on ? 'inline' : 'none'); }
  const circleD = (cx, cy, r) => `M${f2(cx - r)} ${f2(cy)}a${f2(r)} ${f2(r)} 0 1 0 ${f2(2 * r)} 0a${f2(r)} ${f2(r)} 0 1 0 ${f2(-2 * r)} 0Z`;
  /** tapered capsule between circle (x1,y1,r1) and (x2,y2,r2) */
  function capsule(x1, y1, r1, x2, y2, r2) {
    const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy);
    if (d <= Math.abs(r2 - r1) + 0.01) { const big = r2 >= r1 ? [x2, y2, r2] : [x1, y1, r1]; return circleD(big[0], big[1], big[2]); }
    const th = Math.atan2(dy, dx), al = Math.acos(clamp((r1 - r2) / d, -1, 1));
    const P = (cx, cy, r, a) => f2(cx + r * Math.cos(a)) + ' ' + f2(cy + r * Math.sin(a));
    return `M${P(x1, y1, r1, th + al)}L${P(x2, y2, r2, th + al)}A${f2(r2)} ${f2(r2)} 0 ${r2 > r1 ? 1 : 0} 0 ${P(x2, y2, r2, th - al)}`
      + `L${P(x1, y1, r1, th - al)}A${f2(r1)} ${f2(r1)} 0 ${r1 > r2 ? 1 : 0} 0 ${P(x1, y1, r1, th + al)}Z`;
  }
  /** 2D affine [a b c d e f] (SVG matrix order) */
  const mat = {
    id: () => [1, 0, 0, 1, 0, 0],
    mul: (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]],
    tr: (x, y) => [1, 0, 0, 1, x, y],
    rot: (deg) => { const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD); return [c, s, -s, c, 0, 0]; },
    sc: (x, y) => [x, 0, 0, y == null ? x : y, 0, 0],
    ap: (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]],
    str: (m) => `matrix(${m.map((v) => f2(v)).join(' ')})`,
  };

  /* ---------- the crew ---------- */
  // body tint, default headwear (slots: head / face / neck), default prop
  const VARIANTS = {
    clarifier: { body: '#F0A276', head: 'beanie', prop: 'sign-q' },
    planner:   { body: '#E9A23B', face: 'glasses', prop: 'blueprint' },
    refiner:   { body: '#B4572F', head: 'grad', prop: 'pencil' },
    builder:   { body: '#D9805F', head: 'cap', prop: 'cart' },
    reviewer:  { body: '#D8474F', head: 'detective', prop: 'magnifier' },
    boss:      { body: '#B25A3B', head: 'flatcap', neck: 'tie', lanyard: true, prop: 'clipboard' },
    plain:     { body: '#D9805F' },
  };
  const HAT_SLOT = { cap: 'head', hardhat: 'head', beret: 'head', detective: 'head', fedora: 'head', crown: 'head', party: 'head',
    beanie: 'head', grad: 'head', mortarboard: 'head', flatcap: 'head', glasses: 'face', tie: 'neck' };
  const HAT_ALIAS = { fedora: 'detective', mortarboard: 'grad' };
  const PROP_NAMES = ['sign-q', 'magnifier', 'clipboard', 'blueprint', 'cart', 'hammer', 'pencil', 'whistle', 'stamp', 'coffee', 'flag', 'wrench'];

  /* ---------- rig (units: body height = 100, ground point = 0,0, facing right) ---------- */
  const R = 42;                 // ball radius
  const LEG = 16;               // visible leg below the ball
  const BALL_Y = -(LEG + R);    // ball centre at rest (-58)
  const LEG_W = 11;             // leg thickness (round caps)
  const FOOT_Y = -LEG_W / 2;    // leg end point when planted
  const HIP_IN = 7;             // hips sit this far inside the ball, above its bottom
  const HIPS = [-5, 6];         // [near, far] hip x in facing coords (ball centre = 0)
  const NOSE = { x: 15, y: 16, len: 35, r0: 6.4, r1: 7.7, ang: 5 };
  const EYE = { x: 28, y: -8, rx: 6.5, ry: 8.4 };

  // base pose (no arms: the nose, antennae and body do all the gesturing)
  const BASE = { pRot: 0, pDx: 0, pDy: 0, pS2: 1, nA: 0, nL: 1, eS: 1, pS: 1, lx: 0, ly: 0,
    lidT: 0, lidB: 0, lidA: 0, brO: 0, brA: 0, brY: 0, blush: 0, hap: 0, spiral: 0, squeeze: 0, sweat: 0, antD: 0, antP: 0,
    sq: 0, by: 0, tilt: 0, rot: 0, ox: 0, oy: 0, shk: 0, shadow: 1, cartDx: 0, whistle: 0, lens: 0, antW: 0, antL: 0, tick: 0 };
  const EXPR = {
    neutral: {},
    happy: { lidB: 0.34, pS: 1.06, blush: 0.8, antP: 0.5 },
    worried: { brO: 1, brA: -22, brY: -1.5, pS: 0.8, eS: 1.05, antD: 0.6, sweat: 1, ly: 0.2 },
    surprised: { eS: 1.2, pS: 0.64, brO: 1, brY: -5.5, brA: -6, antP: 1, lidT: 0 },
    sleepy: { lidT: 0.6, antD: 0.62, pS: 0.95, ly: 0.35 },
    dizzy: { spiral: 1, antD: 0.35 },
    proud: { lidT: 0.36, brO: 0.85, brY: -2.5, brA: -10, blush: 0.55, antP: 0.6, tilt: -5 },
    angry: { brO: 1, brA: 26, brY: 2.2, lidT: 0.32, lidA: 18, pS: 0.88, antP: 0.85, tilt: 3 },
  };
  const EXPR_ALIAS = { sad: 'worried', shocked: 'surprised', smug: 'proud', mad: 'angry', joy: 'happy', calm: 'neutral', tired: 'sleepy' };
  const GAITS = {   // L target (units), foot lift, body bob, contact squash, lean deg, waddle deg, nose bob deg, cadence steps/s
    walk:  { L: 7.5, lift: 4.8, bob: 2.4, sq: 0.055, lean: 5, waddle: 3.2, arm: 3, cad: [3.6, 7.4], amp: 1 },
    run:   { L: 10.5, lift: 7.5, bob: 6.5, sq: 0.1, lean: 12, waddle: 2.2, arm: 5, cad: [5.6, 11], amp: 1 },
    march: { L: 7, lift: 8, bob: 2.8, sq: 0.06, lean: 0, waddle: 1.4, arm: 4, cad: [3, 6], amp: 1 },
    sneak: { L: 6.5, lift: 6.5, bob: 1.2, sq: 0.02, lean: 9, waddle: 1, arm: 1.5, cad: [2.4, 5], amp: 1, crouch: 0.1 },
  };

  /** A numeric value moved by events {t, to, dur, ease}; each event starts from the value at its own time, so the
   *  order calls arrive in does not matter and overlapping events stay continuous. */
  class Track {
    constructor(v0) { this.v0 = v0; this.ev = []; this.ok = true; }
    add(t, to, dur = 0, ez = sio) { this.ev.push({ t, to, dur: Math.max(0, dur), ez }); this.ok = false; return this; }
    compile() { this.ev.sort((a, b) => a.t - b.t); for (let i = 0; i < this.ev.length; i++) this.ev[i].from = this._at(this.ev[i].t, i); this.ok = true; }
    _at(t, n) {
      let v = this.v0;
      for (let i = 0; i < n; i++) {
        const e = this.ev[i]; if (e.t > t) break;
        v = e.dur <= 0 || t >= e.t + e.dur ? e.to : lerp(e.from, e.to, e.ez((t - e.t) / e.dur));
      }
      return v;
    }
    at(t) { if (!this.ok) this.compile(); return this._at(t, this.ev.length); }
    last() { if (!this.ok) this.compile(); return this.ev.length ? this.ev[this.ev.length - 1].to : this.v0; }
  }

  /** Named states over time with switch moments: [{t, v}] → {v, since, until} at t. Overrides punch windows in. */
  class StateTrack {
    constructor(v0) { this.v0 = v0; this.ev = []; this.ov = []; this.list = null; }
    set(t, v) { this.ev.push({ t, v }); this.list = null; }
    override(a, b, v) { this.ov.push({ a, b, v }); this.list = null; }
    compile() {
      const ev = this.ev.slice().sort((a, b) => a.t - b.t);
      const base = [{ a: -Infinity, v: this.v0 }]; for (const e of ev) base.push({ a: e.t, v: e.v });
      for (let i = 0; i < base.length; i++) base[i].b = i + 1 < base.length ? base[i + 1].a : Infinity;
      let segs = base.map((s) => ({ a: s.a, b: s.b, v: s.v }));
      for (const o of this.ov.slice().sort((x, y) => x.a - y.a)) {
        const out = [];
        for (const s of segs) {
          if (s.b <= o.a || s.a >= o.b) { out.push(s); continue; }
          if (s.a < o.a) out.push({ a: s.a, b: o.a, v: s.v });
          if (s.b > o.b) out.push({ a: o.b, b: s.b, v: s.v });
        }
        out.push({ a: o.a, b: o.b, v: o.v });
        segs = out.sort((x, y) => x.a - y.a);
      }
      // merge equal neighbours so a no-op switch does not re-pop
      const m = [];
      for (const s of segs) { const l = m[m.length - 1]; if (l && l.v === s.v && l.b === s.a) l.b = s.b; else m.push({ ...s }); }
      this.list = m;
    }
    at(t) {
      if (!this.list) this.compile();
      const L = this.list;
      for (let i = 0; i < L.length; i++) { const s = L[i]; if (t >= s.a && t < s.b) return { v: s.v, since: t - s.a, until: s.b - t, prev: i ? L[i - 1].v : s.v, next: i + 1 < L.length ? L[i + 1].v : s.v }; }
      const l = L[L.length - 1]; return { v: l.v, since: t - l.a, until: Infinity, prev: L.length > 1 ? L[L.length - 2].v : l.v, next: l.v };
    }
    names() { return [this.v0, ...this.ev.map((e) => e.v), ...this.ov.map((o) => o.v)]; }
  }

  /* ---------- headwear (facing coords, ball centre = 0,0). ant: antenna [base, ctrl, tip] pairs ---------- */
  const lg = (id, stops, o = {}) => ({ id, stops, ...o });   // gradient spec, materialised per mascot
  const HATS = {
    cap: {
      ant: [[-7, -47, -7, -61, -17.5, -66], [8, -50, 8.5, -63, 10, -74]],
      grads: [lg('cap', [[0, '#55555e'], [0.45, '#26262b'], [1, '#111113']], { radial: true, cx: 0.34, cy: 0.22, r: 0.9 })],
      build(g, u) {
        S('path', { d: 'M14 -27.4C34 -30.6 52 -27 61 -20.5C62.6 -19 61 -16.9 58 -17C47 -18.5 30 -20.8 14 -21.6Z', fill: '#141416' }, g);
        S('path', { d: 'M30 -21C40 -20.3 49 -18.8 57.6 -17.3', fill: 'none', stroke: '#4a4a52', 'stroke-width': 1 }, g);
        S('path', { d: 'M-37 -25C-41 -43 -20 -52.5 0 -52C21 -51.5 37 -41 39.5 -24C16 -20 -14 -20 -37 -25Z', fill: u('cap') }, g);
        S('path', { d: 'M-24 -41C-14 -48.5 2 -50.5 13 -48.5', fill: 'none', stroke: '#fff', 'stroke-width': 2.4, 'stroke-linecap': 'round', opacity: 0.2 }, g);
        S('path', { d: 'M-36.5 -25C-14 -20.4 16 -20.4 39 -24', fill: 'none', stroke: '#34343b', 'stroke-width': 1.2 }, g);
        S('circle', { cx: 0, cy: -52, r: 2.4, fill: '#2a2a30' }, g);
      },
    },
    beanie: {
      ant: [[-16, -49, -17, -61, -26.5, -65], [13, -51, 14, -63, 16, -72]],
      grads: [lg('knit', [[0, '#F8F1E4'], [1, '#DED0B6']], { x2: 0, y2: 1 })],
      build(g, u, e) {
        S('path', { d: 'M-41.5 -14C-45 -42 -22 -55 0 -54.5C22 -54 44 -42 41.5 -16C14 -11.5 -14 -11.5 -41.5 -14Z', fill: u('knit') }, g);
        for (const d of ['M-21 -47C-27 -37 -29.5 -29 -30 -22', 'M0 -54C-1 -43 -1 -33 -1 -21', 'M21 -48.5C26 -39 28 -31 29 -24'])
          S('path', { d, fill: 'none', stroke: '#D9CBB0', 'stroke-width': 1.3, opacity: 0.85 }, g);
        S('path', { d: 'M-42 -13.4C-14 -10.6 14 -10.6 42 -15.4L42.6 -24.6C14 -20.2 -14 -20.2 -42.6 -22.8Z', fill: '#E6DAC4', stroke: '#D2C3A7', 'stroke-width': 0.9 }, g);
        S('path', { d: 'M-40.5 -18.2C-14 -15.4 14 -15.4 40.5 -19.8', fill: 'none', stroke: '#D3C4A8', 'stroke-width': 7.6, 'stroke-dasharray': '1.5 4.3' }, g);
        e.pom = S('g', {}, g);
        S('circle', { cx: 0, cy: 0, r: 7.4, fill: '#FAF5EC', stroke: '#DCCDB2', 'stroke-width': 1 }, e.pom);
        for (const [x, y] of [[-3, -2.5], [2.5, -3.4], [3.6, 1.4], [-1.6, 3.2], [0, 0]]) S('circle', { cx: x, cy: y, r: 1.2, fill: '#E8DCC6' }, e.pom);
      },
      update(e, sp) { setA(e.pom, 'transform', `translate(${f2(-3 + sp.x * 0.5)} ${f2(-58.5 + sp.y * 0.3)})`); },
    },
    grad: {
      ant: [[-15, -52, -16, -63, -25.5, -67], [17, -55, 18, -66, 20, -75]],
      build(g, u, e) {
        S('path', { d: 'M-38 -22C-41 -40 -20 -50 0 -50C20 -50 39 -40 38 -23C14 -18.5 -14 -18 -38 -22Z', fill: '#202024' }, g);
        S('path', { d: 'M-30 -38C-18 -46 4 -47.5 18 -45', fill: 'none', stroke: '#fff', 'stroke-width': 2, opacity: 0.12, 'stroke-linecap': 'round' }, g);
        S('polygon', { points: '-47,-51 4,-45.5 53,-52 53,-49.2 4,-42.7 -47,-48.2', fill: '#111113' }, g);
        S('polygon', { points: '-47,-51 2,-58.5 53,-52 4,-45.5', fill: '#2b2b31', stroke: '#141416', 'stroke-width': 1, 'stroke-linejoin': 'round' }, g);
        S('circle', { cx: 3, cy: -52, r: 2.1, fill: '#E8B83A' }, g);
        e.cord = S('path', { d: 'M0 0', fill: 'none', stroke: '#E8B83A', 'stroke-width': 1.5, 'stroke-linecap': 'round' }, g);
        e.tuft = S('path', { d: 'M0 0', fill: '#E8B83A' }, g);
      },
      update(e, sp) {
        const ex = 53 + sp.x * 0.9, ey = -38 + Math.max(-4, sp.y * 0.3);
        setA(e.cord, 'd', `M3 -52L52 -50.6Q${f2(53 + sp.x * 0.3)} -45 ${f2(ex)} ${f2(ey)}`);
        setA(e.tuft, 'd', `M${f2(ex - 1.6)} ${f2(ey - 0.6)}L${f2(ex + 1.6)} ${f2(ey - 0.6)}L${f2(ex + 2.5)} ${f2(ey + 6)}L${f2(ex - 2.5)} ${f2(ey + 6)}Z`);
      },
    },
    detective: {
      ant: [[-8, -51, -9, -62, -18.5, -66], [12, -52, 13, -63, 15, -72]],
      grads: [lg('fed', [[0, '#A38B66'], [1, '#76603F']], { x2: 0, y2: 1 })],
      build(g, u) {
        S('path', { d: 'M-27 -30C-30 -44 -22 -55 -6 -56C-1 -53 4 -53 9 -56C25 -55 32 -44 30 -30Z', fill: u('fed') }, g);
        S('path', { d: 'M-14 -52.5C-6 -50 6 -50 16 -53', fill: 'none', stroke: '#655137', 'stroke-width': 1.3 }, g);
        S('path', { d: 'M-28.6 -30.4L30.6 -30.4L30.1 -36.4L-28.2 -36.4Z', fill: '#3A2E25' }, g);
        S('path', { d: 'M-41 -31C-32 -36 28 -36.6 48 -29.6C51 -28.5 50 -25.8 46.4 -26.2C30 -29.4 -22 -28.2 -39.4 -27.2C-43 -27.2 -44 -30 -41 -31Z', fill: '#7A6449', stroke: '#5D4B37', 'stroke-width': 0.8 }, g);
      },
    },
    hardhat: {
      ant: [[-10, -53, -11, -64, -20.5, -68], [9, -55, 10, -66, 12, -75]],
      grads: [lg('hh', [[0, '#FBDB6A'], [1, '#E0A91F']], { x2: 0, y2: 1 })],
      build(g, u) {
        S('path', { d: 'M-37 -22C-40 -45 -18 -56 2 -55.5C22 -55 38 -45 38 -23Z', fill: u('hh') }, g);
        S('path', { d: 'M-2 -55.6C14 -55 28 -46 34 -32', fill: 'none', stroke: '#D49B1A', 'stroke-width': 2.2 }, g);
        S('path', { d: 'M-24 -44C-16 -51 -6 -54 4 -54', fill: 'none', stroke: '#fff', 'stroke-width': 2.4, opacity: 0.35, 'stroke-linecap': 'round' }, g);
        S('path', { d: 'M-43 -20.5C-28 -25.5 28 -27 55 -20.5C57 -19 55 -16.6 51 -17C22 -21 -24 -18.5 -41.5 -16.5C-45.5 -16.5 -46 -19.5 -43 -20.5Z', fill: '#E3AE22', stroke: '#C4901A', 'stroke-width': 0.8 }, g);
      },
    },
    beret: {
      ant: [[-14, -48, -15, -60, -24.5, -64], [12, -51, 13, -63, 15, -72]],
      grads: [lg('ber', [[0, '#7570DD'], [1, '#4842A8']], { x2: 0, y2: 1 })],
      build(g, u) {
        S('path', { d: 'M-40 -31C-46 -44 -14 -55 18 -52C40 -50 50 -40 42 -33C22 -30.5 -18 -27.5 -40 -31Z', fill: u('ber') }, g);
        S('path', { d: 'M-39 -30.6C-18 -27.4 22 -30.4 41 -33', fill: 'none', stroke: '#3B378C', 'stroke-width': 2.3 }, g);
        S('path', { d: 'M2 -52.4L3.6 -57.4', stroke: '#4842A8', 'stroke-width': 2.8, 'stroke-linecap': 'round' }, g);
      },
    },
    crown: {
      ant: [[-20, -40, -24, -52, -33, -55], [24, -41, 27, -53, 32, -61]],
      grads: [lg('gold', [[0, '#FBDA74'], [1, '#DC9E28']], { x2: 0, y2: 1 })],
      build(g, u) {
        const c = S('g', { transform: 'rotate(7 0 -42)' }, g);
        S('path', { d: 'M-26 -33L-29 -56L-17 -45L-8 -60L1 -46L11 -61L18 -46L29 -57L28 -35C10 -31.5 -10 -31 -26 -33Z', fill: u('gold'), stroke: '#B57E1A', 'stroke-width': 1.1, 'stroke-linejoin': 'round' }, c);
        for (const [x, y] of [[-29, -56], [-8, -60], [11, -61], [29, -57]]) S('circle', { cx: x, cy: y, r: 2.3, fill: '#FBDA74', stroke: '#B57E1A', 'stroke-width': 0.8 }, c);
        S('path', { d: 'M-26.5 -35.2C-10 -33.2 10 -33.6 28.2 -37.2', fill: 'none', stroke: '#C98E1F', 'stroke-width': 3 }, c);
        S('circle', { cx: -12, cy: -38.6, r: 2.5, fill: '#E76A5A' }, c);
        S('circle', { cx: 5, cy: -39.4, r: 2.7, fill: '#4FB3A9' }, c);
        S('circle', { cx: 20, cy: -40.4, r: 2.3, fill: '#E76A5A' }, c);
      },
    },
    party: {
      ant: [[-17, -39, -21, -51, -30.5, -55], [25, -39, 29, -50, 35, -57]],
      build(g, u, e, id) {
        const cone = 'M-17 -36L8 -92L24 -38C12 -34.5 -6 -34 -17 -36Z';
        const cp = S('clipPath', { id: id + '-party' }, g); S('path', { d: cone }, cp);
        S('path', { d: cone, fill: '#F6E7C8' }, g);
        const st = S('g', { 'clip-path': `url(#${id}-party)` }, g);
        S('path', { d: 'M-20 -47L28 -51', stroke: '#4FB3A9', 'stroke-width': 6 }, st);
        S('path', { d: 'M-20 -64L28 -68', stroke: '#EFA63C', 'stroke-width': 5 }, st);
        S('path', { d: 'M-20 -79L28 -83', stroke: '#4FB3A9', 'stroke-width': 4 }, st);
        S('path', { d: 'M-8 -40L10 -88', stroke: '#fff', 'stroke-width': 2.2, opacity: 0.4 }, st);
        S('path', { d: cone, fill: 'none', stroke: '#DCC497', 'stroke-width': 1 }, g);
        e.pom = S('circle', { r: 4.8, fill: '#F2C230', stroke: '#D9A81E', 'stroke-width': 0.8 }, g);
      },
      update(e, sp) { setA(e.pom, 'cx', f2(8 + sp.x * 0.7)); setA(e.pom, 'cy', f2(-93 + sp.y * 0.3)); },
    },
    flatcap: {
      ant: [[-8, -49, -9, -61, -19, -65], [11, -49, 12, -61, 14, -70]],
      grads: [lg('tweed', [[0, '#86817B'], [1, '#55514D']], { x2: 0, y2: 1 })],
      build(g, u) {
        S('path', { d: 'M-40 -19C-43 -38 -18 -50 6 -49.5C28 -49 43 -39 44 -24C42 -21 36 -20.5 30 -21C10 -18.5 -16 -16.5 -40 -19Z', fill: u('tweed') }, g);
        S('path', { d: 'M-6 -49C4 -44 18 -36 30 -22', fill: 'none', stroke: '#5E5955', 'stroke-width': 1.1 }, g);
        S('path', { d: 'M-26 -42C-16 -47 -4 -48.5 6 -48', fill: 'none', stroke: '#fff', 'stroke-width': 2, opacity: 0.16, 'stroke-linecap': 'round' }, g);
        S('path', { d: 'M26 -23.5C38 -25.5 49 -23 54 -19C54.5 -17.3 52 -16 49 -16.5C41 -18 33 -19 25 -19Z', fill: '#4A4643' }, g);
        S('circle', { cx: 2, cy: -49.6, r: 1.9, fill: '#4A4643' }, g);
      },
    },
  };
  const NO_HAT_ANT = [[-9, -40.4, -9.5, -54, -19.5, -60], [8, -41.2, 8.6, -55, 10.6, -66]];

  /* face + neck accessories */
  const FACEWEAR = {
    glasses: {
      build(g) {
        S('path', { d: 'M17.6 -9.6C8 -11.2 -2 -12.4 -11 -14', fill: 'none', stroke: INK, 'stroke-width': 2, 'stroke-linecap': 'round' }, g);
        S('circle', { cx: EYE.x, cy: EYE.y, r: 10.4, fill: '#DCEFFF', 'fill-opacity': 0.18, stroke: INK, 'stroke-width': 2.2 }, g);
        S('path', { d: 'M21.6 -13.6A7.4 7.4 0 0 1 27 -16.6', fill: 'none', stroke: '#fff', 'stroke-width': 1.7, 'stroke-linecap': 'round', opacity: 0.9 }, g);
        S('path', { d: 'M38.3 -6.6L40.8 -5', stroke: INK, 'stroke-width': 2.2, 'stroke-linecap': 'round' }, g);
      },
    },
  };
  const NECKWEAR = {
    tie: {
      build(g, e) {
        e.blade = S('path', { d: 'M27.6 29.6L32.6 29.4L35.6 43.4L31.2 48L27.4 43.2Z', fill: '#CC3B45', stroke: '#A62E37', 'stroke-width': 0.8, 'stroke-linejoin': 'round' }, g);
        S('path', { d: 'M26.6 24.8L33.2 24.4L32.6 30.2L27.6 30.4Z', fill: '#A92F38' }, g);
      },
      update(e, sp) { setA(e.blade, 'transform', `rotate(${f2(clamp(-sp.x * 2.6, -24, 24))} 30 30)`); },
    },
  };

  /* ---------- props — the crew has no hands. Each prop is held at the NOSE TIP ('nose': the frame's x axis runs along
     the nose, y down), planted on the HEAD like a flag ('head', behind the ball, wobbling on the antennae's spring), or
     tucked against the BODY SIDE ('side'). Builders draw in their own frame (their "up" = -y); grip = the builder point
     that sits on the attach point; rot = rotation there at rest (nose frame: 90 points the prop's "up" along the nose). */
  const PROPS = {
    'sign-q': {
      attach: 'head', at: [-2, -34], rot: -5, wobble: 1,
      build(g, e) {
        S('path', { d: 'M0 4L0 -58', stroke: '#C4925A', 'stroke-width': 3.6, 'stroke-linecap': 'round' }, g);
        S('path', { d: 'M1 3L1 -56', stroke: '#A97A47', 'stroke-width': 1, opacity: 0.6 }, g);
        S('rect', { x: -16.5, y: -84, width: 33, height: 28, rx: 5.5, fill: '#fff', stroke: INK, 'stroke-width': 2.4 }, g);
        e.glyph = S('g', {}, g); const gi = S('g', { transform: 'translate(0 4)' }, e.glyph);
        S('path', { d: 'M-5.4 -78.6C-5.4 -84.6 5.4 -84.6 5.4 -78.2C5.4 -73.8 0 -73.4 0 -68.6', fill: 'none', stroke: '#E0784C', 'stroke-width': 3.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, gi);
        S('circle', { cx: 0, cy: -63.6, r: 2.3, fill: '#E0784C' }, gi);
      },
      update(e, sp, f) { setA(e.glyph, 'transform', f < 0 ? 'scale(-1 1)' : ''); },
    },
    flag: {
      attach: 'head', at: [-2, -34], rot: -5, wobble: 1,
      build(g, e) {
        S('path', { d: 'M0 4L0 -60', stroke: INK, 'stroke-width': 2.4, 'stroke-linecap': 'round' }, g);
        S('circle', { cx: 0, cy: -61.6, r: 2.2, fill: INK }, g);
        e.cg = S('g', { transform: 'translate(0 -10)' }, g);
        e.cloth = S('path', { d: 'M0 0', fill: '#5BAE5B', stroke: '#479447', 'stroke-width': 0.8, 'stroke-linejoin': 'round' }, e.cg);
        e.mark = S('path', { d: 'M0 0', fill: 'none', stroke: '#fff', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, e.cg);
      },
      update(e, sp, f, t) {
        const w = Math.sin(t * TAU * 1.6) * 2.2, w2 = Math.sin(t * TAU * 1.6 + 1.3) * 2.2, s = clamp(-sp.x * 0.6, -4, 4);
        setA(e.cloth, 'd', `M1.2 -49C8 ${f2(-51 + w)} 16 ${f2(-46 - w2)} ${f2(25 + s)} ${f2(-48.5 + w2)}L${f2(25 + s)} ${f2(-33.5 + w2)}C16 ${f2(-31.5 - w2)} 8 ${f2(-36 + w)} 1.2 -33Z`);
        setA(e.mark, 'd', `M8 ${f2(-41 + w * 0.4)}L11.5 ${f2(-37.6 + w * 0.2)}L18 ${f2(-45 - w2 * 0.2)}`);
      },
    },
    magnifier: {
      attach: 'nose', grip: [0, 6], rot: 58,
      build(g) {
        S('path', { d: 'M0 7L0 -9', stroke: '#8A5A35', 'stroke-width': 4.4, 'stroke-linecap': 'round' }, g);
        S('path', { d: 'M0 -9L0 -12.4', stroke: '#2A2A2E', 'stroke-width': 4.8 }, g);
        S('circle', { cx: 0, cy: -21.4, r: 9.4, fill: '#CFEAF5', 'fill-opacity': 0.45, stroke: INK, 'stroke-width': 2.7 }, g);
        S('path', { d: 'M-5.2 -25.4A6.2 6.2 0 0 1 -1 -28.6', fill: 'none', stroke: '#fff', 'stroke-width': 1.9, 'stroke-linecap': 'round' }, g);
      },
    },
    clipboard: {
      attach: 'side', at: [-7, 14], rot: -8, grip: [9.5, -12],
      build(g, e) {
        S('rect', { x: -2, y: -27, width: 23, height: 30, rx: 2.6, fill: '#B9875A', stroke: '#8C6240', 'stroke-width': 1 }, g);
        S('rect', { x: 1.2, y: -22.4, width: 16.6, height: 22.6, rx: 0.8, fill: '#fff' }, g);
        for (const y of [-16, -10.6, -5.2]) S('path', { d: `M8 ${y}L15.6 ${y}`, stroke: '#A3AAB3', 'stroke-width': 1.4, 'stroke-linecap': 'round' }, g);
        for (const y of [-16, -10.6, -5.2]) S('rect', { x: 3, y: y - 1.6, width: 3.2, height: 3.2, rx: 0.5, fill: 'none', stroke: '#A3AAB3', 'stroke-width': 0.9 }, g);
        S('rect', { x: 5, y: -29.6, width: 9.4, height: 5.2, rx: 1.6, fill: '#A8AEB6', stroke: '#7D838B', 'stroke-width': 0.8 }, g);
        e.tick = S('path', { d: 'M2.6 -16.4L4.4 -14.2L8.4 -19.6M2.6 -11L4.4 -8.8L8.4 -14.2M2.6 -5.6L4.4 -3.4L8.4 -8.8', fill: 'none', stroke: '#4E9E4E', 'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': '30', 'stroke-dashoffset': '30' }, g);
      },
    },
    blueprint: {
      attach: 'side', at: [-9, 30], rot: -7, grip: [9, 0],
      build(g) {
        S('rect', { x: -10, y: -4.8, width: 38, height: 9.6, rx: 4.8, fill: '#4C7FCB', stroke: '#2F5C9E', 'stroke-width': 1 }, g);
        for (const x of [-3, 5, 13, 21]) S('path', { d: `M${x} -4.4L${x} 4.4`, stroke: '#8DB3EA', 'stroke-width': 0.8 }, g);
        S('path', { d: 'M-7 -1.4L25 -1.4', stroke: '#BFD6F7', 'stroke-width': 0.8, opacity: 0.8 }, g);
        S('ellipse', { cx: 28, cy: 0, rx: 2.8, ry: 4.8, fill: '#A9C8F4', stroke: '#2F5C9E', 'stroke-width': 0.9 }, g);
        S('path', { d: 'M28 0.6A1.2 1.6 0 1 1 28.6 -1.6A2.2 3 0 1 1 27 2.6', fill: 'none', stroke: '#2F5C9E', 'stroke-width': 0.7 }, g);
      },
    },
    pencil: {
      attach: 'nose', grip: [0, 15], rot: 116,
      build(g) {
        S('rect', { x: -3.3, y: -24, width: 6.6, height: 32, fill: '#F2C230', stroke: '#C99A1E', 'stroke-width': 0.8 }, g);
        S('path', { d: 'M0 -24L0 8', stroke: '#E0AA22', 'stroke-width': 1.3 }, g);
        S('rect', { x: -3.5, y: 8, width: 7, height: 3.4, fill: '#B8BEC6', stroke: '#8E959E', 'stroke-width': 0.6 }, g);
        S('rect', { x: -3.3, y: 11.2, width: 6.6, height: 4.6, rx: 2, fill: '#F08FA0', stroke: '#D46F81', 'stroke-width': 0.6 }, g);
        S('polygon', { points: '-3.3,-24 3.3,-24 0,-33.6', fill: '#EDD2AC', stroke: '#C9A47A', 'stroke-width': 0.7, 'stroke-linejoin': 'round' }, g);
        S('polygon', { points: '-1.2,-30.2 1.2,-30.2 0,-33.8', fill: INK }, g);
      },
    },
    hammer: {
      attach: 'nose', grip: [0, 8], rot: 90, scale: 1.3,
      build(g) {
        S('path', { d: 'M0 9L0 -20', stroke: '#B07A48', 'stroke-width': 3.8, 'stroke-linecap': 'round' }, g);
        S('path', { d: 'M-0.8 8L-0.8 -18', stroke: '#8F5F34', 'stroke-width': 1, opacity: 0.6 }, g);
        S('path', { d: 'M-5 -27.6L9 -27.6Q11 -27.6 11 -25.6L11 -21.4Q11 -19.4 9 -19.4L-5 -19.4Q-6 -19.4 -7 -21L-9.6 -25Q-8 -27.6 -5 -27.6Z', fill: '#80858D', stroke: '#5A5F66', 'stroke-width': 0.9, 'stroke-linejoin': 'round' }, g);
        S('path', { d: 'M-4 -26L8.6 -26', stroke: '#fff', 'stroke-width': 1.2, opacity: 0.35 }, g);
      },
    },
    whistle: {
      attach: 'nose', grip: [12.6, -3.3], rot: 180, scale: 1.25,
      build(g) { drawWhistle(g); },
    },
    stamp: {
      attach: 'nose', grip: [0, -19.4], rot: 0, scale: 1.2, upright: true,
      build(g) {
        S('circle', { cx: 0, cy: -15, r: 4.8, fill: '#9B6A44', stroke: '#7A5132', 'stroke-width': 0.8 }, g);
        S('rect', { x: -2.1, y: -11, width: 4.2, height: 8, fill: '#9B6A44' }, g);
        S('rect', { x: -9, y: -3.6, width: 18, height: 5.2, rx: 1.3, fill: '#6D4A31' }, g);
        S('rect', { x: -8.4, y: 1.4, width: 16.8, height: 2.8, rx: 0.6, fill: '#E0534F' }, g);
        S('circle', { cx: -1.6, cy: -16.6, r: 1.4, fill: '#fff', opacity: 0.35 }, g);
      },
    },
    coffee: {
      attach: 'nose', at: [-9, -7.2], grip: [8.5, 3], rot: 0, scale: 1.1, upright: true,
      build(g, e) {
        S('path', { d: 'M2.4 -7.4C-3.4 -7.4 -3.4 0.6 2.4 0.6', fill: 'none', stroke: INK, 'stroke-width': 1.7 }, g);
        S('rect', { x: 2, y: -11, width: 13, height: 14, rx: 2.2, fill: '#fff', stroke: INK, 'stroke-width': 1.7 }, g);
        S('ellipse', { cx: 8.5, cy: -10.2, rx: 5.2, ry: 1.2, fill: '#7A4A2A' }, g);
        S('path', { d: 'M5 -3L12 -3', stroke: '#EFA63C', 'stroke-width': 2.2, 'stroke-linecap': 'round' }, g);
        e.steam = [0, 1].map(() => S('path', { d: 'M0 0', fill: 'none', stroke: '#B9B6AE', 'stroke-width': 1.5, 'stroke-linecap': 'round' }, g));
      },
      update(e, sp, f, t) {
        e.steam.forEach((p, i) => {
          const ph = ((t * 0.9 + i * 0.5) % 1 + 1) % 1, x = 6.5 + i * 4, y = -13 - ph * 10, w = Math.sin((t * 3 + i) * TAU * 0.5) * 1.6;
          setA(p, 'd', `M${f2(x)} ${f2(y)}c${f2(w)} -2.4 ${f2(-w)} -4 0 -6.4`);
          setA(p, 'opacity', f2(bump(ph) * 0.9));
        });
      },
    },
    wrench: {
      attach: 'nose', grip: [0, 7], rot: 92, scale: 1.12,
      build(g) {
        S('path', { d: 'M0 8L0 -17', stroke: '#8E949C', 'stroke-width': 4.6, 'stroke-linecap': 'round' }, g);
        S('path', { d: 'M-6.4 -22.6A6.4 6.4 0 0 1 -2.5 -28.5L-2.5 -24L2.5 -24L2.5 -28.5A6.4 6.4 0 0 1 6.4 -22.6A6.4 6.4 0 0 1 0 -16.2A6.4 6.4 0 0 1 -6.4 -22.6Z', fill: '#8E949C', stroke: '#6B7178', 'stroke-width': 0.9, 'stroke-linejoin': 'round' }, g);
        S('path', { d: 'M-1 6L-1 -15', stroke: '#fff', 'stroke-width': 1.1, opacity: 0.35 }, g);
      },
    },
    cart: { attach: 'ground', build() {} },
  };

  function drawWhistle(g) {
    S('circle', { cx: -3.4, cy: -1.8, r: 2.2, fill: 'none', stroke: '#8A9099', 'stroke-width': 1 }, g);
    S('rect', { x: -2.2, y: -5.4, width: 10.6, height: 7, rx: 3.4, fill: '#D4D8DE', stroke: '#868C95', 'stroke-width': 0.9 }, g);
    S('rect', { x: 7.6, y: -5, width: 5.4, height: 3.4, rx: 0.8, fill: '#B5BAC2', stroke: '#868C95', 'stroke-width': 0.8 }, g);
    S('circle', { cx: 2.6, cy: -1.6, r: 1.3, fill: '#5E646C' }, g);
  }
  /** the builder's cart, on the ground in front of the nose (root coords, facing right) */
  function buildCart(g, hg) {
    const e = {};
    e.handle = S('path', { d: 'M0 0', fill: 'none', stroke: INK, 'stroke-width': 2.4, 'stroke-linecap': 'round' }, hg);
    e.body = S('g', {}, g);
    S('rect', { x: 62, y: -40, width: 36, height: 26, rx: 3.4, fill: '#fff', stroke: INK, 'stroke-width': 2.4 }, e.body);
    S('path', { d: 'M62 -31.6L98 -31.6', stroke: INK, 'stroke-width': 1.8 }, e.body);
    S('rect', { x: 76.6, y: -40, width: 6.8, height: 8.4, fill: '#D9805F' }, e.body);
    S('path', { d: 'M86 -21.4L93.6 -21.4M89 -18L93.6 -18', stroke: '#8E8E95', 'stroke-width': 1.2, 'stroke-linecap': 'round' }, e.body);
    S('rect', { x: 57, y: -14.4, width: 45, height: 4.4, rx: 2.2, fill: INK }, e.body);
    e.wheels = [66, 92].map((x) => {
      const w = S('g', { transform: `translate(${x} -6.4)` }, g);
      S('circle', { r: 6.2, fill: '#fff', stroke: INK, 'stroke-width': 2.2 }, w);
      const sp = S('path', { d: 'M0 0L0 -4.2', stroke: INK, 'stroke-width': 1.8, 'stroke-linecap': 'round' }, w);
      S('circle', { r: 1.3, fill: INK }, w);
      return sp;
    });
    return e;
  }

  /* ---------- one mascot ---------- */
  let COUNT = 0;
  const ALL = [];
  const ptOf = (p, fb) => (p == null ? fb : typeof p === 'number' ? [p, fb[1]] : Array.isArray(p) ? [p[0], p[1]] : [p.x ?? fb[0], p.y ?? fb[1]]);
  const warn = (msg) => { if (window.F && F.violation) F.violation('mascot: ' + msg); else console.warn('[mascot] ' + msg); };

  function create(o = {}) {
    const { tl, cue = () => {}, parent, size = 180, life = true } = o;
    let variant = o.variant || 'plain';
    if (!VARIANTS[variant]) { warn('unknown variant ' + variant); variant = 'plain'; }
    const V = VARIANTS[variant];
    const id = 'msc' + COUNT++;
    const body = o.color || V.body;
    const k = size / 100;                                  // px per rig unit
    const rnd = prng(hash(variant + ':' + id + ':' + (o.seed || 0)));
    const x0 = o.x ?? 0, y0 = o.y ?? 0;
    const facing0 = (o.facing ?? 1) < 0 ? -1 : 1;

    /* ----- DOM ----- */
    const el = document.createElement('div');
    el.className = `mascot mascot-${variant}`;
    el.dataset.mascot = variant;
    const inner = document.createElement('div'); inner.className = 'm-inner'; el.appendChild(inner);
    const svg = S('svg', { class: 'm-svg', viewBox: '-50 -100 100 100', width: size, height: size, 'aria-hidden': 'true' });
    svg.style.left = -size / 2 + 'px'; svg.style.top = -size + 'px';
    inner.appendChild(svg);
    (parent || document.body).appendChild(el);
    const defs = S('defs', {}, svg);
    const gradEl = (name, sp) => {
      const g = S(sp.radial ? 'radialGradient' : 'linearGradient', { id: `${id}-${name}` }, defs);
      if (sp.radial) { g.setAttribute('cx', sp.cx ?? 0.5); g.setAttribute('cy', sp.cy ?? 0.5); g.setAttribute('r', sp.r ?? 0.5); if (sp.fx != null) { g.setAttribute('fx', sp.fx); g.setAttribute('fy', sp.fy); } }
      else { g.setAttribute('x1', sp.x1 ?? 0); g.setAttribute('y1', sp.y1 ?? 0); g.setAttribute('x2', sp.x2 ?? 1); g.setAttribute('y2', sp.y2 ?? 0); }
      if (sp.user) g.setAttribute('gradientUnits', 'userSpaceOnUse');
      for (const [off, c, op] of sp.stops) S('stop', { offset: off, 'stop-color': c, 'stop-opacity': op ?? 1 }, g);
      return g;
    };
    const url = (name) => `url(#${id}-${name})`;
    const gBody = gradEl('body', { radial: true, cx: 0.42, cy: 0.36, r: 0.7, fx: 0.31, fy: 0.23, stops: [[0, tint(body, 0.42)], [0.3, tint(body, 0.15)], [0.68, body], [1, shade(body, 0.4)]] });
    gradEl('spec', { radial: true, stops: [[0, '#fff', 0.55], [1, '#fff', 0]] });
    gradEl('leg', { user: true, x1: 0, y1: -24, x2: 0, y2: 0, stops: [[0, shade(body, 0.45)], [0.5, shade(body, 0.14)], [1, tint(body, 0.06)]] });
    gradEl('legF', { user: true, x1: 0, y1: -24, x2: 0, y2: 0, stops: [[0, shade(body, 0.58)], [1, shade(body, 0.3)]] });
    gradEl('nose', { x2: 0, y2: 1, stops: [[0, tint(body, 0.34)], [0.5, body], [1, shade(body, 0.34)]] });
    gradEl('lid', { x2: 0, y2: 1, stops: [[0, tint(body, 0.08)], [1, shade(body, 0.04)]] });
    gradEl('shadow', { radial: true, stops: [[0, '#2a1f18', 0.34], [0.6, '#2a1f18', 0.16], [1, '#2a1f18', 0]] });
    gradEl('blush', { radial: true, stops: [[0, '#FF7A7A', 0.7], [1, '#FF7A7A', 0]] });
    const clipBall = S('clipPath', { id: `${id}-ball` }, defs); S('circle', { cx: 0, cy: 0, r: R }, clipBall);
    const clipEye = S('clipPath', { id: `${id}-eye` }, defs); S('ellipse', { cx: 0, cy: 0, rx: EYE.rx, ry: EYE.ry }, clipEye);
    const hatGrads = new Set();
    const ensureGrads = (h) => { for (const g of h.grads || []) if (!hatGrads.has(g.id)) { hatGrads.add(g.id); gradEl(g.id, g); } };

    const shadowE = S('ellipse', { cx: 0, cy: -0.4, rx: 31, ry: 4.2, fill: url('shadow') }, svg);
    const root = S('g', {}, svg);
    const legF = S('path', { d: 'M0 0', fill: 'none', stroke: url('legF'), 'stroke-width': LEG_W, 'stroke-linecap': 'round' }, root);
    const legN = S('path', { d: 'M0 0', fill: 'none', stroke: url('leg'), 'stroke-width': LEG_W, 'stroke-linecap': 'round' }, root);
    const upper = S('g', {}, root);
    const back = S('g', {}, upper);
    const propBackG = S('g', {}, back);
    const ball = S('circle', { cx: 0, cy: 0, r: R, fill: url('body') }, upper);
    S('ellipse', { cx: -16, cy: -21, rx: 13, ry: 9, fill: url('spec'), transform: 'rotate(-32 -16 -21)', opacity: 0.55 }, upper);
    const front = S('g', {}, upper);
    const shadowsG = S('g', { 'clip-path': `url(#${id}-ball)` }, front);
    const noseSh = S('path', { d: 'M0 0', fill: shade(body, 0.55), opacity: 0.26 }, shadowsG);
    const nose = S('path', { d: 'M0 0', fill: url('nose') }, front);
    const noseHi = S('path', { d: 'M0 0', fill: 'none', stroke: '#fff', 'stroke-width': 2.2, 'stroke-linecap': 'round', opacity: 0.2 }, front);
    const neckG = S('g', {}, front);
    const blush = S('ellipse', { cx: EYE.x - 7, cy: EYE.y + 12.8, rx: 7, ry: 3.8, fill: url('blush'), opacity: 0 }, front);
    const eyeG = S('g', {}, front);
    const eyeN = S('g', {}, eyeG);
    S('ellipse', { cx: 0, cy: 0, rx: EYE.rx, ry: EYE.ry, fill: '#fff' }, eyeN);
    const pupil = S('g', {}, eyeN);
    S('ellipse', { cx: 0, cy: 0, rx: 4.5, ry: 5.9, fill: '#141416' }, pupil);
    S('circle', { cx: 1.5, cy: -2.7, r: 1.8, fill: '#fff' }, pupil);
    S('circle', { cx: -1.5, cy: 2.3, r: 0.8, fill: '#fff', opacity: 0.75 }, pupil);
    const lids = S('g', { 'clip-path': `url(#${id}-eye)` }, eyeN);
    const lidT = S('path', { d: 'M0 0', fill: url('lid') }, lids);
    const lidB = S('path', { d: 'M0 0', fill: url('lid') }, lids);
    const lidTL = S('path', { d: 'M0 0', fill: 'none', stroke: shade(body, 0.5), 'stroke-width': 1.3, 'stroke-linecap': 'round' }, lids);
    const lidBL = S('path', { d: 'M0 0', fill: 'none', stroke: shade(body, 0.4), 'stroke-width': 1, 'stroke-linecap': 'round' }, lids);
    S('ellipse', { cx: 0, cy: 0, rx: EYE.rx, ry: EYE.ry, fill: 'none', stroke: '#141416', 'stroke-width': 1.35 }, eyeN);
    const eyeCl = S('path', { d: 'M-6.3 0.2Q0 4.8 6.3 0.2', fill: 'none', stroke: '#141416', 'stroke-width': 2.4, 'stroke-linecap': 'round', opacity: 0 }, eyeG);
    const eyeHap = S('path', { d: 'M-6.4 3Q0 -6.8 6.4 3', fill: 'none', stroke: '#141416', 'stroke-width': 2.6, 'stroke-linecap': 'round', opacity: 0 }, eyeG);
    const eyeSq = S('path', { d: 'M-4.8 -5.2L4.6 0L-4.8 5.2', fill: 'none', stroke: '#141416', 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0 }, eyeG);
    const eyeSp = S('g', { opacity: 0 }, eyeG);
    S('ellipse', { cx: 0, cy: 0, rx: EYE.rx, ry: EYE.ry, fill: '#fff', stroke: '#141416', 'stroke-width': 1.35 }, eyeSp);
    const spiral = S('path', { d: 'M0 0C0.9 -1.2 2.6 -0.2 2.2 1.4C1.7 3.4 -1.4 3.6 -2.7 1.8C-4.2 -0.4 -2.8 -3.8 0 -4.4C3.2 -5 5.4 -2 4.9 1.2', fill: 'none', stroke: '#141416', 'stroke-width': 1.5, 'stroke-linecap': 'round' }, eyeSp);
    const brow = S('path', { d: 'M-7 0.6Q0 -2.6 7 0.6', fill: 'none', stroke: '#141416', 'stroke-width': 2.4, 'stroke-linecap': 'round', opacity: 0 }, front);
    const sweat = S('path', { d: 'M0 -5C2.4 -1.6 3.6 0.6 3.6 2.2A3.6 3.6 0 0 1 -3.6 2.2C-3.6 0.6 -2.4 -1.6 0 -5Z', fill: '#A6DBF5', stroke: '#5FAAD2', 'stroke-width': 0.8, opacity: 0 }, front);
    const headG = S('g', {}, front);
    const antG = S('g', {}, front);
    const antE = [0, 1].map((j) => S('path', { d: 'M0 0', fill: 'none', stroke: shade(body, j ? 0.1 : 0.22), 'stroke-width': 2.8, 'stroke-linecap': 'round' }, antG));
    const faceG = S('g', {}, front);
    const propG = S('g', {}, front);
    const noseWh = S('g', { display: 'none' }, front); drawWhistle(noseWh);
    const fxG = S('g', {}, root);
    const cartH = S('g', { display: 'none' }, svg);
    const cartG = S('g', { display: 'none' }, svg);
    let cart = null;

    // lazily built wardrobe
    const hats = {}, faces = {}, necks = {}, props = {};
    let lanyard = null;
    function buildHat(name) {
      if (hats[name] || !HATS[name]) return;
      const h = HATS[name]; ensureGrads(h);
      const g = S('g', { display: 'none' }, headG), e = {};
      h.build(g, url, e, id); hats[name] = { g, e, h };
    }
    function buildFace(name) { if (faces[name] || !FACEWEAR[name]) return; const g = S('g', { display: 'none' }, faceG); FACEWEAR[name].build(g); faces[name] = { g }; }
    function buildNeck(name) { if (necks[name] || !NECKWEAR[name]) return; const g = S('g', { display: 'none' }, neckG), e = {}; NECKWEAR[name].build(g, e); necks[name] = { g, e, h: NECKWEAR[name] }; }
    function buildProp(name) {
      if (!name || props[name]) return;
      if (!PROPS[name]) { warn('unknown prop ' + name); return; }
      if (name === 'cart') { if (!cart) cart = buildCart(cartG, cartH); props.cart = { g: cartG, e: cart, def: PROPS.cart }; return; }
      const g = S('g', { display: 'none' }, PROPS[name].attach === 'head' ? propBackG : propG), e = {};
      const inner2 = S('g', {}, g); PROPS[name].build(inner2, e); props[name] = { g, e, def: PROPS[name] };
    }
    if (V.lanyard) {
      lanyard = S('g', {}, neckG);
      S('path', { d: 'M12 24C15 31 18.6 34.6 20.6 35.6', fill: 'none', stroke: '#3A3A44', 'stroke-width': 1.1 }, lanyard);
      const w = S('g', { transform: 'translate(19 38) rotate(28) scale(0.85)' }, lanyard); drawWhistle(w);
    }

    /* ----- recorded state ----- */
    const st = {
      segs: [], eff: [], lay: [], fx: [], says: [],
      face: new Track(facing0), scl: new Track(1), alpha: new Track(o.hidden ? 0 : 1),
      expr: [{ t: -Infinity, name: 'neutral' }], look: [{ t: -Infinity, lx: 0, ly: 0 }],
      prop: new StateTrack(V.prop || null),
      head: new StateTrack(V.head || null), faceW: new StateTrack(V.face || null), neck: new StateTrack(V.neck || null),
      blinks: [], lifeBlinks: [], maxEnd: 0, odo: 0,
    };
    buildProp(V.prop); if (V.head) buildHat(V.head); if (V.face) buildFace(V.face); if (V.neck) buildNeck(V.neck);
    { let b = 0.5 + rnd() * 2.2; while (b < 400) { st.lifeBlinks.push(b); if (rnd() < 0.16) st.lifeBlinks.push(b + 0.24); b += 2.5 + rnd() * 2.8; } }
    const breathPh = rnd() * TAU, swayPh = rnd() * TAU;

    const m = { el, svg, variant, size, x: x0, y: y0, facing: facing0, id, color: body };
    const mark = (t) => { if (tl && t > st.maxEnd + 1e-6) { st.maxEnd = t; tl.set({}, {}, t); } };
    const panOf = (x) => clamp((x - W / 2) / (W / 2), -1, 1) * 0.45;
    const cueRef = (at, name, opt) => { cue(at, name, opt); const FF = window.F; return FF && FF.cues ? FF.cues[FF.cues.length - 1] : null; };

    const eff = (t0, t1, fn) => { st.eff.push({ t0, t1, fn }); };
    const layer = (t0, t1, fi, fo, fn) => { st.lay.push({ t0, t1, fi, fo, fn }); st.lay.sort((a, b) => a.t0 - b.t0); };
    const fsAt = (t) => (st.face.at(t) >= 0 ? 1 : -1);

    /* ----- locomotion: segments in time order; each starts where the mascot is at its start ----- */
    const still = (x, y, odo) => ({ x, y, gy: y, lift: 0, ph: 0, amp: 0, air: 0, rot: 0, odo, gait: null, Lu: 0, shadow: 1 });
    function locoAt(t) {
      let s = null;
      for (const g of st.segs) { if (g.t0 <= t) s = g; else break; }
      if (!s) return still(x0, y0, 0);
      return t < s.t1 ? s.ev(t) : s.endS;
    }
    function cut(g, t) {
      const s = g.ev(t);
      g.endS = still(s.x, s.gy, s.odo); g.t1 = t; g.cutAt = t;
      const FF = window.F;
      if (FF && FF.cues && g.cues) for (const c of g.cues) if (c.ref && c.at > t + 1e-4) { const i = FF.cues.indexOf(c.ref); if (i >= 0) FF.cues.splice(i, 1); }
    }
    function addSeg(seg) {
      for (const g of st.segs) if (g.t0 < seg.t0 && seg.t0 < g.t1) cut(g, seg.t0);
      st.segs.push(seg); st.segs.sort((a, b) => a.t0 - b.t0);
      mark(seg.t1);
      return seg;
    }
    const segCue = (seg, at, name, opt) => { seg.cues.push({ at, ref: cueRef(at, name, opt) }); };
    const live = (seg, t) => seg.cutAt == null || t <= seg.cutAt;
    function placeSeg(at, x, y) { addSeg({ t0: at, t1: at, endS: still(x, y, locoAt(at).odo), cues: [] }); }

    function walkSeg(at, to, dur, style = 'walk') {
      const A = locoAt(at), ax = A.x, ay = A.gy, bx = to[0], by = to[1], odo0 = A.odo;
      const D = Math.hypot(bx - ax, by - ay), G = GAITS[style] || GAITS.walk;
      if (D < 1) { placeSeg(at, bx, by); return 0; }
      const spd = { walk: 1.7, run: 3.4, march: 1.45, sneak: 0.95 }[style] || 1.7;
      const T = Math.max(0.3, dur ?? D / (spd * size));
      const tr = Math.min(style === 'run' ? 0.14 : 0.2, T * 0.3), v = D / (T - tr), ar = Math.max(tr, 0.12);
      const sAt = (u) => (u <= 0 ? 0 : u >= T ? D : u < tr ? (v * u * u) / (2 * tr) : u < T - tr ? (v * tr) / 2 + v * (u - tr) : D - (v * (T - u) ** 2) / (2 * tr));
      const n = Math.max(2, Math.round(clamp(D / (2 * G.L * k), G.cad[0] * T, G.cad[1] * T)));
      const Lu = clamp(D / (2 * n * k), 2, 12);
      const seg = {
        t0: at, t1: at + T, kind: 'walk', cues: [],
        ev(t) {
          const tau = t - at, s = sAt(tau), u = s / D, yy = lerp(ay, by, u);
          return { x: lerp(ax, bx, u), y: yy, gy: yy, lift: 0, ph: Math.PI * n * u, amp: G.amp * smooth(Math.min(tau, T - tau) / ar), air: 0, rot: 0, odo: odo0 + s, gait: G, Lu, shadow: 1 };
        },
        endS: still(bx, by, odo0 + D),
      };
      if (Math.abs(bx - ax) > 2) faceTo(at, bx > ax ? 1 : -1);
      for (let j = 1; j <= n; j++) {
        let lo = 0, hi = T; const target = (D * j) / n;
        for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (sAt(mid) < target) lo = mid; else hi = mid; }
        segCue(seg, at + hi, 'step', { gain: style === 'run' ? 0.3 : style === 'sneak' ? 0.12 : 0.25, pan: panOf(lerp(ax, bx, j / n)) });
      }
      addSeg(seg);
      return T;
    }

    function hopSeg(at, to, height, dur, o = {}) {
      const A = locoAt(at), ax = A.x, ay = A.gy, bx = to[0], by = to[1], odo0 = A.odo;
      const ta = o.ant ?? Math.min(0.13, dur * 0.26), Ta = Math.max(0.14, dur - ta);
      const Hh = height + Math.abs(ay - by) / 2, dx = Math.abs(bx - ax);
      if (dx > 2 && o.face !== false) faceTo(at, bx > ax ? 1 : -1);
      const seg = {
        t0: at, t1: at + ta + Ta, kind: 'hop', cues: [],
        ev(t) {
          const tau = t - at; if (tau < ta) return still(ax, ay, odo0);
          const u = c01((tau - ta) / Ta), ux = lerp(u, sio(u), 0.35), gy = lerp(ay, by, u), yy = gy - 4 * Hh * u * (1 - u);
          return { x: lerp(ax, bx, ux), y: yy, gy, lift: gy - yy, ph: 0, amp: 0, air: Math.min(1, u / 0.08, (1 - u) / 0.1), rot: 0, odo: odo0 + dx * ux, gait: null, Lu: 0, shadow: 1 };
        },
        endS: still(bx, by, odo0 + dx),
      };
      const sqA = o.squash ?? 0.2, landA = o.land ?? 0.24, fwd = dx > 2 ? 1 : 0;
      eff(at, at + ta + Ta + 0.75, (tau, P, t) => {
        if (!live(seg, t)) return;
        if (tau < ta) { const q = sio(tau / ta); P.sq += sqA * q; P.nA += 6 * q; P.antD += 0.25 * q; return; }
        const ua = (tau - ta) / Ta;
        if (ua <= 1) {
          const sAir = -0.15 * Math.pow(Math.abs(1 - 2 * ua), 1.4);
          P.sq += tau - ta < 0.05 ? lerp(sqA, sAir, (tau - ta) / 0.05) : sAir;
          P.tilt += 8 * fwd * bump(ua); return;
        }
        P.sq += landA * ring(tau - ta - Ta, 2.8, 7.5);
      });
      segCue(seg, at + ta, o.sfx || 'hop', { gain: o.sfx === 'boing' ? 0.7 : 0.55, pan: panOf(ax) });
      if (o.landSfx !== false) segCue(seg, at + ta + Ta, o.landSfx || 'land', { gain: 0.5, pan: panOf(bx) });
      addSeg(seg);
      return { ta, Ta, seg };
    }

    function dropSeg(at, to, dur, fromY) {
      const bx = to[0], by = to[1], odo0 = locoAt(at).odo;
      const Tf = dur * 0.6, Tb = dur - Tf, hb = Math.min((by - fromY) * 0.14, size * 0.28);
      const airState = (yy, air) => ({ x: bx, y: yy, gy: by, lift: by - yy, ph: 0, amp: 0, air, rot: 0, odo: odo0, gait: null, Lu: 0, shadow: 1 });
      const seg = {
        t0: at, t1: at + dur, kind: 'drop', cues: [],
        ev(t) {
          const tau = t - at;
          if (tau < Tf) return airState(lerp(fromY, by, p2i(tau / Tf)), 1);
          const u = c01((tau - Tf) / Tb); return airState(by - 4 * hb * u * (1 - u), Math.min(1, u / 0.15, (1 - u) / 0.15));
        },
        endS: still(bx, by, odo0),
      };
      eff(at, at + dur + 0.75, (tau, P, t) => {
        if (!live(seg, t)) return;
        if (tau < Tf) { P.sq -= 0.2 * p2i(tau / Tf); return; }
        const t1 = tau - Tf;
        if (t1 < Tb) { P.sq += 0.42 * (1 - smooth(t1 / (Tb * 0.45))) - 0.08 * bump(t1 / Tb); return; }
        P.sq += 0.22 * ring(t1 - Tb, 2.8, 7.5);
      });
      layer(at, at + Tf + 0.12, 0.05, 0.1, () => EXPR.surprised);
      layer(at + Tf, at + Tf + 0.2, 0, 0.1, () => ({ squeeze: 1, antD: 0.8 }));
      segCue(seg, at, 'swish-down', { gain: 0.4, pan: panOf(bx) });
      segCue(seg, at + Tf, 'thud', { gain: 0.75, pan: panOf(bx) });
      segCue(seg, at + dur, 'land', { gain: 0.4, pan: panOf(bx) });
      return addSeg(seg);
    }

    function launchSeg(at, to, dur, fromY) {
      const bx = to[0], by = to[1], odo0 = locoAt(at).odo, apex = by - size * 0.4;
      const Tu = dur * 0.58, Td = dur - Tu;
      const seg = {
        t0: at, t1: at + dur, kind: 'launch', cues: [],
        ev(t) {
          const tau = t - at, yy = tau < Tu ? lerp(fromY, apex, p2o(tau / Tu)) : lerp(apex, by, p2i((tau - Tu) / Td));
          return { x: bx, y: yy, gy: by, lift: by - yy, ph: 0, amp: 0, air: Math.min(1, (dur - tau) / 0.06), rot: 0, odo: odo0, gait: null, Lu: 0, shadow: 1 };
        },
        endS: still(bx, by, odo0),
      };
      eff(at, at + dur + 0.75, (tau, P, t) => {
        if (!live(seg, t)) return;
        if (tau < Tu) { P.sq -= 0.24 * (1 - p2o(tau / Tu)); return; }
        if (tau < dur) { P.sq -= 0.1 * p2i((tau - Tu) / Td); return; }
        P.sq += 0.26 * ring(tau - dur, 2.8, 7.5);
      });
      layer(at, at + dur + 0.3, 0.05, 0.2, () => ({ hap: 0, eS: 1.12, antP: 1 }));
      segCue(seg, at, 'swoosh-up', { gain: 0.5, pan: panOf(bx) });
      segCue(seg, at + dur, 'land', { gain: 0.5, pan: panOf(bx) });
      return addSeg(seg);
    }

    /** leave through the top (yanked up after a crouch) or the bottom (a little hop, then down through the floor) */
    function offSeg(at, dur, up) {
      const A = locoAt(at), ax = A.x, ay = A.gy, odo0 = A.odo, ta = Math.min(0.12, dur * 0.25), Tm = dur - ta;
      const far = up ? ay + size * 1.6 + 120 : -(H - ay + size * 1.4 + 80);
      const hb = size * 0.22;
      const seg = {
        t0: at, t1: at + dur, kind: 'off', cues: [],
        ev(t) {
          const tau = t - at; if (tau < ta) return still(ax, ay, odo0);
          const u = c01((tau - ta) / Tm);
          let lift;
          if (up) lift = far * (1 - Math.pow(1 - u, 1.6));
          else lift = u < 0.3 ? hb * p2o(u / 0.3) : lerp(hb, far, p2i((u - 0.3) / 0.7));
          return { x: ax, y: ay - lift, gy: ay, lift, ph: 0, amp: 0, air: 1, rot: 0, odo: odo0, gait: null, Lu: 0, shadow: up ? 1 : smooth(1 + lift / (size * 0.3)) };
        },
        endS: still(ax, ay - far, odo0),
      };
      eff(at, at + dur, (tau, P, t) => {
        if (!live(seg, t)) return;
        if (tau < ta) { P.sq += 0.2 * sio(tau / ta); return; }
        P.sq -= up ? 0.26 : 0.16;
      });
      if (up) { segCue(seg, at + ta, 'hop', { gain: 0.5, pan: panOf(ax) }); segCue(seg, at + ta, 'swoosh-up', { gain: 0.5, pan: panOf(ax) }); }
      else segCue(seg, at + ta + Tm * 0.3, 'swish-down', { gain: 0.5, pan: panOf(ax) });
      return addSeg(seg);
    }

    function rideSeg(at, path, dur, o = {}) {
      const pts = path.map((p) => ptOf(p, [m.x, m.y]));
      if (pts.length < 2) { warn('ride needs at least 2 points'); return null; }
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const Lt = cum[cum.length - 1], odo0 = locoAt(at).odo;
      if (Lt < 1) { placeSeg(at, pts[0][0], pts[0][1]); return null; }
      const posAt = (s) => {
        s = clamp(s, 0, Lt); let i = 0;
        while (i < cum.length - 2 && cum[i + 1] < s) i++;
        const u = (s - cum[i]) / Math.max(1e-6, cum[i + 1] - cum[i]);
        return [lerp(pts[i][0], pts[i + 1][0], u), lerp(pts[i][1], pts[i + 1][1], u)];
      };
      let fsg = 0;
      for (let i = 1; i < pts.length && !fsg; i++) { const dx = pts[i][0] - pts[0][0]; if (Math.abs(dx) > 3) fsg = Math.sign(dx); }
      if (!fsg) fsg = fsAt(at);
      const wv = Math.max(6, size * 0.14), N = Math.max(2, Math.ceil(Lt / 4)), ang = [];
      for (let i = 0; i <= N; i++) {
        const s = (Lt * i) / N, a = posAt(s - wv), b = posAt(s + wv);
        let th = fsg * Math.atan2(b[1] - a[1], (b[0] - a[0]) * fsg) / RAD;
        if (o.tilt === false) th = 0;
        if (i) { while (th - ang[i - 1] > 180) th -= 360; while (th - ang[i - 1] < -180) th += 360; }
        if (o.maxTilt != null) th = clamp(th, -o.maxTilt, o.maxTilt);
        ang.push(th);
      }
      const angAt = (s) => { const q = (clamp(s, 0, Lt) / Lt) * N, i = Math.min(N - 1, Math.floor(q)); return lerp(ang[i], ang[i + 1], q - i); };
      const T = dur, tr = Math.min(0.25, T * 0.2), v = Lt / (T - tr);
      const sAt = (u) => (u <= 0 ? 0 : u >= T ? Lt : u < tr ? (v * u * u) / (2 * tr) : u < T - tr ? (v * tr) / 2 + v * (u - tr) : Lt - (v * (T - u) ** 2) / (2 * tr));
      const endP = pts[pts.length - 1], endA = angAt(Lt);
      if (fsg !== fsAt(at)) faceTo(at, fsg);
      const seg = {
        t0: at, t1: at + T, kind: 'ride', cues: [],
        ev(t) {
          const tau = t - at, s = sAt(tau), p = posAt(s);
          return { x: p[0], y: p[1], gy: p[1], lift: 0, ph: 0, amp: 0, air: 0, rot: angAt(s) * smooth(tau / 0.15), odo: odo0 + s, gait: null, Lu: 0, shadow: 1 - smooth(tau / 0.12) };
        },
        endS: still(endP[0], endP[1], odo0 + Lt),
      };
      eff(at + T, at + T + 0.32, (tau, P, t) => { if (!live(seg, t)) return; const q = smooth(tau / 0.3); P.rot += endA * (1 - q); P.shadow *= q; P.sq += 0.12 * bump(tau / 0.3); });
      layer(at, at + T, 0.15, 0.2, (tau) => ({ sq: 0.07, lidB: 0.3, blush: 0.5, pS: 1.05, antP: 0.35, antW: 0.35, nA: -6 }));
      segCue(seg, at, 'zip', { gain: 0.6, pan: panOf(pts[0][0]) });
      segCue(seg, at + T, 'land', { gain: 0.35, pan: panOf(endP[0]) });
      addSeg(seg);
      return endP;
    }

    function faceTo(at, dir) {
      dir = dir < 0 ? -1 : 1;
      m.facing = dir;
      if (Math.round(st.face.at(at + 0.17)) === dir && Math.round(st.face.at(at)) === dir) return;
      st.face.add(at, dir, 0.16, sio);
      eff(at, at + 0.2, (tau, P) => { const b = bump(tau / 0.18); P.by += 2.4 * b; P.sq -= 0.035 * b; });
    }

    /* ----- FX: small film-native extras (stars, sparkles, zzz, impact ticks) in root coords ----- */
    function fx(t0, t1, build, update) { const g = S('g', { display: 'none' }, fxG); const s = build(g) || {}; st.fx.push({ t0, t1, g, s, update }); mark(t1); }
    const STAR = (() => { let d = ''; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 2.3 : 5.4; d += (i ? 'L' : 'M') + f2(Math.cos(a) * r) + ' ' + f2(Math.sin(a) * r); } return d + 'Z'; })();
    const SPARK = 'M0 -6Q0 0 6 0Q0 0 0 6Q0 0 -6 0Q0 0 0 -6Z';
    const SPARK_C = ['#EFA63C', '#F2C230', '#5BAE5B', '#5B56C9', '#E76A5A'];
    function fxStars(at, dur, n = 3, scaleK = 1) {
      fx(at, at + dur, (g) => ({ st: Array.from({ length: n }, () => S('path', { d: STAR, fill: '#F2C230', stroke: '#C9921B', 'stroke-width': 0.8, 'stroke-linejoin': 'round' }, g)) }),
        (tau, C, s) => {
          const c = C.toRoot([2, -R - 7]), op = Math.min(1, tau / 0.12, (dur - tau) / 0.2);
          s.st.forEach((p, i) => {
            const a = TAU * (0.95 * tau + i / n), depth = Math.sin(a);
            const sc = (0.75 + 0.3 * depth) * scaleK * Math.min(1, tau / 0.15 + 0.3);
            setA(p, 'transform', `translate(${f2(c[0] + 30 * Math.cos(a))} ${f2(c[1] + 8 * depth)}) rotate(${f2(tau * 200 + i * 40)}) scale(${f2(sc)})`);
            setA(p, 'opacity', f2(op * (depth < -0.2 ? 0.55 : 1)));
          });
        });
    }
    function fxSparkle(at, dur = 0.65, n = 9) {
      fx(at, at + dur, (g) => ({ p: Array.from({ length: n }, (_, i) => S('path', { d: SPARK, fill: SPARK_C[i % SPARK_C.length] }, g)) }),
        (tau, C, s) => {
          const c = C.toRoot([4, -R - 6]), u = tau / dur;
          s.p.forEach((p, i) => {
            const a = -Math.PI / 2 + (i / n - 0.5) * Math.PI * 1.7, r = 26 + 40 * p3o(u) + (i % 2) * 8;
            setA(p, 'transform', `translate(${f2(c[0] + Math.cos(a) * r)} ${f2(c[1] + Math.sin(a) * r * 0.85)}) scale(${f2((1 - u) * (0.7 + (i % 3) * 0.25) * Math.min(1, u * 8))})`);
          });
        });
    }
    function fxImpact(at, getPt, color = INK) {
      fx(at, at + 0.34, (g) => ({ l: [0, 1, 2, 3].map(() => S('path', { d: 'M0 0', stroke: color, 'stroke-width': 2.2, 'stroke-linecap': 'round', fill: 'none' }, g)) }),
        (tau, C, s) => {
          const c = getPt(C), u = tau / 0.34, r0 = 6 + 10 * p2o(u), r1 = r0 + 7 * (1 - u);
          s.l.forEach((p, i) => {
            const a = (-150 + i * 40) * RAD * (C.fs > 0 ? 1 : 1);
            setA(p, 'd', `M${f2(c[0] + Math.cos(a) * r0)} ${f2(c[1] + Math.sin(a) * r0)}L${f2(c[0] + Math.cos(a) * r1)} ${f2(c[1] + Math.sin(a) * r1)}`);
            setA(p, 'opacity', f2(1 - u));
          });
        });
    }
    function fxSound(at, dur) {
      fx(at, at + dur, (g) => ({ l: [0, 1, 2].map(() => S('path', { d: 'M0 0', stroke: INK, 'stroke-width': 2, 'stroke-linecap': 'round', fill: 'none' }, g)) }),
        (tau, C, s) => {
          const tip = C.noseTip, d = C.noseDir;
          s.l.forEach((p, i) => {
            const ph = ((tau * 3.2 + i * 0.33) % 1 + 1) % 1, a = (i - 1) * 32 * RAD, r0 = 11 + ph * 10, r1 = r0 + 6;
            const ca = Math.cos(a), sa = Math.sin(a), dx = (d[0] * ca - d[1] * sa), dy = (d[0] * sa + d[1] * ca);
            setA(p, 'd', `M${f2(tip[0] + dx * r0)} ${f2(tip[1] + dy * r0)}L${f2(tip[0] + dx * r1)} ${f2(tip[1] + dy * r1)}`);
            setA(p, 'opacity', f2(bump(ph) * Math.min(1, (dur - tau) / 0.12)));
          });
        });
    }
    function fxZzz(at, dur) {
      fx(at, at + dur, (g) => ({ z: [0, 1, 2].map(() => { const e = S('text', { 'font-family': 'Poppins, sans-serif', 'font-weight': 700, 'font-size': 12, fill: INK, 'text-anchor': 'middle' }, g); e.textContent = 'z'; return e; }) }),
        (tau, C, s) => {
          const c = C.toRoot([14, -R - 4]);
          s.z.forEach((e, i) => {
            const ph = ((tau / 1.6 + i / 3) % 1 + 1) % 1, fade = Math.min(1, (dur - tau) / 0.3, tau / 0.3);
            setA(e, 'x', f2(c[0] + C.fs * (8 + 18 * ph) + Math.sin(ph * 7) * 2)); setA(e, 'y', f2(c[1] - 6 - 34 * ph));
            setA(e, 'font-size', f2(9 + 9 * ph)); setA(e, 'opacity', f2(bump(Math.min(1, ph * 1.15)) * fade));
          });
        });
    }
    function fxScribble(at, dur, tipF) {
      fx(at, at + dur + 0.45, (g) => ({ p: S('path', { d: 'M0 0C3 -5 6 5 9 0C12 -5 15 5 18 0C21 -5 24 5 27 0', fill: 'none', stroke: INK, 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-dasharray': '60', 'stroke-dashoffset': '60' }, g) }),
        (tau, C, s) => {
          const p0 = C.toRoot(tipF);
          setA(s.p, 'transform', `translate(${f2(p0[0] - (C.fs < 0 ? 27 : 0))} ${f2(p0[1])})`);
          setA(s.p, 'stroke-dashoffset', f2(60 * (1 - c01(tau / dur))));
          setA(s.p, 'opacity', f2(Math.min(1, (dur + 0.45 - tau) / 0.3)));
        });
    }

    function equip(at, t1, name, allow = []) {
      const cur = st.prop.at(at).v;
      if (cur === name || allow.includes(cur)) return cur;
      buildProp(name); st.prop.override(at - 0.14, t1 + 0.12, name);
      return name;
    }
    function lookVec(at, target) {
      if (target == null || target === 'forward' || target === 'ahead') return { lx: 0, ly: 0 };
      if (target === 'up') return { lx: 0.25, ly: -1 };
      if (target === 'down') return { lx: 0.35, ly: 1 };
      if (target === 'viewer' || target === 'camera') return { lx: -0.62, ly: 0.06 };
      if (target === 'back') return { lx: -1, ly: 0 };
      const p = ptOf(target, [m.x, m.y]), A = locoAt(at), fs = fsAt(at);
      const ex = A.x + fs * EYE.x * k, ey = A.gy - A.lift + (BALL_Y + EYE.y) * k;
      const dx = (p[0] - ex) * fs, dy = p[1] - ey, d = Math.hypot(dx, dy) || 1;
      return { lx: dx / d, ly: (dy / d) * 1.1 };
    }

    /** nose-held prop matrix (facing coords) for a given nose angle offset / length — pure, used by FX anchors too */
    function noseFrame(P2) {
      const na = (NOSE.ang + P2.nA) * RAD, nl = NOSE.len * P2.nL * (1 - 0.3 * Math.abs(P2.shk || 0));
      const tx = NOSE.x + nl * Math.cos(na), ty = NOSE.y + nl * Math.sin(na), e2 = NOSE.r1 - 1.5;
      return mat.mul(mat.tr(tx + Math.cos(na) * e2, ty + Math.sin(na) * e2), mat.rot(na / RAD));
    }
    function propMatrix(d, P2, s, spX) {
      let base;
      if (d.attach === 'nose') { base = noseFrame(P2); if (d.at) base = mat.mul(base, mat.tr(d.at[0], d.at[1])); }
      else base = mat.tr(d.at[0], d.at[1]);
      let rot = d.rot + P2.pRot;
      if (d.upright) rot -= NOSE.ang + P2.nA;
      if (d.wobble || d.upright) rot += clamp(-spX * (d.wobble ? 2.4 : 1.4), -18, 18);
      const g = d.grip || [0, 0];
      return mat.mul(mat.mul(mat.mul(base, mat.rot(rot)), mat.sc(s * (d.scale ?? 1))), mat.tr(-g[0], -g[1]));
    }
    const USES = {
      stamp(at) {   // head-bob strike: rear back, then drive the nose (and the stamp hanging off it) down
        equip(at, at + 0.75, 'stamp');
        layer(at, at + 0.75, 0.08, 0.18, (u) => (u < 0.28 ? { nA: lerp(0, -26, sio(u / 0.28)), tilt: lerp(0, -7, sio(u / 0.28)) }
          : u < 0.35 ? { nA: lerp(-26, 24, p2i((u - 0.28) / 0.07)), tilt: lerp(-7, 15, p2i((u - 0.28) / 0.07)) } : { nA: 24, tilt: 15 }));
        layer(at + 0.33, at + 0.62, 0.02, 0.1, () => ({ squeeze: 1, antD: 0.4 }));
        eff(at, at + 1.2, (u, P) => { P.sq += u < 0.35 ? -0.07 * sio(u / 0.28) : 0.16 * ring(u - 0.35, 2.6, 7); });
        cue(at + 0.35, 'stamp', { gain: 0.9, pan: panOf(m.x) });
        fxImpact(at + 0.35, (C) => C.propAt(0, 4.5));
        mark(at + 0.75);
      },
      whistle(at) {
        layer(at, at + 0.9, 0.1, 0.15, (u) => ({ whistle: u > 0.08 ? 1 : 0, squeeze: 1, blush: 0.6, nA: -5, antP: 1 }));
        eff(at, at + 0.9, (u, P) => { if (u < 0.15) { P.sq -= 0.08 * sio(u / 0.15); return; } P.sq += 0.06 + 0.02 * Math.sin(u * 70); P.nL += 0.05; });
        fxSound(at + 0.15, 0.72);
        cue(at + 0.15, 'blip', { gain: 0.85, rate: 1.8, pan: panOf(m.x) });
        cue(at + 0.48, 'blip', { gain: 0.6, rate: 2.1, pan: panOf(m.x) });
        mark(at + 0.9);
      },
      hammer(at, o2) {   // the hammer rides along the nose; each hit is a head-bob
        const n = Math.max(1, o2.times ?? 2), per = 0.34, dur = n * per + 0.08;
        equip(at, at + dur, 'hammer', ['wrench']);
        layer(at, at + dur, 0.08, 0.16, (u) => {
          const i = Math.min(n - 1, Math.floor(u / per)), v = u - i * per, n0 = i ? 30 : 0, t0 = i ? 14 : 0;
          if (v < 0.2) return { nA: lerp(n0, -32, sio(v / 0.2)), tilt: lerp(t0, -6, sio(v / 0.2)) };
          if (v < 0.26) return { nA: lerp(-32, 30, p2i((v - 0.2) / 0.06)), tilt: lerp(-6, 14, p2i((v - 0.2) / 0.06)) };
          return { nA: 30, tilt: 14 };
        });
        for (let i = 0; i < n; i++) {
          const th = at + i * per + 0.26;
          eff(th, th + 0.6, (u, P) => { P.sq += 0.1 * ring(u, 3, 9); });
          layer(th, th + 0.12, 0.01, 0.05, () => ({ squeeze: 1 }));
          cue(th, 'tap', { gain: 0.9, pan: panOf(m.x) });
          fxImpact(th, (C) => C.propAt(11, -23.5));
        }
        mark(at + dur);
      },
      magnify(at, o2) {   // the nose lifts the lens in front of the eye and sweeps it
        const dur = o2.dur ?? 1.4;
        equip(at, at + dur, 'magnifier');
        layer(at, at + dur, 0.24, 0.22, (u) => ({ nA: -28 + 5 * Math.sin(TAU * 0.9 * u), pRot: -104 + 7 * Math.sin(TAU * 0.9 * u + 0.5), eS: 1.45, pS: 1.12, lx: 0.55, ly: 0.25 * Math.sin(TAU * 0.9 * u + 0.6), brO: 0.8, brY: -3, antL: 18 }));
        cue(at, 'blip', { gain: 0.35, pan: panOf(m.x) });
        mark(at + dur);
      },
      write(at, o2) {
        const dur = o2.dur ?? 1;
        if (st.prop.at(at).v === 'clipboard') {   // ticks appear while the head nods along
          layer(at, at + dur, 0.16, 0.2, (u) => ({ nA: 12 + 5 * Math.sin(TAU * 5 * u), tilt: 5, tick: c01((u - 0.15) / (dur * 0.7)), lx: -0.8, ly: 0.85 }));
        } else {                                   // a nose scribble with the pencil
          equip(at, at + dur, 'pencil');
          layer(at, at + dur, 0.14, 0.18, (u) => ({ nA: 9 + 3 * Math.sin(TAU * 6 * u), pRot: -22 + 4 * Math.sin(TAU * 4.5 * u), nL: 1 + 0.05 * Math.sin(TAU * 3 * u), tilt: 5, lx: 0.6, ly: 0.9 }));
          const tipF = mat.ap(propMatrix(PROPS.pencil, Object.assign({}, BASE, { nA: 9, pRot: -22 }), 1, 0), 0, -33.8);
          fxScribble(at + 0.12, dur - 0.2, tipF);
        }
        cue(at + 0.1, 'scratch', { gain: 0.5, pan: panOf(m.x) });
        mark(at + dur);
      },
      push(at, o2) {   // a nose shove
        const fs = fsAt(at), px = (o2.dist ?? 0.07) * size;
        const lunge = (u) => (u < 0.15 ? -0.4 * sio(u / 0.15) : u < 0.32 ? lerp(-0.4, 1, p2o((u - 0.15) / 0.17)) : u < 0.42 ? 1 : 1 - sio((u - 0.42) / 0.26));
        eff(at, at + 0.68, (u, P) => { const q = lunge(u); P.tilt += 16 * q; P.nL += 0.16 * Math.max(0, q); P.ox += fs * px * Math.max(0, q); P.cartDx += 14 * Math.max(0, q); P.sq -= 0.05 * Math.max(0, q); });
        layer(at, at + 0.68, 0.1, 0.15, () => ({ squeeze: 1, antP: 0.6 }));
        cue(at + 0.15, 'slide', { gain: 0.7, pan: panOf(m.x) });
        mark(at + 0.68);
      },
      sip(at, o2) {   // the cup balances on the nose; lift it, eyes shut, bliss
        const dur = o2.dur ?? 1.1;
        equip(at, at + dur, 'coffee');
        layer(at, at + dur, 0.22, 0.25, (u) => ({ nA: -22, hap: u > 0.25 ? 1 : 0, blush: 0.6, antP: 0.3, tilt: -4 }));
        cue(at + 0.3, 'blip', { gain: 0.3, pan: panOf(m.x) });
        mark(at + dur);
      },
    };
    USES.magnifier = USES.magnify; USES.scan = USES.magnify; USES.hit = USES.hammer; USES.blow = USES.whistle;

    /* ----- public actions (all chainable; `at` = scene-local seconds) ----- */
    const dirOf = (d) => (d === 'left' ? -1 : d === 'right' ? 1 : d < 0 ? -1 : 1);
    const firstAppearance = (at) => !st.segs.some((g) => g.t0 < at) && !st.alpha.ev.some((e) => e.t < at);
    Object.assign(m, {
      place(at, px, py, o2 = {}) {
        placeSeg(at, px, py); m.x = px; m.y = py;
        if (o2.facing) { const d = dirOf(o2.facing); st.face.add(at, d, 0); m.facing = d; }
        mark(at); return m;
      },
      enter(at, o2 = {}) {
        const from = o2.from || 'left', to = ptOf(o2.to, [m.x, m.y]);
        if (firstAppearance(at)) st.alpha.v0 = 0;
        st.alpha.add(at, 1, 0);
        if (from === 'left' || from === 'right') {
          const s = o2.start ? ptOf(o2.start, to) : [from === 'left' ? -size * 0.8 : W + size * 0.8, to[1]];
          placeSeg(at, s[0], s[1]);
          walkSeg(at, to, o2.dur, o2.run ? 'run' : o2.style || 'walk');
        } else if (from === 'top') {
          dropSeg(at, to, o2.dur ?? 0.8, o2.fromY ?? -24);
        } else if (from === 'bottom') {
          launchSeg(at, to, o2.dur ?? 0.72, o2.fromY ?? Math.max(H + size * 1.25, to[1] + size * 1.3));
        } else { // 'pop': spring up out of nothing, in place
          placeSeg(at, to[0], to[1]);
          if (!st.scl.ev.some((e) => e.t < at)) st.scl.v0 = 0;
          st.scl.add(at, 0, 0); st.scl.add(at, 1, o2.dur ?? 0.38, (u) => backOut(u, 2.4));
          cue(at, 'pop', { gain: 0.6, pan: panOf(to[0]) }); mark(at + (o2.dur ?? 0.38));
        }
        if (o2.facing) faceTo(at, dirOf(o2.facing));
        m.x = to[0]; m.y = to[1]; return m;
      },
      exit(at, o2 = {}) {
        const to = o2.to || 'right', A = locoAt(at); let end = at;
        if (to === 'left' || to === 'right') {
          const tx = o2.x ?? (to === 'left' ? -size * 0.8 : W + size * 0.8);
          end = at + walkSeg(at, [tx, A.gy], o2.dur, o2.run ? 'run' : o2.style || 'walk'); m.x = tx; m.y = A.gy;
        } else if (to === 'top' || to === 'bottom') {
          const g = offSeg(at, o2.dur ?? 0.7, to === 'top'); end = g.t1; m.x = g.endS.x; m.y = g.endS.y;
        } else {
          const d = o2.dur ?? 0.26; st.scl.add(at, 0, d, (u) => backIn(u, 2)); end = at + d; cue(at, 'pop', { gain: 0.5, pan: panOf(A.x) });
        }
        st.alpha.add(end, 0, 0); mark(end); return m;
      },
      walk(at, o2 = {}) { const to = ptOf(o2.to, [m.x, m.y]); walkSeg(at, to, o2.dur, o2.style || 'walk'); m.x = to[0]; m.y = to[1]; return m; },
      run(at, o2 = {}) { const to = ptOf(o2.to, [m.x, m.y]); walkSeg(at, to, o2.dur, 'run'); m.x = to[0]; m.y = to[1]; return m; },
      march(at, o2 = {}) { return m.walk(at, { ...o2, style: 'march' }); },
      sneak(at, o2 = {}) { return m.walk(at, { ...o2, style: 'sneak' }); },
      hop(at, o2 = {}) {
        const A = locoAt(at), to = ptOf(o2.to, [A.x, A.gy]), d = Math.hypot(to[0] - A.x, to[1] - A.gy);
        hopSeg(at, to, o2.height ?? size * 0.42, o2.dur ?? clamp(0.44 + (0.12 * d) / size, 0.44, 0.95), o2);
        m.x = to[0]; m.y = to[1]; return m;
      },
      jump(at, o2 = {}) { const A = locoAt(at); hopSeg(at, [A.x, A.gy], o2.height ?? size * 0.5, o2.dur ?? 0.56, o2); return m; },
      bounce(at, o2 = {}) {
        const n = o2.times ?? 3, d = o2.dur ?? 0.44, h = o2.height ?? size * 0.45;
        for (let i = 0; i < n; i++) { const A = locoAt(at + i * d); hopSeg(at + i * d, [A.x, A.gy], h * (i === n - 1 ? 0.8 : 1), d, { ant: 0.06, sfx: 'boing', landSfx: i === n - 1 ? 'land' : false, squash: 0.3, land: 0.3 }); }
        return m;
      },
      ride(at, o2 = {}) {
        const end = rideSeg(at, o2.path || [], o2.dur ?? 1.5, o2);
        if (end) { m.x = end[0]; m.y = end[1]; }
        return m;
      },
      idle(at, dur = 1.6) {
        eff(at, at + dur, (u, P) => { const w = win(u, 0, dur, 0.3, 0.3); P.sq -= 0.018 * Math.sin((TAU * u) / 1.5) * w; P.tilt += 2 * Math.sin((TAU * u) / 2.3) * w; });
        layer(at + dur * 0.35, at + dur * 0.62, 0.1, 0.12, () => ({ lx: -0.8, ly: -0.25 }));
        st.blinks.push(at + dur * 0.34); mark(at + dur); return m;
      },
      blink(at) { st.blinks.push(at); return m; },
      face(at, dir) { faceTo(at, dirOf(dir)); return m; },
      turn(at, dir) { return m.face(at, dir == null ? -m.facing : dir); },
      look(at, target) { const v = lookVec(at, target); st.look.push({ t: at, ...v }); st.look.sort((a, b) => a.t - b.t); return m; },
      expr(at, name) {
        const n = EXPR[name] ? name : EXPR_ALIAS[name];
        if (!n) { warn('unknown expr ' + name); return m; }
        st.expr.push({ t: at, name: n }); st.expr.sort((a, b) => a.t - b.t); return m;
      },
      wave(at, dur = 1.2) {
        layer(at, at + dur, 0.16, 0.2, () => ({ antW: 1, antP: 0.55, lidB: 0.3, blush: 0.55 }));
        eff(at, at + dur, (u, P) => { const w = win(u, 0, dur, 0.2, 0.2); P.tilt += 5 * Math.sin(TAU * 2.4 * u) * w; P.rot += 2 * Math.sin(TAU * 2.4 * u + 1) * w; P.by += 1.6 * Math.abs(Math.sin(TAU * 2.4 * u)) * w; P.nA -= 4 * w; });
        mark(at + dur); return m;
      },
      point(at, target, dur = 1.2) {
        if (target && !Array.isArray(target) && typeof target === 'object' && 'at' in target) { dur = target.dur ?? dur; target = target.at; }
        const A = locoAt(at); let fs = fsAt(at);
        const p = target === 'up' ? [A.x + fs * size * 0.3, A.gy - size * 3] : target === 'left' ? [A.x - size * 3, A.gy - size * 0.6] : target === 'right' ? [A.x + size * 3, A.gy - size * 0.6] : ptOf(target, [A.x + fs * size, A.gy - size * 0.5]);
        const sx = A.x + fs * NOSE.x * k, sy = A.gy - A.lift + (BALL_Y + NOSE.y) * k;
        if ((p[0] - sx) * fs < -size * 0.15) { fs = -fs; faceTo(at, fs); }
        const ang = clamp(Math.atan2(p[1] - sy, (p[0] - sx) * fs) / RAD, -100, 75);
        layer(at, at + dur, 0.1, 0.22, (u) => ({ nA: clamp(ang - NOSE.ang, -38, 32) - 6 * bump(c01(u / 0.3)), nL: 1.08 + 0.1 * bump(c01(u / 0.25)), tilt: clamp(ang * 0.2, -10, 8) + 5, antL: clamp((90 + ang) * 0.45, 0, 50), antP: 0.75, brO: 0.6, brY: -2 }));
        const lv = lookVec(at, p); layer(at, at + dur, 0.08, 0.2, () => lv);
        mark(at + dur); return m;
      },
      cheer(at, dur = 1.1) {
        const A = locoAt(at), h = hopSeg(at, [A.x, A.gy], size * 0.42, Math.min(0.62, Math.max(0.45, dur * 0.6)), { squash: 0.22 });
        layer(at + 0.05, at + dur, 0.12, 0.22, () => ({ hap: 1, blush: 0.75, antP: 1, antW: 0.7, nA: -10 }));
        fxSparkle(at + h.ta + h.Ta * 0.35, 0.65);
        cue(at + h.ta + h.Ta * 0.35, 'sparkle', { gain: 0.6, pan: panOf(A.x) });
        mark(at + dur); return m;
      },
      nod(at, times = 2) {
        const d = 0.26 * times;
        eff(at, at + d, (u, P) => { const b = bump(((u / 0.26) % 1 + 1) % 1); P.tilt += 11 * b; P.nA += 8 * b; P.lidT = Math.max(P.lidT, 0.25 * b); });
        mark(at + d); return m;
      },
      shake(at, times = 3) {
        const d = 0.2 * times + 0.06;
        eff(at, at + d, (u, P) => { const w = win(u, 0, d, 0.05, 0.08); P.shk += Math.sin((TAU * u) / 0.2) * w; P.tilt += 2.5 * Math.sin((TAU * u) / 0.2) * w; });
        mark(at + d); return m;
      },
      squash(at, o2 = {}) {
        const a = o2.amount ?? 0.4, hold = o2.hold ?? 0, d = 0.07 + hold + 0.7;
        eff(at, at + d, (u, P) => { P.sq += a * (u < 0.07 ? p2o(u / 0.07) : u < 0.07 + hold ? 1 : ring(u - 0.07 - hold, 2.4, 6.5)); });
        layer(at, at + 0.07 + hold + 0.2, 0.03, 0.15, () => ({ squeeze: 1, antD: 1.1, blush: 0.3 }));
        cue(at, 'squash', { gain: 0.75, pan: panOf(m.x) });
        mark(at + 0.07 + hold + 0.3); return m;
      },
      dizzy(at, dur = 1.6) {
        layer(at, at + dur, 0.12, 0.25, () => ({ spiral: 1, antD: 0.45 }));
        eff(at, at + dur, (u, P) => { const w = win(u, 0, dur, 0.2, 0.3); P.rot += 6 * Math.sin(TAU * 1.3 * u) * w; P.tilt += 4 * Math.sin(TAU * 1.3 * u + 1.2) * w; });
        fxStars(at, dur, 3); cue(at, 'wobble', { gain: 0.6, pan: panOf(m.x) });
        mark(at + dur); return m;
      },
      sleep(at, dur = 2) {
        layer(at, at + dur, 0.3, 0.25, () => ({ lidT: 1, lidB: 0.12, antD: 0.75, sq: 0.035, tilt: 5, hap: 0, spiral: 0, nA: 8 }));
        eff(at, at + dur, (u, P) => { const w = win(u, 0, dur, 0.4, 0.3), b = Math.sin((TAU * u) / 1.8); P.sq += 0.035 * b * w; P.by -= 0.8 * b * w; });
        fxZzz(at + 0.25, Math.max(0.3, dur - 0.25));
        cue(at + 0.2, 'snore', { gain: 0.55, dur: Math.max(0.3, dur - 0.2), pan: panOf(m.x) });
        mark(at + dur); return m;
      },
      say(at, text, o2 = {}) {
        const dur = o2.dur ?? 1.6, kind = o2.kind || 'bubble';
        const outer = document.createElement('div'); outer.className = 'm-say' + (kind === 'think' ? ' m-say-think' : '');
        const b = document.createElement('div'); b.className = 'm-bubble';
        if (o2.html) b.innerHTML = text; else b.textContent = text;
        outer.style.fontSize = (o2.fontSize ?? clamp(size * 0.15, 20, 44)) + 'px';
        if (kind === 'think') for (let i = 0; i < 2; i++) { const d = document.createElement('i'); d.className = 'm-dot m-dot' + i; outer.appendChild(d); }
        outer.appendChild(b); outer.style.display = 'none';
        inner.appendChild(outer);
        st.says.push({ t0: at, t1: at + dur, outer, b, kind });
        cue(at, 'bubble', { gain: 0.55, pan: panOf(m.x) }); mark(at + dur); return m;
      },
      prop(at, name) {
        if (name && !PROPS[name]) { warn('unknown prop ' + name); return m; }
        buildProp(name); st.prop.set(at, name || null);
        if (name) cue(at, 'pop', { gain: 0.3, pan: panOf(m.x) });
        mark(at); return m;
      },
      hat(at, name) {
        if (name == null || name === 'none') {
          st.head.set(at, null);
          if (name === 'none') { st.faceW.set(at, null); st.neck.set(at, null); }
        } else {
          const n = HAT_ALIAS[name] || name, slot = HAT_SLOT[name];
          if (!slot) { warn('unknown hat ' + name); return m; }
          if (slot === 'head') { buildHat(n); st.head.set(at, n); } else if (slot === 'face') { buildFace(n); st.faceW.set(at, n); } else { buildNeck(n); st.neck.set(at, n); }
          cue(at, 'pop', { gain: 0.3, pan: panOf(m.x) });
        }
        mark(at); return m;
      },
      use(at, kind, o2 = {}) {
        const U = USES[kind];
        if (!U) { warn('unknown use ' + kind); return m; }
        U(at, o2); return m;
      },
      scale(at, s, dur = 0.3) { st.scl.add(at, s, dur, dur > 0 ? (u) => backOut(u, 1.8) : undefined); mark(at + dur); return m; },
      show(at, o2 = {}) {
        st.alpha.add(at, 1, 0);
        if (o2.pop) { st.scl.add(at, 0, 0); st.scl.add(at, 1, 0.34, (u) => backOut(u, 2.4)); cue(at, 'pop', { gain: 0.5, pan: panOf(m.x) }); }
        mark(at); return m;
      },
      hide(at, o2 = {}) {
        if (o2.pop) { st.scl.add(at, 0, 0.2, (u) => backIn(u, 2)); st.alpha.add(at + 0.2, 0, 0); cue(at, 'pop', { gain: 0.4, pan: panOf(m.x) }); mark(at + 0.2); }
        else { st.alpha.add(at, 0, 0); mark(at); }
        return m;
      },
      /* extras */
      trip(at, o2 = {}) {
        const d = o2.dur ?? 1.25, fs = fsAt(at);
        eff(at, at + d, (u, P) => {
          let r;
          if (u < 0.18) r = 78 * p2i(u / 0.18);
          else if (u < 0.5) r = 78 + 4 * ring(u - 0.18, 3, 8);
          else r = 78 * (1 - backOut((u - 0.5) / 0.3, 1.6));
          P.rot += r * fs;
          if (u >= 0.18 && u < 0.5) P.sq += 0.12 * ring(u - 0.18, 2.6, 6);
          if (u >= 0.5) P.by += 14 * bump((u - 0.5) / 0.3);
          if (u >= 0.8) P.sq += 0.18 * ring(u - 0.8, 2.8, 7.5);
        });
        layer(at, at + d * 0.55, 0.05, 0.12, (u) => (u < 0.2 ? EXPR.surprised : { squeeze: 1, antD: 1 }));
        layer(at + d * 0.62, at + d + 0.4, 0.1, 0.3, () => EXPR.happy);
        cue(at + d * 0.18, 'thud', { gain: 0.7, pan: panOf(m.x) }); cue(at + d * 0.5, 'boing', { gain: 0.6, pan: panOf(m.x) }); cue(at + d * 0.8, 'land', { gain: 0.4, pan: panOf(m.x) });
        mark(at + d); return m;
      },
      bonk(at, o2 = {}) {
        const fs = fsAt(at), back = (o2.dist ?? 0.16) * size;
        eff(at, at + 0.9, (u, P) => { P.ox -= fs * back * (u < 0.12 ? p2o(u / 0.12) : 1 - sio((u - 0.12) / 0.6)); P.sq -= 0.22 * ring(u, 3, 8); P.tilt -= 10 * bump(u / 0.5); });
        layer(at, at + 0.5, 0.02, 0.15, () => ({ squeeze: 1, antD: 0.6 }));
        fxStars(at + 0.05, 0.85, 2, 0.8);
        cue(at, 'boing', { gain: 0.7, pan: panOf(m.x) }); mark(at + 0.9); return m;
      },
      attention(at, o2 = {}) {
        const d = o2.dur ?? 1.2;
        eff(at, at + 0.7, (u, P) => { P.sq -= 0.14 * ring(u, 3.2, 8); });
        layer(at, at + d, 0.06, 0.3, () => ({ antP: 1, eS: 1.08, lidT: 0, pS: 0.85, nA: -4 }));
        cue(at, 'tap', { gain: 0.4, pan: panOf(m.x) }); mark(at + d); return m;
      },
    });

    /* ----- evaluation: the whole pose as a pure function of local time ----- */
    function blinkAt(t) {
      let c = 0;
      const test = (arr) => {
        let lo = 0, hi = arr.length - 1, i = -1;
        while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid] <= t) { i = mid; lo = mid + 1; } else hi = mid - 1; }
        for (let j = Math.max(0, i - 1); j <= i; j++) {
          const u = (t - arr[j]) / 0.18;
          if (u >= 0 && u <= 1) c = Math.max(c, u < 0.35 ? p2o(u / 0.35) : 1 - sio((u - 0.35) / 0.65));
        }
      };
      if (st.blinks.length) { if (!st.blinkSorted) { st.blinks.sort((a, b) => a - b); st.blinkSorted = st.blinks.length; } else if (st.blinkSorted !== st.blinks.length) { st.blinks.sort((a, b) => a - b); st.blinkSorted = st.blinks.length; } test(st.blinks); }
      if (life) test(st.lifeBlinks);
      return c;
    }
    function pose(t) {
      const P = Object.assign({}, BASE);
      const L = locoAt(t);
      const f = st.face.at(t), fs = f >= 0 ? 1 : -1;
      { // expression (crossfade)
        let i = 0; for (let j = 0; j < st.expr.length; j++) if (st.expr[j].t <= t) i = j;
        const cur = EXPR[st.expr[i].name], prev = i ? EXPR[st.expr[i - 1].name] : EXPR.neutral, w = i ? smooth((t - st.expr[i].t) / 0.18) : 1;
        for (const kk in prev) P[kk] = lerp(prev[kk], cur[kk] ?? BASE[kk], w);
        for (const kk in cur) if (!(kk in prev)) P[kk] = lerp(BASE[kk], cur[kk], w);
      }
      { // look (quick saccade)
        let i = 0; for (let j = 0; j < st.look.length; j++) if (st.look[j].t <= t) i = j;
        const cur = st.look[i], prev = i ? st.look[i - 1] : cur, w = i ? p2o((t - cur.t) / 0.12) : 1;
        P.lx += lerp(prev.lx, cur.lx, w); P.ly += lerp(prev.ly, cur.ly, w);
      }
      const pr = st.prop.at(t);
      const G = L.gait;
      if (G && L.amp > 0) {
        const s = Math.sin(L.ph), c = Math.cos(L.ph), a = L.amp;
        P.nA += G.arm * a * Math.sin(2 * L.ph);
        P.tilt += G.lean * a + G.waddle * a * s; P.by += G.bob * a * s * s;
        P.sq += G.sq * a * Math.pow(c * c, 6) + (G.crouch || 0) * a;
      }
      if (L.air > 0) { P.antP += 0.25 * L.air; P.nA -= 5 * L.air; }
      P.rot += L.rot; P.shadow *= L.shadow;
      for (const ly of st.lay) {
        if (t < ly.t0) break;
        if (t > ly.t1) continue;
        const w = win(t, ly.t0, ly.t1, ly.fi, ly.fo); if (w <= 0) continue;
        const part = ly.fn(t - ly.t0, P, t);
        for (const kk in part) P[kk] = lerp(P[kk], part[kk], w);
      }
      for (const e of st.eff) if (t >= e.t0 && t <= e.t1) e.fn(t - e.t0, P, t);
      if (life) { const b = Math.sin((TAU * t) / 2.9 + breathPh); P.sq -= 0.013 * b; P.by += 0.4 * (b + 1) * 0.5; P.nA += 0.9 * Math.sin((TAU * t) / 2.9 + breathPh + 0.7); }
      if (P.hap < 0.5 && P.spiral < 0.5 && P.squeeze < 0.5) { const bl = blinkAt(t); P.lidT = Math.max(P.lidT, bl); P.lidB = Math.max(P.lidB, bl * 0.12); }
      return { P, L, f, fs, pr, t };
    }
    function frame(Q, scl) {
      const { P, L, f, fs } = Q;
      const sq = clamp(P.sq, -0.38, 0.75), sy = sq >= 0 ? 1 - 0.85 * sq : 1 - sq, sx = sq >= 0 ? 1 + 0.58 * sq : 1 + 0.5 * sq;
      const hb = LEG * (1 - 0.85 * Math.max(0, sq) + 0.3 * Math.max(0, -sq)) + P.by;
      const Mu = mat.mul(mat.mul(mat.mul(mat.tr(0, -hb), mat.rot(P.tilt * fs)), mat.sc(sx, sy)), mat.tr(0, -R));
      const shk = clamp(P.shk, -1, 1), fx2 = f * (1 - 0.16 * Math.abs(shk));
      const Fl = mat.mul(mat.tr(-shk * 4.5 * fs, 0), mat.sc(Math.abs(fx2) < 0.02 ? 0.02 * fs : fx2, 1));
      const Mf = mat.mul(Mu, Fl);
      const liftU = L.lift / (k * scl);
      const Mr = mat.mul(mat.tr(0, -liftU), mat.rot(P.rot));
      return { Mu, Fl, Mf, Mr, sx, sy, liftU };
    }
    const noseOf = (P) => {
      const na = (NOSE.ang + P.nA) * RAD, nl = NOSE.len * P.nL * (1 - 0.3 * Math.abs(P.shk));
      return { na, tip: [NOSE.x + nl * Math.cos(na), NOSE.y + nl * Math.sin(na)] };
    };
    function headPx(tau) { const L = locoAt(tau), bob = L.gait ? L.gait.bob * L.amp * Math.sin(L.ph) ** 2 : 0; return [L.x, L.gy - L.lift - k * (-BALL_Y + bob)]; }
    function spring(t) {
      const h = 1 / 180, n = 160, span = (n + 1) * h;
      if (!st.segs.some((g) => g.t1 > g.t0 && g.t0 <= t + h && g.t1 >= t - span)) return { x: 0, y: 0 };
      const w = TAU * 2.4, z = 0.2, A = 7000;
      let sx = 0, vx = 0, sy = 0, vy = 0, p0 = headPx(t - span), p1 = headPx(t - n * h);
      for (let i = n - 1; i >= -1; i--) {
        const p2 = headPx(t - i * h);
        const ax = clamp((p2[0] - 2 * p1[0] + p0[0]) / (h * h) / k, -A, A), ay = clamp((p2[1] - 2 * p1[1] + p0[1]) / (h * h) / k, -A, A);
        vx += (-w * w * sx - 2 * z * w * vx - ax) * h; sx += vx * h;
        vy += (-w * w * sy - 2 * z * w * vy - ay * 0.6) * h; sy += vy * h;
        p0 = p1; p1 = p2;
      }
      return { x: clamp(sx, -10, 10), y: clamp(sy, -8, 8) };
    }
    const hatAnim = (s) => {
      let ty = 0, op = 1, r = 0;
      if (s.since < 0.3) { ty = lerp(-26, 0, backOut(s.since / 0.3, 2.2)); op = smooth(s.since / 0.08); }
      if (s.until < 0.14) { const u = 1 - s.until / 0.14; ty -= 20 * p2i(u); op *= 1 - u; r = -18 * u; }
      return { tr: `translate(0 ${f2(ty)}) rotate(${f2(r)} 0 -40)`, op };
    };
    function antOf(j, A, P, sp, t) {
      let [bx, by, cx, cy, tx, ty] = A;
      const len = Math.hypot(tx - bx, ty - by), pk = clamp(P.antP, 0, 1) * 0.75;
      cx = lerp(cx, bx + (tx - bx) * 0.12, pk); cy = lerp(cy, by - len * 0.55, pk);
      tx = lerp(tx, bx + (tx - bx) * 0.3, pk); ty = lerp(ty, by - len * 1.04, pk);
      const a = (clamp(P.antD, 0, 1.2) * (j ? 52 : -60) + (life ? 3.5 * Math.sin(TAU * 0.33 * t + swayPh + j * 1.7) : 0)
        + P.antL * (j ? 1 : 0.8) + P.antW * (j ? 34 : 24) * Math.sin(TAU * 3.3 * t + j * 0.9)) * RAD, ca = Math.cos(a), sa = Math.sin(a);
      const rt = (x, y) => [bx + (x - bx) * ca - (y - by) * sa, by + (x - bx) * sa + (y - by) * ca];
      const c = rt(cx, cy), tp = rt(tx, ty);
      return `M${f2(bx)} ${f2(by)}Q${f2(c[0] + sp.x * 0.45)} ${f2(c[1] + sp.y * 0.45)} ${f2(tp[0] + sp.x)} ${f2(tp[1] + sp.y)}`;
    }

    /* ----- render: write the pose into the SVG ----- */
    function render(t) {
      const Q = pose(t), { P, L, f, fs, pr } = Q;
      const alpha = clamp(st.alpha.at(t), 0, 1), scl = Math.max(0.0001, st.scl.at(t));
      setSt(el, 'left', f2(L.x + P.ox) + 'px'); setSt(el, 'top', f2(L.gy + P.oy) + 'px');
      setSt(inner, 'transform', Math.abs(scl - 1) < 1e-4 ? 'none' : `scale(${f2(scl * 1000) / 1000})`);
      setSt(inner, 'opacity', f2(alpha)); setSt(inner, 'visibility', alpha <= 0.002 || scl <= 0.002 ? 'hidden' : '');
      if (alpha <= 0.002 || scl <= 0.002) return;
      const Fm = frame(Q, scl), sp = spring(t), spF = { x: sp.x * fs, y: sp.y };
      const flip = mat.str(Fm.Fl);
      // shadow + root
      const sh = 1 / (1 + Math.max(0, Fm.liftU) / 40);
      setA(shadowE, 'transform', `scale(${f2(sh * (0.9 + 0.1 * Fm.sx))} ${f2(sh)})`);
      setA(shadowE, 'opacity', f2(clamp(P.shadow, 0, 1) / (1 + Math.max(0, Fm.liftU) / 26)));
      setA(root, 'transform', mat.str(Fm.Mr));
      // legs
      const legs = [0, 1].map((i) => {
        const hip = mat.ap(Fm.Mf, HIPS[i], R - HIP_IN), Gt = L.gait, psi = L.ph + i * Math.PI;
        const px = f * (HIPS[i] + (Gt ? L.amp * L.Lu * Math.cos(psi) : 0));
        const py = FOOT_Y - (Gt ? L.amp * Gt.lift * Math.max(0, -Math.sin(psi)) : 0);
        const hx = hip[0] - fs * 2.6 + (i ? 1.2 : -1.2), hy = hip[1] + (LEG + HIP_IN + FOOT_Y) * 0.94;
        return `M${f2(hip[0])} ${f2(hip[1])}L${f2(lerp(px, hx, L.air))} ${f2(lerp(py, hy, L.air))}`;
      });
      setA(legN, 'd', legs[0]); setA(legF, 'd', legs[1]);
      // upper body
      setA(upper, 'transform', mat.str(Fm.Mu));
      setA(back, 'transform', flip); setA(front, 'transform', flip);
      setA(gBody, 'gradientTransform', `rotate(${f2(-(P.tilt * fs + P.rot))} 0.5 0.5)`);
      const { na, tip } = noseOf(P), ca = Math.cos(na), sa = Math.sin(na);
      setA(nose, 'd', capsule(NOSE.x, NOSE.y, NOSE.r0, tip[0], tip[1], NOSE.r1));
      setA(noseSh, 'd', capsule(NOSE.x + 1.4, NOSE.y + 3.9, NOSE.r0, tip[0] + 1.4, tip[1] + 3.9, NOSE.r1));
      { const q = (u, r) => [lerp(NOSE.x, tip[0], u) + sa * r, lerp(NOSE.y, tip[1], u) - ca * r];
        const a = q(0.42, NOSE.r0 * 0.55), b = q(0.9, NOSE.r1 * 0.55); setA(noseHi, 'd', `M${f2(a[0])} ${f2(a[1])}L${f2(b[0])} ${f2(b[1])}`); }
      // eye
      setA(eyeG, 'transform', `translate(${EYE.x} ${EYE.y}) scale(${f2(P.eS)})`);
      const crisp = (v) => smooth((v - 0.42) / 0.16), mH = crisp(P.hap), mS = crisp(P.spiral), mQ = crisp(P.squeeze);
      const mC = smooth((P.lidT - 0.74) / 0.24) * (1 - Math.max(mH, mS, mQ));
      setA(eyeN, 'opacity', f2((1 - Math.max(mH, mS, mQ)) * (1 - mC)));
      setA(eyeCl, 'opacity', f2(mC));
      setA(eyeHap, 'opacity', f2(mH)); setA(eyeSq, 'opacity', f2(mQ)); setA(eyeSp, 'opacity', f2(mS));
      if (P.spiral > 0.01) setA(spiral, 'transform', `rotate(${f2((t * 420) % 360)})`);
      setA(pupil, 'transform', `translate(${f2(1.3 + clamp(P.lx, -1, 1) * 2.3)} ${f2(clamp(P.ly, -1, 1) * 3)}) scale(${f2(P.pS)})`);
      { const rx = EYE.rx, ry = EYE.ry, yl = -ry + 2 * ry * clamp(P.lidT, 0, 1), yb = ry - 2 * ry * clamp(P.lidB, 0, 1), rot = `rotate(${f2(P.lidA)})`;
        setA(lidT, 'd', `M${-rx - 3} ${-ry - 4}L${rx + 3} ${-ry - 4}L${rx + 3} ${f2(yl)}Q0 ${f2(yl + 2.4)} ${-rx - 3} ${f2(yl)}Z`); setA(lidT, 'transform', rot);
        setA(lidTL, 'd', `M${-rx - 1} ${f2(yl)}Q0 ${f2(yl + 2.4)} ${rx + 1} ${f2(yl)}`); setA(lidTL, 'transform', rot); setA(lidTL, 'opacity', P.lidT > 0.04 ? 1 : 0);
        setA(lidB, 'd', `M${-rx - 3} ${ry + 4}L${rx + 3} ${ry + 4}L${rx + 3} ${f2(yb)}Q0 ${f2(yb - 2.8)} ${-rx - 3} ${f2(yb)}Z`);
        setA(lidBL, 'd', `M${-rx - 1} ${f2(yb)}Q0 ${f2(yb - 2.8)} ${rx + 1} ${f2(yb)}`); setA(lidBL, 'opacity', P.lidB > 0.06 ? 0.8 : 0); }
      setA(brow, 'transform', `translate(${EYE.x} ${f2(EYE.y - 13.6 - (P.eS - 1) * 9 + P.brY)}) rotate(${f2(P.brA)})`); setA(brow, 'opacity', f2(clamp(P.brO, 0, 1)));
      setA(blush, 'opacity', f2(clamp(P.blush, 0, 1) * 0.9));
      { const ph = ((t * 0.8) % 1 + 1) % 1; setA(sweat, 'transform', `translate(-13 ${f2(-21 + ph * 8)}) scale(${f2(0.9 + 0.2 * ph)})`); setA(sweat, 'opacity', f2(clamp(P.sweat, 0, 1) * Math.min(1, bump(ph) * 2))); }
      // headwear
      const hs = st.head.at(t);
      for (const n in hats) {
        const it = hats[n], on = n === hs.v; vis(it.g, on); if (!on) continue;
        const an = hatAnim(hs); setA(it.g, 'transform', an.tr); setA(it.g, 'opacity', f2(an.op));
        if (it.h.update) it.h.update(it.e, spF, f, t);
      }
      { const antC = hs.v && HATS[hs.v] ? HATS[hs.v].ant : NO_HAT_ANT, antP = hs.prev && HATS[hs.prev] ? HATS[hs.prev].ant : NO_HAT_ANT;
        const wb = smooth(hs.since / 0.3);
        for (let j = 0; j < 2; j++) { const A = antC[j].map((v, q) => lerp(antP[j][q], v, wb)); setA(antE[j], 'd', antOf(j, A, P, spF, t)); } }
      const fw = st.faceW.at(t);
      for (const n in faces) { const it = faces[n], on = n === fw.v; vis(it.g, on); if (on) { const s = fw.since < 0.25 ? backOut(fw.since / 0.25, 2.2) : 1; setA(it.g, 'transform', `translate(${EYE.x} ${EYE.y}) scale(${f2(s)}) translate(${-EYE.x} ${-EYE.y})`); } }
      const nk = st.neck.at(t);
      for (const n in necks) { const it = necks[n], on = n === nk.v; vis(it.g, on); if (on && it.h.update) it.h.update(it.e, spF); }
      if (lanyard) vis(lanyard, P.whistle < 0.5);
      vis(noseWh, P.whistle >= 0.5 && pr.v !== 'whistle');
      if (P.whistle >= 0.5) setA(noseWh, 'transform', `translate(${f2(tip[0] + ca * 4)} ${f2(tip[1] + sa * 4)}) rotate(${f2(na / RAD)}) scale(0.95)`);
      // held prop
      let propM = null;
      for (const n in props) {
        if (n === 'cart') continue;
        const it = props[n], on = n === pr.v; vis(it.g, on); if (!on) continue;
        const d = it.def;
        let s = 1; if (pr.since < 0.24) s = lerp(0.2, 1, backOut(pr.since / 0.24, 2.4)); if (pr.until < 0.1) s *= Math.max(0, pr.until / 0.1);
        propM = propMatrix(d, P, s, spF.x);
        setA(it.g, 'transform', mat.str(propM));
        if (d.update) d.update(it.e, spF, f, t, P);
        if (n === 'clipboard') setA(it.e.tick, 'stroke-dashoffset', f2(30 * (1 - clamp(P.tick || 0, 0, 1))));
      }
      // the cart rolls on the ground in front of the nose
      const cartOn = pr.v === 'cart' && cart && Math.abs(f) > 0.25;
      vis(cartG, cartOn); vis(cartH, cartOn);
      if (cartOn) {
        let s = 1; if (pr.since < 0.26) s = backOut(pr.since / 0.26, 2); if (pr.until < 0.12) s *= Math.max(0, pr.until / 0.12);
        const Mc = mat.mul(mat.mul(mat.rot(P.rot), mat.tr(P.cartDx * fs, 0)), mat.mul(mat.sc(f, 1), mat.mul(mat.tr(80, -6), mat.mul(mat.sc(s), mat.tr(-80, 6)))));
        setA(cartG, 'transform', mat.str(Mc));
        const deg = ((L.odo / (k * scl) / 6.2) / RAD) % 360;
        for (const w of cart.wheels) setA(w, 'transform', `rotate(${f2(deg)})`);
        const nt = mat.ap(Fm.Mr, ...mat.ap(Fm.Mf, tip[0] + ca * (NOSE.r1 - 1.5), tip[1] + sa * (NOSE.r1 - 1.5)));
        const hb = mat.ap(Mc, 59, -12);
        setA(cart.handle, 'd', `M${f2(nt[0])} ${f2(nt[1])}L${f2(hb[0])} ${f2(hb[1])}`); setA(cart.handle, 'opacity', f2(s));
      }
      // fx + bubbles
      const C = {
        P, f, fs, t, Mf: Fm.Mf,
        toRoot: (q) => mat.ap(Fm.Mf, q[0], q[1]),
        noseTip: mat.ap(Fm.Mf, tip[0] + ca * NOSE.r1, tip[1] + sa * NOSE.r1),
        noseDir: (() => { const a = mat.ap(Fm.Mf, 0, 0), b = mat.ap(Fm.Mf, ca, sa), d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / d, (b[1] - a[1]) / d]; })(),
        propAt: (x, y) => (propM ? mat.ap(Fm.Mf, ...mat.ap(propM, x, y)) : mat.ap(Fm.Mf, tip[0], tip[1])),
      };
      for (const e of st.fx) { const on = t >= e.t0 && t <= e.t1; vis(e.g, on); if (on) e.update(t - e.t0, C, e.s); }
      for (const b of st.says) {
        const on = t >= b.t0 && t <= b.t1;
        setSt(b.outer, 'display', on ? 'block' : 'none'); if (!on) continue;
        const u = t - b.t0, out = b.t1 - t;
        let s = u < 0.26 ? backOut(u / 0.26, 2) : 1; if (out < 0.16) s *= out / 0.16;
        const bq = (pr.v === 'sign-q' || pr.v === 'flag') && propM ? mat.ap(propM, 22, -86) : [33, -48];
        const a = mat.ap(Fm.Mr, ...mat.ap(Fm.Mf, Math.max(bq[0], 20), Math.min(bq[1], -48)));
        b.outer.classList.toggle('m-left', fs < 0);
        setSt(b.outer, 'transform', `translate(${f2(a[0] * k)}px, ${f2(a[1] * k - 2 * Math.sin((TAU * u) / 1.7))}px) scale(${f2(Math.max(0.001, s))})`);
        setSt(b.outer, 'opacity', f2(Math.min(1, u / 0.06, out / 0.12)));
      }
    }

    /* ----- anchors ----- */
    const HAT_TOP = { cap: -53, beanie: -66, grad: -59, detective: -57, hardhat: -56, beret: -55, crown: -62, party: -98, flatcap: -50 };
    function localPoint(name, Q, Fm) {
      const { P, f } = Q;
      if (name === 'feet' || name === 'ground') return [0, 0];
      if (name === 'nose' || name === 'hand' || name === 'tip') { const { na, tip } = noseOf(P); return mat.ap(Fm.Mr, ...mat.ap(Fm.Mf, tip[0] + Math.cos(na) * NOSE.r1, tip[1] + Math.sin(na) * NOSE.r1)); }
      if (name === 'hat') { const h = st.head.at(Q.t).v; return mat.ap(Fm.Mr, ...mat.ap(Fm.Mf, 0, HAT_TOP[h] ?? -R)); }
      if (name === 'cart') return mat.ap(mat.rot(P.rot), f * 80, -40);
      const q = { head: [4, -R - 2], top: [0, -R], eye: [EYE.x, EYE.y], center: [0, 0], body: [0, 0], back: [-R, 0], front: [R, 0], bubble: [33, -48], belly: [6, 28] }[name];
      if (!q) { warn('unknown anchor ' + name); return [0, -R]; }
      return mat.ap(Fm.Mr, ...mat.ap(Fm.Mf, q[0], q[1]));
    }
    Object.assign(m, {
      /** world point of a body part at scene-local time `at`, from everything recorded so far */
      anchor(name, at = 0) {
        const Q = pose(at), scl = Math.max(0.0001, st.scl.at(at)), Fm = frame(Q, scl), p = localPoint(name, Q, Fm);
        return { x: Q.L.x + Q.P.ox + p[0] * k * scl, y: Q.L.gy + Q.P.oy + p[1] * k * scl };
      },
      /** static offset of a body part from (x, y) at rest, for this size and the latest facing */
      offset(name) {
        const P = Object.assign({}, BASE);
        const Q = { P, L: still(0, 0, 0), f: m.facing, fs: m.facing, t: 0 }, Fm = frame(Q, 1), p = localPoint(name, Q, Fm);
        return { x: p[0] * k, y: p[1] * k };
      },
      /** pose state at time `at`: {x, y, facing, lift, visible} */
      at(at) { const Q = pose(at); return { x: Q.L.x, y: Q.L.gy, facing: Q.fs, lift: Q.L.lift, visible: st.alpha.at(at) > 0.5 }; },
      render,
    });

    /* ----- hook ----- */
    const sceneRoot = parent && parent.closest ? parent.closest('.f-scene') : null;
    const startOf = () => (tl && tl.startTime ? tl.startTime() : 0);
    m.frame = (T) => { if (sceneRoot && (sceneRoot.style.display === 'none' || sceneRoot.style.visibility === 'hidden')) return; render(T - startOf()); };
    if (window.F && F.hooks) F.hooks.push(m.frame);
    ALL.push(m);
    render(0);
    return m;
  }

  window.Mascot = {
    create, stub: false,
    variants: Object.keys(VARIANTS), props: PROP_NAMES.slice(), hats: Object.keys(HAT_SLOT), exprs: Object.keys(EXPR),
    uses: ['stamp', 'whistle', 'hammer', 'magnify', 'write', 'push', 'sip'],
    /** render every mascot at absolute time T (only needed without kit's F.hooks) */
    renderAll: (T) => ALL.forEach((m) => m.frame(T)),
    all: ALL,
  };
})();
