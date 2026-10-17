# Promo film kit — build contract

A short 1920×1080, 60 fps promo film for a product, built from the product's **real UI**: components captured from
a sandboxed, seeded copy of the app as transparent PNG "plates", one concrete component at a time — no app chrome,
no sidebars, no menus around it — on a light paper stage, with an SVG mascot crew that walks in and interacts with
them. Narration (or, for a silent film, estimated word timing) is fixed first; every visual syncs to its words.
The film is one deterministic GSAP timeline, rendered frame by frame by headless Chrome into an MP4.

`<P>` below is the run's pipeline directory (your prompt names it). The kit is staged at `<P>/promo-kit/`;
everything the film is made of lives in `<P>/promo/`. Read the kit, never edit it: copy what you need.

## Where everything lives

```
<P>/promo-setup.json                 setup answers {form, version, values:{tone, length, pace, mascots, …}}
<P>/promo/setup.json                 the same values minus secrets (what self-skipping steps read)
<P>/promo/product.md                 product facts in the product's own wording, audience, features + where they live in the UI
<P>/promo/runbook.json               how to start the UI in a sandbox — or {"ui": false, "why": "…"}
<P>/promo/script.json                {title, tone, lengthSec, lines:[{id:'v01', scene, text}], scenes:[{id, chapter?, beats, minSec?}]}
<P>/promo/storyboard.md              beats per scene, the plate shot list, mascot beats
<P>/promo/timeline.json              {duration, fps:60, narrated, vo:{v01:{text, scene, start, dur, speechStart, speechEnd, words:[{w,key,t0,t1}]}},
                                      scenes:[{id, start, end, chapter?:{num, title}}]}   (vo.start absolute; words relative to it)
<P>/promo/plates/<name>/<state>.png  captured plates (alpha)          <P>/promo/plates/<name>/<seq>/0000.png …  frame sequences
<P>/promo/plates/manifest.json       {version:1, plates:{<name>:{desc, dsf, pad, states:{<state>:{file,w,h}}, anchors, seqs, extra?}}, reason?}
<P>/promo/mascot.md                  what the crew looks like and why (or why there is none)
<P>/promo/film/                      index.html kit.js film.css main.js mascot.js mascot.css mascot-demo.html vendor/ fonts/
                                     data.js (generated — never edit)   scenes/<id>.js + scenes/<id>.css (the scene files)
<P>/promo/audio/vo/<id>.mp3          narration lines · audio/music/music.mp3 · audio/sfx/<name>.mp3 · audio/mix.wav|mp3|m4a
<P>/promo/video/promo-1080p60.mp4    the film · video/promo.en.srt captions · video/youtube.md
```

File paths inside `manifest.json` are relative to `<P>/promo/` with forward slashes (`plates/hook-composer/default.png`).
A project without a web UI gets an empty manifest with a `reason` (`{"version":1,"plates":{},"reason":"…"}`) and
film-native visuals: real code, terminal sessions and diagrams drawn from the repo, never invented screens.

## Film rules (what made it work)

1. **Educational first.** When the narrator names a feature, the frame shows exactly that feature — on screen within
   ±0.5 s of the word, zoomed in enough to read at 1080p. Only facts from `product.md`, in the product's own words.
2. **One concrete component at a time**, large and legible. A plate, not a screenshot of the whole app.
3. **Zoom to what is named.** The camera lands on the detail the narrator says (`S.camera.frame(at, plate.anchor(…))`).
4. **Every arrival has motion and a sound cue.** Nothing pops in without a tween (`back.out` / `power3.out`,
   0.25–0.5 s), and every pop, land, click and whoosh you animate gets an `S.sfx` cue.
5. **Never a frozen hold longer than 1.2 s.** Something changes every ~2 s; a still card drifts (scale ~1.02–1.05).
6. **No humans anywhere**: no people, faces, hands, avatars or photos — not in plates, scenes or mascots.
7. **Mascots have no arms and no hands.** The nose, antennae and body do the gesturing; props sit on the nose tip.
8. **Mascots never cover the text the narrator is talking about**, and never sit on a plate's important rows.
9. **Plates are the real UI with no app chrome** — no browser frame, sidebar, menus or unrelated panels around them.
   Demo data only (believable, invented, no real names, emails, paths or keys).
10. Captions are sparse (1–5 words, a keyword or punchline), English, sentence case, the app's real wording.
11. Each scene owns its entrance and exit (≤ 0.45 s at its edges); chapter scenes open with the chapter card, which
    covers the cut. Hand-off frames are never blank paper.

## Timing

`timeline.json` is fixed before scenes are built (the narration step writes it and runs `build-data`). Scene
windows and line start times come from it; each line's words with absolute times are in `film/data.js`
(`FILM_DATA.vo.v03.words`). Sync to words with `S.word('v03', 'export')` — never hard-code a time that is "about
when they say it". A chapter scene's card plays at local 0, so its first line starts ≥ 1.2 s into the scene.

