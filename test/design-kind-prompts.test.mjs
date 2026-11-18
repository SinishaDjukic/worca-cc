// test/design-kind-prompts.test.mjs — Design P7 Task 7: the lead and builder prompts per kind (src/core/design/kind-prompts.mjs,
// src/core/design/prompts.mjs). Web keeps P2's bands and slots; decks and video swap them for a slide or scene block,
// and a builder's user prompt names its slide or its scene's window. Every kind's builder shares the text up to its
// last block: a web page ends with its Craft block, a deck or a video with its slide or scene block. SPEC C-2, C-3, M5, M9.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  builderChangePrompt, builderPrompt, builderSystemPrompt, leadChangePrompt, leadPlanPrompt, leadSystemPrompt,
} from '../src/core/design/prompts.mjs';
import { boardShellRule, builderKindBlock, builderKindLines, docPlanShape, docShellRule, leadKindBlock, leadKindLines } from '../src/core/design/kind-prompts.mjs';

/** A 3-scene video plan. */
const PLAN = { kind: 'video', sections: [{ id: 'open', job: 'Open', parts: ['html', 'css', 'js'], duration: 6 }, { id: 'plan', job: 'Plan', parts: ['html', 'css', 'js'], duration: 5 }, { id: 'end', job: 'End', parts: ['html', 'css', 'js'], duration: 4 }] };
/** SPEC §7's Sound block, word for word: the last block of a video lead's system prompt when its film has sound. */
const SOUND_BLOCK = [
  'Sound (this video has a voice; worca makes it and plays it beside the scenes):',
  '- A scene may carry `"say"` in plan.json: the words the voice speaks during that scene, in the brief\'s language, as plain sentences. No stage directions, no markup, no emoji, at most 1500 characters.',
  '- The voice tells the story and the screen shows it. Never put a spoken sentence on screen as text: show the few words that matter.',
  '- Size each scene to its words: about 2.5 words a second, plus one second. worca makes a scene longer when its voice needs it, never shorter. Keep the script tight enough that the film still hits the length the brief names.',
  '- A scene with nothing to say has no `"say"`. The first scene speaks. The last sentence ends before the film\'s last second.',
  '- In each scene\'s `brief`, say what is on screen as each sentence is spoken.',
  '- In a change round a `touch` may carry `"say"` to change that scene\'s words; `""` takes its voice away. Leave `"say"` out to keep the words.',
  '- Scenes never play sound themselves: no `<audio>`, no `<video>`.',
].join('\n');

/** What every kind's builder reads before its own last block: the web prompt up to its `A web page:` block. */
function sharedBuilderText() {
  const web = builderSystemPrompt();
  const at = web.lastIndexOf('\n\nA web page:\n');
  assert.ok(at > 0, 'a web builder ends with its own block');
  return web.slice(0, at);
}

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
  assert.ok(deck.startsWith(`${sharedBuilderText()}\n\n`) && film.startsWith(`${sharedBuilderText()}\n\n`));
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
    assert.equal(builderSystemPrompt({ kind }), `${sharedBuilderText()}\n\n${builder}`, kind);
  }
});

