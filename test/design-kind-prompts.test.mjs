// test/design-kind-prompts.test.mjs — Design P7 Task 7: the lead and builder prompts per kind (src/core/design/kind-prompts.mjs,
// src/core/design/prompts.mjs). Web stays P2's text byte for byte; decks and video swap the band and slot rules for a
// slide or scene block, and a builder's user prompt names its slide or its scene's window. SPEC C-2, C-3, M5, M9.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  builderChangePrompt, builderPrompt, builderSystemPrompt, leadChangePrompt, leadPlanPrompt, leadSystemPrompt,
} from '../src/core/design/prompts.mjs';
import { boardShellRule, builderKindBlock, builderKindLines, leadKindBlock, leadKindLines } from '../src/core/design/kind-prompts.mjs';

test('web is the default kind, and adds no kind lines', () => {   // P2's web text stays pinned by test/design-spawn-options.test.mjs:107, :186-190, :244-250
  assert.equal(leadSystemPrompt({ kind: 'web' }), leadSystemPrompt());
  assert.equal(builderSystemPrompt({ kind: 'web' }), builderSystemPrompt());
  assert.deepEqual(leadKindLines('web'), []);
  assert.deepEqual(builderKindLines({ kind: 'web', plan: { sections: [] }, section: {} }), []);
  assert.match(leadChangePrompt({ instruction: 'x', roundFile: '/r', questionFile: '/q' }), /it; you may place the slot of a section you add in `shell\.html`\. Never edit/);
});

test('a deck lead is told slides, not bands', () => {
  for (const kind of ['presentation', 'pitch']) {
    const s = leadSystemPrompt({ kind });
    assert.match(s, /one section is one slide/i); assert.match(s, /plan\.json last/i); assert.match(s, /<!--worca:sections-->/);
    for (const no of [/hero-copy/, /data-worca-slot/, /smallest piece/i, /\bband\b/i]) assert.doesNotMatch(s, no);
    // The plan shape validatePlan needs (v, title, brief, parts), and P2's job, ids, parts and notes bullets.
    assert.ok(s.includes('{"v":1,"kind":"pitch","title":"…","canvas":{"w":1920,"h":1080},"notes":"…","sections":[{"id":"title","job":"Title","brief":"…","parts":["html","css"]}]}'));
    for (const bullet of ['- `job` is one line of at most 24 characters', '- Section ids match /^[a-z][a-z0-9-]{0,31}$/', '- `parts` names the files', '- `notes` is the shared contract']) {
      assert.ok(s.includes(bullet), bullet);
    }
  }
  assert.match(leadKindLines('pitch').join('\n'), /problem, why now, product, how it works, traction, market, business model, competition, team, ask/);
  assert.doesNotMatch(leadKindLines('presentation').join('\n'), /traction/);
});

test('a video lead sets durations', () => {
  const s = leadSystemPrompt({ kind: 'video' });
  assert.match(s, /one section is one scene/i); assert.match(s, /"duration"/); assert.doesNotMatch(s, /data-worca-slot|hero-copy/);
  assert.ok(s.includes('"canvas":{"w":1920,"h":1080,"fps":60}') && s.includes('"parts":["html","css","js"],"duration":6}'));
  assert.match(leadKindLines('video').join('\n'), /no sound/i);
});

test('the kind lines sit after Target and before the brief, never inside it', () => {
  const p = leadPlanPrompt({ brief: 'B', kind: 'pitch', projectDir: '/p', kitContract: '/k', questionFile: '/q', planFile: '/f' }).split('\n');
  const at = p.indexOf(leadKindLines('pitch')[0]);
  assert.equal(p[at - 1], 'Target: one section per slide, at most 40.');
  assert.match(p[at + 1], /^Project: \/p /);
  assert.equal(leadPlanPrompt({ brief: 'B', questionFile: '/q', planFile: '/f' }).split('\n')[3], 'Question file: /q', 'web adds nothing');
  const board = leadChangePrompt({ kind: 'video', instruction: 'x', roundFile: '/r', questionFile: '/q' });
  assert.match(board, /when the change needs it\. Never edit plan\.json/);
  const FILM = { sections: [{ id: 'a', job: 'A', parts: ['html'], duration: 2 }, { id: 'b', job: 'B', parts: ['html'], duration: 3 }] };
  const c = builderChangePrompt({ section: FILM.sections[1], instruction: 'I', brief: 'Bolder', notes: 'N', sectionDir: '/s', questionFile: '/q', kind: 'video', plan: FILM }).split('\n');
  assert.deepEqual(c.slice(c.indexOf('Plan notes: N') + 1, c.indexOf('For this section: Bolder')), ['Scene 2 of 2: 2s to 5s of a 5s film.', 'S.dur is 3.']);
});