## Scenes — `<P>/promo/film/scenes/<id>.js` (+ optional `<id>.css`)

```js
F.scene({ id: 'export', build(S) {
  S.chapter(0);                                    // chapter scenes: the card at local 0 (num/title from the timeline)
  const p = S.plate('export-dialog', 'default', { x: 960, y: 560, scale: 0.9 });
  S.tl.set(p.el, { autoAlpha: 0, y: '+=40' }, 0)
      .to(p.el, { autoAlpha: 1, y: '-=40', duration: 0.4, ease: 'back.out(2)' }, S.word('v05', 'export'));
  S.sfx(S.word('v05', 'export'), 'pop');
  const bo = S.mascot('builder', { x: -120, y: 860, size: 190 });
  bo.walk(S.word('v05', 'export') - 0.3, { to: [420, 860], dur: 1.1 });
  S.camera.frame(S.word('v05', 'csv'), p.anchor('format'), 0.7, { pad: 0.3 });
  p.show(S.word('v05', 'done'), 'done');           // crossfade to another captured state
  S.exit('slide-left');
}});
```

After adding or removing a scene file run `build-data` (index.html loads the files `data.js` lists).

**S (Scene) API** — all times are scene-local seconds (0 = scene start); positions are world px (1920×1080).
- `S.tl` GSAP timeline (added to the master at the scene start). `S.dur`, `S.start`, `S.end`, `S.spec`.
- `S.root` / `S.bg` / `S.world` (moved by the camera) / `S.overlay` (not moved: captions, HUD).
- `S.word(id, key, nth=1)` / `S.wordEnd(...)` local time of a narrated word; `S.vo(id)` → `{t0, t1, text, words}`.
- `S.plate(name, state, {x, y, scale | w, origin:'center'|'tl', parent, hidden})` → Plate: `.el`, `.w/.h` (CSS px),
  `.show(at, state, dur=.18)` crossfade, `.steps(at, [states], interval)`, `.anchor(name)` → `{x, y, w, h}` world
  centre + size for its placed geometry, `.bounds()`.
- `S.seq(name, seqName, {x, y, scale})` → `.play(at, {fps, from, to, loop})`, `.hold(at, frame)`.
- `S.camera.to(at, {x, y, zoom, rot}, dur, ease)`, `.set(at, …)`, `.frame(at, rect, dur, {pad, maxZoom})`.
- `S.cursor({x, y, hidden})` → `.show/.hide(at)`, `.moveTo(at, x, y, dur)`, `.click(at)` (ring + 'click' sfx).
- `S.mascot(variant, {x, y, size, facing, hidden})` → Mascot (API below), on `S.world` by default.
- `S.caption(at, html, {dur, y, sfx})` top-centre black pill (`<em>` = warm accent).
- `S.chapter(at, {num, title, dur=1.5})` full-stage chapter card (words pre-risen, the title drifts, slides away up).
- `S.enter(kind, {at, dur})` / `S.exit(kind, {dur})`: `cut fade zoom slide-left slide-up iris drop`.
- `S.sfx(at, name, {gain, pan, dur, rate})` sound cue — `name` from `F.SFX` (below); gain 0–1.5, pan −1…1.
- `S.onFrame(fn(localT))` per-frame hook for derived state (counters, typed text, path following). Pure function of t.
- `S.el(tag, {cls, style, html, attrs, parent})` film-native element on `S.world`. `F.D.plates[name].extra` = capture data.

**Hard rules (the export seeks frames in any order, in parallel; break these and frames come out wrong):**
1. Everything is a pure function of film time. Only GSAP tweens on `S.tl` and `S.onFrame` hooks. **No**
   `setTimeout`, `setInterval`, `requestAnimationFrame`, `Date`, `Math.random()` (seed your own PRNG), CSS
   animations/transitions (film.css kills them), `<video>`, `fetch`, or async work in `build`.
2. Initial states with `S.tl.set(el, {...}, 0)` then `to()`. **Avoid `gsap.from()`**; for `fromTo` pass
   `immediateRender: false`. Never tween the same property of the same element from two overlapping tweens.
3. A scene's timeline must not run past `S.dur` (the kit flags it). Set everything visible back to a sane state at 0.
4. Scene CSS: every rule starts with `[data-scene="<id>"]`. No global selectors, no `@keyframes`.
5. Stay inside your files: `film/scenes/<your ids>.js|css`. Never edit kit.js, film.css, main.js, index.html,
   data.js or the timeline (mascot.js belongs to the mascot step). Tiny local helpers inside your scene file are fine.
