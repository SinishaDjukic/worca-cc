/* main.js — builds the film and runs the dev player. Export tools use window.__film (?export=1).
   Keys: Space play/pause · ←/→ ±1 s · Shift+←/→ ±1 frame · [ / ] previous/next scene · h HUD · m mute · r restart.
   URL: ?t=42.5 start time · &pause · &scene=loop (start at a scene) · &export=1 (render mode). */
(async function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  const EXPORT = q.get('export') === '1';
  if (EXPORT) document.body.classList.add('export');
  // index.html injects the scene files listed in FILM_DATA.sceneFiles; build only once they all ran.
  try { await (window.__filmScenes || Promise.resolve()); } catch (e) { F.violation('scene files: ' + e); }
  F.build();
  try { await document.fonts.ready; await Promise.all(['300', '400', '500', '600', '700'].map((w) => document.fonts.load(`${w} 40px Poppins`))); await document.fonts.load('40px "JetBrains Mono"'); } catch (e) { F.violation('fonts: ' + e); }
  await F.seek(0);
  await Promise.all([...F.pending]);

  window.__film = {
    ready: true, dur: F.DUR, fps: F.FPS, w: F.W, h: F.H,
    get violations() { return F.violations; },
    cues: F.cues,
    seek: (t) => F.seek(t),
    scenes: F.scenes.map((s) => ({ id: s.id, start: s.start, end: s.end })),
  };
  if (EXPORT) return;

  /* ---------- dev player ---------- */
  const stage = F.stage;
  const fit = () => { const s = Math.min(innerWidth / F.W, (innerHeight - 8) / F.H); stage.style.transform = `scale(${s})`; };
  addEventListener('resize', fit); fit();
  const hud = Object.assign(document.createElement('div'), { id: 'hud' }); document.body.appendChild(hud);
  const scrub = Object.assign(document.createElement('div'), { id: 'scrub' }); document.body.appendChild(scrub);
  const bar = document.createElement('i'); scrub.appendChild(bar);
  for (const s of F.scenes) { const m = document.createElement('b'); m.style.left = (s.start / F.DUR * 100) + '%'; scrub.appendChild(m); }
  const audio = new Audio('../audio/mix.mp3'); audio.preload = 'auto';
  let hasAudio = false; audio.addEventListener('canplaythrough', () => { hasAudio = true; }, { once: true });
  audio.addEventListener('error', () => { hasAudio = false; });
  let playing = false, t = 0, wall0 = 0, t0 = 0;
  const sceneAt = (tt) => F.scenes.find((s) => tt >= s.start && tt < s.end) || F.scenes.at(-1);
  const draw = () => {
    F.seek(t);
    bar.style.width = (t / F.DUR * 100) + '%';
    const s = sceneAt(t);
    hud.textContent = `${t.toFixed(2)}s  f${Math.round(t * F.FPS)}  ${s.id} +${(t - s.start).toFixed(2)}  ${playing ? '▶' : '❚❚'}${hasAudio ? '' : '  (no audio/mix.mp3)'}  ${F.violations.length ? '⚠ ' + F.violations.length : ''}`;
  };
  const play = () => { playing = true; wall0 = performance.now(); t0 = t; if (hasAudio) { audio.currentTime = t; audio.play().catch(() => {}); } };
  const pause = () => { playing = false; audio.pause(); };
  const jump = (tt) => { t = Math.max(0, Math.min(F.DUR, tt)); if (playing) play(); draw(); };
  gsap.ticker.add(() => {
    if (!playing) return;
    t = hasAudio && !audio.paused ? audio.currentTime : t0 + (performance.now() - wall0) / 1000;
    if (t >= F.DUR) { t = F.DUR; pause(); }
    draw();
  });
  addEventListener('keydown', (e) => {
    const fr = 1 / F.FPS;
    if (e.key === ' ') { e.preventDefault(); playing ? pause() : play(); }
    else if (e.key === 'ArrowRight') jump(t + (e.shiftKey ? fr : 1));
    else if (e.key === 'ArrowLeft') jump(t - (e.shiftKey ? fr : 1));
    else if (e.key === ']') { const s = F.scenes.find((x) => x.start > t + 0.01); if (s) jump(s.start); }
    else if (e.key === '[') { const c = sceneAt(t); const i = F.scenes.indexOf(c); jump(t - c.start > 0.5 ? c.start : (F.scenes[i - 1] || c).start); }
    else if (e.key === 'h') document.body.classList.toggle('nohud');
    else if (e.key === 'm') audio.muted = !audio.muted;
    else if (e.key === 'r') jump(0);
  });
  scrub.addEventListener('click', (e) => jump(e.clientX / innerWidth * F.DUR));
  const sc = q.get('scene') && F.scenes.find((s) => s.id === q.get('scene'));
  t = sc ? sc.start : Number(q.get('t') || 0);
  draw();
  if (!q.has('pause')) setTimeout(play, 300);
})();