test('builders share one system prompt per kind; the section is in the user prompt', () => {
  const deck = builderSystemPrompt({ kind: 'pitch' }); const film = builderSystemPrompt({ kind: 'video' });
  assert.match(deck, /<section data-section="<id>" data-label="<job>">/);
  assert.match(deck, /36px/); assert.match(deck, /data-deck-anim/);
  assert.match(film, /<div data-section="<id>" data-scene>/);
  assert.match(film, /composed state/); assert.match(film, /\(root, S\)/);
  for (const t of ['setTimeout', 'requestAnimationFrame', 'Math.random', 'gsap.from', 'S.tl']) assert.ok(film.includes(t), t);
  assert.ok(deck.startsWith(`${builderSystemPrompt()}\n\n`) && film.startsWith(`${builderSystemPrompt()}\n\n`));
  const S = (id, duration) => ({ id, job: id, duration });
  const FILM = { sections: [S('a', 6), S('b', 10), S('c', 4)] };
  assert.deepEqual(builderKindLines({ kind: 'video', plan: FILM, section: FILM.sections[1] }), ['Scene 2 of 3: 6s to 16s of a 20s film.', 'S.dur is 10.']);
  assert.deepEqual(builderKindLines({ kind: 'video', plan: FILM, section: { ...FILM.sections[2] } }), ['Scene 3 of 3: 16s to 20s of a 20s film.', 'S.dur is 4.'], 'by id, not identity');
  const FRAC = { sections: [S('a', 0.1), S('b', 0.2), S('c', 1)] };
  assert.deepEqual(builderKindLines({ kind: 'video', plan: FRAC, section: FRAC.sections[2] }), ['Scene 3 of 3: 0.3s to 1.3s of a 1.3s film.', 'S.dur is 1.']);
  const DECK = { sections: [{ id: 'x', job: 'X' }, { id: 'y', job: 'Y' }] };
  assert.deepEqual(builderKindLines({ kind: 'pitch', plan: DECK, section: DECK.sections[1] }), ['Slide 2 of 2.']);
  assert.deepEqual(builderKindLines({ kind: 'pitch', plan: DECK, section: { id: 'ghost' } }), []);
  assert.doesNotMatch(leadChangePrompt({ kind: 'pitch', instruction: 'x', roundFile: '/r', questionFile: '/q' }), /place the slot/);
  const p = builderPrompt({ section: FILM.sections[1], notes: 'N', sectionDir: '/s', tokensCss: '/t', globalCss: '/g', crewJson: '/c', questionFile: '/q', kind: 'video', plan: FILM });
  for (const line of ['Section: b', 'Scene 2 of 3: 6s to 16s of a 20s film.']) assert.ok(p.split('\n').includes(line), line);
  assert.ok(p.includes('S.dur is 10.\n\nBrief:\n'), 'the kind lines come before the brief');
});

test('the kit\'s other files are named as not to be read', () => {
  for (const kind of ['pitch', 'video']) assert.match(builderSystemPrompt({ kind }), /read only `?CONTRACT\.md`? in the kit/i);
});