6. Inactive scenes are `display:none` (the kit does it). Inside a scene hide things with `autoAlpha` on the element
   itself: a parent's `visibility:hidden` does not hide a child that sets `visibility:visible`.

## Visual language

- Stage: paper `#F1F1EF` with a faint 28 px dot grid (kit). Ink `#19191B`. Accents green `#5BAE5B`, peach `#EFA63C`,
  red `#E76A5A`, iris `#5B56C9` — or the product's own palette in scene CSS. Fonts: Poppins, mono JetBrains Mono.
- Plates float on the paper with their own captured shadow; a big plate may get
  `filter: drop-shadow(0 30px 40px rgba(20,20,30,.12))`. A plate at scale 1 shows the component at its real CSS
  size; zoom with the camera, not by scaling a plate past ~1.4 (plates are captured at 2–3× device scale, so camera
  zooms up to ~2.5× stay crisp).
- Motion: snappy. Arrivals 0.25–0.5 s with `back.out` / `power3.out`, exits faster, overshoot and squash welcome.
  Camera moves `power3.inOut` 0.5–0.9 s. Typing: one plate state per typed prefix, `plate.steps(at, states, 1/cps)`.
- Film-native graphics (pills, stamps, badges, bubbles, icons, terminals): flat shapes, rounded black pills with white
  Poppins 600 text, no gradients except the mascot shading.
- A card that should feel "ready" fades/slides in at the scene level (your scene), not through the kit.

## Plates — capturing the real UI (`<P>/promo-kit/capture/lib.mjs`)

```js
import { startApp, open, Plate, unisolate } from '<P>/promo-kit/capture/lib.mjs';
const app = await startApp({ cmd: 'npm', args: ['run', 'dev', '--', '--port', '$PORT'], cwd: '<repo>',
  readyUrl: 'http://127.0.0.1:$PORT/', timeoutMs: 180000 });      // own port, temp HOME/USERPROFILE, tree kill on stop
const { page, go, close } = await open({ url: app.url, dsf: 3, width: 1600, height: 1000, promoDir: '<P>/promo' });
await go('/reports');                                               // a path, '#hash' or a full URL
const p = await Plate.begin(page, 'export-dialog', { target: '.export-dialog', pad: 28, desc: 'Export dialog',
  anchors: { format: '.export-dialog .format' } });
await p.shot('default');
await unisolate(page); await page.click('.format-csv'); await p.shot('csv');   // interact with the REAL UI between shots
await p.seq('spinner', { frames: 30, fps: 30 });                    // steps the page's own CSS/WAAPI animations
p.meta.extra = { rows: [/* data a scene needs, e.g. row positions */] };
p.save();                                                           // merges into <P>/promo/plates/manifest.json
await close(); await app.stop();
```
- **Names:** `<sceneId>-<component>` (`hook-composer`, `export-dialog`); states and seqs are short words. Every state
  of a plate shares one clip, fixed at `begin`: make it big enough for every state.