test('a document: its lead block, builder block, kind lines and shell rule; part and page in the user prompt', () => {
  const lead = leadKindBlock('document');
  for (const s of ['One section is one part of the document: an <h2> and what it covers, listed in reading order.',
    'shell.html holds the title block (title, subtitle, date, authors) above <!--worca:sections-->, and no slots: worca places the sections in plan order and, with "toc", puts the contents list it makes from their headings first.',
    '"page" is "A4" or "Letter": the size the brief names, else "A4".',
    'Parts are html and css: a document runs no script, and there is no global.js.',
    '`estHeight` in px on every section. Write no `canvas`: worca sets it from "page".',
    'Read CONTRACT.md in the kit, and its worca-look/ files when the look is worca\'s.']) assert.ok(lead.includes(s), s);
  const builder = builderKindBlock('document');
  for (const s of ['Root element: <section data-section="<id>">.',
    'Every <h2> and <h3> has an id that starts with your section id and a hyphen: worca\'s contents list links to it.',
    'Charts and diagrams are static inline <svg> with a viewBox and real text labels, coloured from the chart tokens: no script, no canvas, no picture of a chart.',
    'A figure, a table row and a callout never break across a printed page.',
    'Real content: plausible names, numbers and sources, never lorem ipsum. Numbers in a table or a chart label get font-variant-numeric: tabular-nums.',
    'Read CONTRACT.md in the kit, and its worca-look/ files when the look is worca\'s.']) assert.ok(builder.includes(s), s);
  assert.deepEqual(leadKindLines('document'), ['This design is a document: a report, an analysis, an architecture document or what the brief asks for. It is read on screen and printed.']);
  const shell = docShellRule();
  for (const s of ['exactly one `<!--worca:head-->` inside `<head>`, one `<!--worca:sections-->` in `<body>` and one `<!--worca:foot-->` at the end of `<body>`', 'No slots', '(BAD_SHELL)']) assert.ok(shell.includes(s), s);
  assert.equal(docPlanShape(), '{"v":1,"kind":"document","title":"…","page":"A4","toc":true,"numbered":false,"notes":"…","sections":[{"id":"summary","job":"Summary","brief":"…","parts":["html","css"],"estHeight":900}]}');
  assert.deepEqual([boardShellRule('document'), boardShellRule('web')], ['', '']);

  const s = leadSystemPrompt({ kind: 'document' });
  assert.deepEqual(s.split('\n').filter((l) => l.startsWith('Shell rules:')), [shell], 'one shell rule, the document\'s');
  assert.ok(s.includes(`\n5. plan.json last, in the plan shape below.\n\n${shell}\n\n${lead}\n\nThe plan shape (`));
  assert.ok(s.includes(docPlanShape()));
  for (const no of [/data-worca-slot/, /hero-copy/, /\bband\b/i]) assert.doesNotMatch(s, no);

  const PLAN = { page: 'Letter', sections: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  assert.deepEqual(builderKindLines({ kind: 'document', plan: PLAN, section: { id: 'b' } }), ['Part 2 of 3.', 'Printed page: Letter.']);
  assert.deepEqual(builderKindLines({ kind: 'document', plan: PLAN, section: { id: 'ghost' } }), []);
  const p = builderPrompt({ section: { id: 'b', job: 'B', parts: ['html', 'css'], brief: 'Brief' }, notes: 'N', sectionDir: '/s', tokensCss: '/t', globalCss: '/g', crewJson: '/c', questionFile: '/q', kind: 'document', plan: PLAN });
  assert.ok(p.includes('Plan notes: N\nPart 2 of 3.\nPrinted page: Letter.\n\nBrief:\nBrief'));
  // One cacheable builder prefix per kind: the plan never reaches the system prompt.
  assert.equal(builderSystemPrompt({ kind: 'document' }), builderSystemPrompt({ kind: 'document', plan: PLAN }));
  assert.ok(builderSystemPrompt({ kind: 'document' }).endsWith(builder));
});

test('without sound every prompt is what it was', () => {
  assert.equal(leadSystemPrompt({ kind: 'video', sound: false }), leadSystemPrompt({ kind: 'video' }));
  for (const kind of ['pitch', 'document', 'web']) assert.equal(leadSystemPrompt({ kind, sound: true }), leadSystemPrompt({ kind }));
  assert.deepEqual(leadKindLines('video', {}), leadKindLines('video'));
  assert.match(leadKindLines('video')[0], /with no sound/);
  const base = { brief: 'b', kind: 'video', questionFile: 'q', planFile: 'p' };
  assert.equal(leadPlanPrompt({ ...base, soundLine: null }), leadPlanPrompt(base));
  const ch = { instruction: 'x', kind: 'video', questionFile: 'q', roundFile: 'r' };
  assert.equal(leadChangePrompt({ ...ch, soundLine: null }), leadChangePrompt(ch));
  assert.deepEqual(builderKindLines({ kind: 'video', plan: PLAN, section: PLAN.sections[0], clip: null }), builderKindLines({ kind: 'video', plan: PLAN, section: PLAN.sections[0] }));
  const first = { section: PLAN.sections[1], notes: 'N', sectionDir: '/s', tokensCss: '/t', globalCss: '/g', crewJson: '/c', questionFile: '/q', kind: 'video', plan: PLAN };
  assert.equal(builderPrompt({ ...first, clip: null }), builderPrompt(first));
  const change = { section: PLAN.sections[1], instruction: 'I', brief: 'Bolder', notes: 'N', sectionDir: '/s', questionFile: '/q', kind: 'video', plan: PLAN };
  assert.equal(builderChangePrompt({ ...change, clip: null }), builderChangePrompt(change));
});
test('with sound the lead is told how to write the words', () => {
  const base = leadSystemPrompt({ kind: 'video' });
  const sys = leadSystemPrompt({ kind: 'video', sound: true });
  assert.equal(sys.replace('"brief":"…","say":"…"', '"brief":"…"'), `${base}\n\n${SOUND_BLOCK}`);   // only the shape and the last block differ
  const pics = leadSystemPrompt({ kind: 'video', pictures: true }).slice(base.length);
  assert.equal(leadSystemPrompt({ kind: 'video', sound: true, pictures: true }), `${sys.slice(0, -(SOUND_BLOCK.length + 2))}${pics}\n\n${SOUND_BLOCK}`);   // Sound is last (SPEC §7)
  assert.deepEqual(leadKindLines('video', { sound: { music: true } }), ['This design is a video made of HTML and JavaScript. worca adds a voice and music. Aim at the length the brief names.']);
  assert.deepEqual(leadKindLines('video', { sound: { music: false } }), ['This design is a video made of HTML and JavaScript. worca adds a voice. Aim at the length the brief names.']);
  const p = leadPlanPrompt({ brief: 'b', kind: 'video', questionFile: 'q', planFile: 'p', sound: { music: true }, soundLine: 'Sound: voice "Ana"; music: calm' });
  assert.match(p, /^Kind: video\nSound: voice "Ana"; music: calm$/m);
  assert.doesNotMatch(p, /with no sound/);
  const c = leadChangePrompt({ instruction: 'x', kind: 'video', questionFile: 'q', roundFile: 'r', soundLine: 'Sound: voice "Ana"; music: no music' });
  assert.match(c, /^Kind: video\nSound: voice "Ana"; music: no music$/m);
  assert.match(c, /"touch":\[\{"id":[^\]]*"say":"…"/);
});
test('a builder is told the sentences and when they start', () => {
  const lines = builderKindLines({ kind: 'video', plan: PLAN, section: PLAN.sections[0], clip: { at: 0.35, seconds: 4.82, cues: [{ t: 0.4, text: 'Meet worca.' }, { t: 1.45, text: 'It plans.' }] } });
  assert.deepEqual(lines.slice(2), ['The voice speaks in this scene from 0.35s to 5.17s. Each sentence and when it starts:', '- 0.4s "Meet worca."', '- 1.45s "It plans."',
    'Time what appears to these sentences. Never show a whole spoken sentence as text.']);
});
test('a soundLine shows the round shape with say; a builder\'s clip reaches both builder prompts; other kinds stay silent', () => {
  const ch = { instruction: 'x', kind: 'video', questionFile: 'q', roundFile: 'r' };
  assert.doesNotMatch(leadChangePrompt(ch), /"say"/);
  assert.ok(leadChangePrompt(ch).includes('"touch":[{"id":"hero","brief":"…"}],"add":'));
  for (const kind of ['pitch', 'document', 'web']) assert.deepEqual(leadKindLines(kind, { sound: { music: true } }), leadKindLines(kind), kind);
  const clip = { at: 0.5, seconds: 2, cues: [{ t: 0.5, text: 'Hello.' }] };
  const said = ['S.dur is 5.', 'The voice speaks in this scene from 0.5s to 2.5s. Each sentence and when it starts:', '- 0.5s "Hello."', 'Time what appears to these sentences. Never show a whole spoken sentence as text.'].join('\n');
  const first = builderPrompt({ section: PLAN.sections[1], notes: 'N', sectionDir: '/s', tokensCss: '/t', globalCss: '/g', crewJson: '/c', questionFile: '/q', kind: 'video', plan: PLAN, clip });
  assert.ok(first.includes(`${said}\n\nBrief:\n`), 'builderPrompt passes the clip on');
  const change = builderChangePrompt({ section: PLAN.sections[1], instruction: 'I', brief: 'Bolder', notes: 'N', sectionDir: '/s', questionFile: '/q', kind: 'video', plan: PLAN, clip });
  assert.ok(change.includes(`${said}\nFor this section: Bolder`), 'builderChangePrompt passes the clip on');
  assert.deepEqual(builderKindLines({ kind: 'pitch', plan: PLAN, section: PLAN.sections[1], clip }), ['Slide 2 of 3.']);
});