test('beyond the plan (p8t1 live proof): slides stay inside the canvas, and a film\'s CSS has no will-change', () => {
  // A real 8-slide pitch bled decorative arcs past the canvas on 3 slides (scrollWidth 2440 of 1920), so the bridge
  // reported them `overflow:true`. A real film's lead gave every word `will-change` in global.css, and a time sought
  // out of order then painted 21,773 pixels differently.
  for (const kind of ['presentation', 'pitch']) {
    const deck = builderSystemPrompt({ kind });
    assert.match(deck, /Nothing reaches past the slide's edges/, kind);
    assert.match(deck, /position:absolute, inset:0 and overflow:hidden/, kind);
  }
  assert.match(builderSystemPrompt({ kind: 'video' }), /CSS animations or transitions, will-change, video or audio/);
  assert.match(leadSystemPrompt({ kind: 'video' }), /tokens\.css and global\.css follow the film rules too: no @keyframes, animation, transition or will-change\./);
  assert.doesNotMatch(leadSystemPrompt({ kind: 'pitch' }), /will-change/);
});

test('review M11: each board kind\'s copy word for word, and the lead and builder system prompts built from it', () => {
  const SLIDES = 'Shell rules: a `<head>` element, then exactly one `<!--worca:head-->` inside `<head>`, one `<!--worca:sections-->` in `<body>` and one `<!--worca:foot-->` at the end of `<body>`. No slots and nothing of the slides: worca wraps them in the stage. The assembler refuses a shell that breaks these rules (BAD_SHELL) at the end of a paid round.';
  const SCENES = SLIDES.replace('nothing of the slides', 'nothing of the scenes');
  const DECK_LEAD = 'One section is one slide, listed in the order they are shown. The crew works in plan order. shell.html holds the three markers and nothing of the slides: worca wraps them in the stage. Canvas {w:1920,h:1080}. No estHeight. job is at most 24 chars and appears on the slide\'s tile. Ids /^[a-z][a-z0-9-]{0,31}$/, at most 40 sections. Read only CONTRACT.md in the kit; the rest is runtime.';
  const FILM_LEAD = 'One section is one scene, listed in the order they play. Give each a "duration" in seconds; the film is their sum. Canvas {w:1920,h:1080,fps:60}. No estHeight. shell.html holds the three markers and nothing of the scenes: worca wraps them in the stage. job is at most 24 chars and appears on the scene\'s tile and the timeline. Ids /^[a-z][a-z0-9-]{0,31}$/, at most 40 sections. tokens.css and global.css follow the film rules too: no @keyframes, animation, transition or will-change. Read only CONTRACT.md in the kit; the rest is runtime.';
  const DECK_BUILDER = 'This section is one slide on a fixed 1920×1080 canvas. Root element: <section data-section="<id>" data-label="<job>">. Body text at least 36px, title at least 56px, nothing under 20px, contrast at least 4.5:1, at most 30 words on a live slide. Nothing reaches past the slide\'s edges: a shape that bleeds off one sits in a wrapper with position:absolute, inset:0 and overflow:hidden, so the slide never grows. Reveals use data-step, motion uses data-deck-anim, and a tagged element has no own animation, transform or clip-path. Read only CONTRACT.md in the kit; the rest is runtime.';
  const FILM_BUILDER = 'This section is one scene on a fixed 1920×1080 canvas. Root element: <div data-section="<id>" data-scene>. index.html is the scene\'s composed state. script.js runs once with (root, S). Build everything on S.tl and S.onFrame, with S.dur as your length. The film seeks in any order: never setTimeout, setInterval, requestAnimationFrame, Date, performance.now, Math.random, fetch, await, gsap.from, CSS animations or transitions, will-change, video or audio. Initial states with S.tl.set(el, {…}, 0), then .to(). Read only CONTRACT.md in the kit; the rest is runtime.';
  const want = {
    presentation: [SLIDES, DECK_LEAD, DECK_BUILDER, ['This design is a presentation. Build the argument the brief asks for, one claim per slide.']],
    pitch: [SLIDES, DECK_LEAD, DECK_BUILDER, ['This design is a pitch deck. The usual arc is problem, why now, product, how it works, traction, market, business model, competition, team, ask. Follow the brief where it differs.']],
    video: [SCENES, FILM_LEAD, FILM_BUILDER, ['This design is a video made of HTML and JavaScript, with no sound. Hit the length the brief names within one second.']],
    web: ['', '', '', []],
  };
  for (const [kind, [shell, lead, builder, kindLines]] of Object.entries(want)) {
    assert.deepEqual([boardShellRule(kind), leadKindBlock(kind), builderKindBlock(kind), leadKindLines(kind)], [shell, lead, builder, kindLines], kind);
    if (kind === 'web') continue;
    const s = leadSystemPrompt({ kind });
    // The board's shell rule in the web rule's place, never both: the mutant leadSystem(WEB_SHELL_RULE, …) reads the same otherwise.
    assert.deepEqual(s.split('\n').filter((l) => l.startsWith('Shell rules:')), [shell], `${kind}: one shell rule, the board's`);
    assert.ok(s.includes(`\n6. plan.json last, in the plan shape below.\n\n${shell}\n\n${lead}\n\nThe plan shape (`), kind);
    assert.equal(builderSystemPrompt({ kind }), `${builderSystemPrompt()}\n\n${builder}`, kind);
  }
});