- **Sandbox:** start the app with `startApp` (fresh HOME/USERPROFILE, its own port, never the user's real data dirs)
  and seed believable demo data through the app's own UI/API or seed scripts. Never trigger real side effects: no
  real emails, payments, pushes, AI/model calls or posts to external services — type into such inputs without
  sending. Stop everything you started.
- **Find selectors** by reading the UI code and probing the live page. Reach states through the real UI (clicks,
  typing, `page.hover`). If a state can't be reached for real, you may set the app's OWN state classes/attributes on
  its OWN markup to reproduce it — never invent markup — and say so in your report.
- `card: { bg:'#fff', radius:16 }` gives a component that normally sits on a panel its own card so it reads on paper.
- DSF 3 for components ≲ 700 CSS px wide, 2 for big ones. Sequences short (≤ 60 frames) and small.
- The **leak guard** throws when the OS user name or home path is visible in a plate (`leakGuard(text, deny)` for
  your own checks; pass more `deny` words to `Plate.begin` for names you know are real).
- The kit finds Chrome/Edge itself (`WORCA_CHROME` overrides). If `capture/lib.mjs` reports it cannot load
  `playwright-core`, set `WORCA_APP_ROOT` to worca's package directory.

## Mascots (`<P>/promo/film/mascot.js`, global `Mascot`)

`S.mascot(variant, opts)` wraps `Mascot.create({ tl, cue, parent, variant, size=180, x, y, facing=1, hidden })`.
(x, y) is the ground point between the feet; `size` is the body height in px. Base crew (re-skinned per product by
the mascot step; names are for the storyboard, never on screen): `clarifier` ("?" sign), `planner` (glasses,
blueprint), `refiner` (pencil), `builder` (cap, cart), `reviewer` (detective hat, magnifier), `boss` (tie,
clipboard, whistle), `plain`. Every action takes `at` (scene-local s) first, records onto the scene timeline, cues
its own sounds and returns the mascot (chainable); `m.x`, `m.y`, `m.facing` track where it ends up.

```
place(at, x, y, {facing})   enter(at, {from:'left'|'right'|'top'|'bottom'|'pop', to:[x,y], dur, style:'sneak'})
exit(at, {to:'left'|'right'|'top'|'bottom'|'pop', run})        walk/run/march/sneak(at, {to:[x,y], dur})
hop(at, {to:[x,y], height, dur})   jump(at, {height, dur})   bounce(at)   ride(at, {path:[[x,y],…], dur})
idle(at, dur)  blink(at)  face(at, 1|-1)  turn(at, dir)  look(at, {x,y}|'up'|'down'|'viewer'|'forward')
expr(at, 'neutral'|'happy'|'worried'|'surprised'|'sleepy'|'dizzy'|'proud'|'angry')
wave(at, dur)  point(at, {x,y}, dur)  cheer(at, dur)  nod(at, n)  shake(at, n)  squash(at, {amount, hold})
dizzy(at, dur)  sleep(at, dur)  trip(at)  bonk(at)  attention(at)  say(at, text, {dur, kind:'bubble'|'think'})
prop(at, name|null)  hat(at, name|null)  use(at, 'stamp'|'whistle'|'hammer'|'magnify'|'write'|'push'|'sip', {times, dur})
scale(at, s, dur)  show(at, {pop})  hide(at, {pop})  anchor(name, at) → {x,y}  ('nose' 'hat' 'eye' 'head' 'feet' …)
```
Props: `sign-q magnifier clipboard blueprint cart hammer pencil whistle stamp coffee flag wrench`.
Hats: `cap hardhat beret detective glasses tie crown party beanie grad flatcap`.

**Re-skinning (the mascot step only):** edit `<P>/promo/film/mascot.js` from the base rig — body colours, hats, props,
proportions — and keep the whole API above so scenes built against it still work. No arms, no hands, no human
features; props attach to the nose tip. `film/mascot-demo.html` shows every variant, action, hat and prop; snap it
to check your crew (below). Scenes may tween `m.el` (x/y/rotation/scale/opacity); the rig never writes its transform.

## Sound

`F.SFX` (kit.js) = `tools/sfx.mjs` names: `whoosh whoosh-short swoosh-up swish-down pop pop-high bubble click tap type
boing thud squash ding success sparkle stamp slide zip tick step hop land snore alarm scratch drumroll confetti lock
buzz cash chime rise impact wobble blip` (`type`, `drumroll`, `snore` loop to the cue's `dur`). Cues are dumped from
the film, thinned (many walking mascots must sound like a patter, not a drum roll) and mixed under the voice: every
narration line levelled to −16 LUFS, music −20 dB under speech / −10 dB in gaps, SFX bus −18 dB and −10 dB more under
speech, master −14 LUFS / −1 dBTP. The mix **fails** when any line's voice is < 12 dB over music + SFX (median of
50 ms speech frames) or > 5 % of its frames are under 6 dB — keep loud cues (impact, confetti, drumroll) off lines.

## Checking your work

```bash
node <P>/promo-kit/tools/build-data.mjs <P>/promo                                   # after any plate/scene-file change
node <P>/promo-kit/tools/snap.mjs --promo <P>/promo --scene export --step 0.5 --sheet <P>/promo/review/export.jpg --cols 6 --thumb 320
node <P>/promo-kit/tools/snap.mjs --promo <P>/promo --times 31.2,33.9 --out <P>/promo/review/export-frames --scale 1   # full-res frames
node <P>/promo-kit/tools/fluency.mjs --promo <P>/promo --from 28 --to 40 --sheets <P>/promo/review/fluency   # pops, flashes, holds, blank
node <P>/promo-kit/tools/snap.mjs --promo <P>/promo --cues <P>/promo/review/cues.json                     # every SFX cue
node <P>/promo-kit/tools/snap.mjs --html <P>/promo/film/mascot-demo.html --from 0 --to 64 --step 2 --sheet <P>/promo/review/mascot.jpg
node <P>/promo-kit/tools/sheet.mjs --out <P>/promo/review/plates.jpg --cols 4 <P>/promo/plates/export-dialog   # plate states
```
`snap` prints kit violations (unknown words, plates, states, anchors, sfx; scene overrun; failed scene files) and
page errors and exits 2 when there are any — fix all of them. Look at your frames (Read the JPGs). Contact sheets are
downscaled: verify every "unreadable text" finding on a full-res frame (`--scale 1`) before acting on it. Check
legibility at 1080p, nothing blank, nothing popping in without motion, the camera landing on what is named, mascots
clear of narrated text. Dev player: open `film/index.html?scene=<id>` in a browser (Space, ←/→, [ ]) — it plays
`audio/mix.mp3` once the mix exists.
