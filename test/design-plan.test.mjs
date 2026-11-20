// test/design-plan.test.mjs — plan, round and integration validators (P1 Task 9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import { validatePlan, validateRound, validateIntegration, DEFAULT_EST_HEIGHT, MAX_SAY } from '../src/core/design/plan.mjs';
import { applyRound } from '../src/core/design/build.mjs';

const sec = (id, extra = {}) => ({ id, job: id[0].toUpperCase() + id.slice(1), brief: 'b', parts: ['html', 'css'], estHeight: 600, ...extra });
const WEB = { v: 1, kind: 'web', title: 'ShipRadar', canvas: { w: 1440 }, notes: 'Shared contract in two lines', sections: [sec('hero', { parts: ['html', 'css', 'js'], estHeight: 820 }), sec('pricing')] };
const DECK = { v: 1, kind: 'pitch', title: 'P', canvas: { w: 1920, h: 1080 }, sections: [{ id: 's1', job: 'One', brief: 'b', parts: ['html'] }] };
const FILM = { v: 1, kind: 'video', title: 'F', canvas: { w: 1920, h: 1080, fps: 60 }, sections: [{ id: 'scene-1', job: 'Scene 1', brief: 'b', parts: ['html', 'js'], duration: 6 }] };
const errs = (o, opts = {}) => validatePlan(o, opts).errors.join('\n');

test('valid plans of every kind pass; text with a BOM parses; unknown keys drop', () => {
  for (const p of [WEB, DECK, FILM]) assert.equal(validatePlan(p, { kind: p.kind }).ok, true, p.kind);
  assert.deepEqual(validatePlan(`\uFEFF${JSON.stringify(WEB)}`).plan.sections.map((s) => s.id), ['hero', 'pricing']);
  assert.equal(validatePlan({ ...DECK, kind: 'presentation' }).ok, true);
  const out = validatePlan({ ...WEB, extra: 1, sections: [sec('hero', { x: 1 })] }).plan;
  assert.equal('extra' in out, false); assert.equal('x' in out.sections[0], false);
  assert.equal(validatePlan({ ...WEB, notes: undefined }).plan.notes, '');
  assert.equal(validatePlan({ ...WEB, sections: [sec('hero', { estHeight: 820.4 })] }).plan.sections[0].estHeight, 820);
});

test('never throws: anything that is not a plan is an error list', () => {
  for (const x of [null, undefined, 7, 'not json', '[]', '```json\n{}\n```', [], {}, 'x'.repeat(1024 * 1024 + 1)]) {
    const r = validatePlan(x);
    assert.equal(r.ok, false); assert.equal(r.plan, null); assert.ok(r.errors.length > 0);
  }
});

test('each plan rule names what is wrong', async () => {
  await checkRows([
    [{ ...WEB, v: 2 }, /v must be 1/],
    [{ ...WEB, kind: 'film' }, /kind must be one of web, presentation, pitch, video/],
    [{ ...WEB, title: '' }, /title/], [{ ...WEB, title: 'x'.repeat(121) }, /title/],
    [{ ...WEB, canvas: { w: 100 } }, /canvas\.w/], [{ ...WEB, canvas: { w: 5000 } }, /canvas\.w/],
    [{ ...DECK, canvas: { w: 1280, h: 720 } }, /canvas must be \{w:1920,h:1080\}/],
    [{ ...FILM, canvas: { w: 1920, h: 1080 } }, /fps must be 60/],
    [{ ...WEB, notes: 'x'.repeat(2001) }, /notes/],
    [{ ...WEB, sections: [] }, /at least one section/],
    [{ ...WEB, sections: Array.from({ length: 41 }, (_, i) => sec(`s${i}`)) }, /at most 40 sections/],
    [{ ...WEB, sections: [sec('hero'), sec('hero')] }, /duplicate section id "hero"/],
    [{ ...WEB, sections: [sec('con')] }, /section id "con"/],
    [{ ...WEB, sections: [sec('tokens')] }, /section id "tokens"/],
    [{ ...WEB, sections: [sec('global')] }, /section id "global"/],
    [{ ...WEB, sections: [sec('Hero')] }, /section id "Hero"/],
    [{ ...WEB, sections: [sec('hero', { job: 'x'.repeat(25) })] }, /job.*24/],
    [{ ...WEB, sections: [sec('hero', { job: 'a\nb' })] }, /job.*one line/],
    [{ ...WEB, sections: [sec('hero', { brief: '' })] }, /brief/],
    [{ ...WEB, sections: [sec('hero', { parts: ['css'] })] }, /parts must include html/],
    [{ ...WEB, sections: [sec('hero', { parts: ['html', 'php'] })] }, /parts/],
    [{ ...WEB, sections: [sec('hero', { parts: ['html', 'html'] })] }, /parts/],
    [{ ...WEB, sections: [sec('hero', { estHeight: undefined })] }, /estHeight/],
    [{ ...WEB, sections: [sec('hero', { estHeight: 0 })] }, /estHeight/],
    [{ ...WEB, sections: [sec('hero', { estHeight: 20001 })] }, /estHeight/],
    [{ ...FILM, sections: [{ ...FILM.sections[0], duration: undefined }] }, /duration/],
    [{ ...FILM, sections: [{ ...FILM.sections[0], duration: 601 }] }, /duration/],
  ].map(([p, re], i) => ({ name: `row ${i}`, run: () => assert.match(errs(p), re) })));
  assert.match(errs(WEB, { kind: 'video' }), /kind "web" is not this design's kind "video"/);
});

test('band: optional, one line, 1 to 24 chars, on a section and on a round add; no other rule reads it', () => {
  const p = validatePlan({ ...WEB, sections: [sec('hero-copy', { band: 'Hero' }), sec('hero-visual', { band: 'Hero' }), sec('pricing')] });
  assert.equal(p.ok, true, p.errors.join());
  assert.deepEqual(p.plan.sections.map((s) => s.band), ['Hero', 'Hero', undefined]);
  assert.equal('band' in p.plan.sections[2], false, 'absent stays absent');
  assert.equal('band' in validatePlan({ ...WEB, sections: [sec('a', { band: null })] }).plan.sections[0], false, 'null reads as absent');
  assert.equal(validatePlan({ ...WEB, sections: [sec('a', { band: 'x'.repeat(24) })] }).ok, true);
  for (const bad of ['', '   ', 'x'.repeat(25), 'a\nb', 7, ['Hero']]) assert.match(errs({ ...WEB, sections: [sec('a', { band: bad })] }), /band/, JSON.stringify(bad));
  assert.equal(validatePlan({ ...WEB, sections: [sec('a', { band: 'A' }), sec('b'), sec('c', { band: 'A' })] }).ok, true, 'no adjacency rule');
  assert.equal(validatePlan({ ...DECK, sections: [{ ...DECK.sections[0], band: 'Intro' }] }).ok, true, 'any kind');
  const plan = { ...WEB, sections: [sec('hero'), sec('pricing')] };
  const add = { id: 'faq', job: 'FAQ', brief: 'b', parts: ['html'], after: 'pricing', band: 'Help' };
  assert.equal(validateRound({ v: 1, summary: 's', add: [add] }, { plan }).round.add[0].band, 'Help');
  assert.match(validateRound({ v: 1, summary: 's', add: [{ ...add, band: 'x'.repeat(25) }] }, { plan }).errors.join(), /band/);
});

test('estHeight is each section\'s own placeholder height: sections beside each other in a band validate the same', () => {
  const fine = Array.from({ length: 32 }, (_, i) => sec(`card-${i}`, { band: `Row ${i % 8}`, estHeight: 1 + i }));
  const p = validatePlan({ ...WEB, sections: fine });
  assert.equal(p.ok, true, p.errors.join());
  assert.deepEqual(p.plan.sections.slice(0, 3).map((s) => s.estHeight), [1, 2, 3], 'kept per section, never shared across a band or summed');
  assert.equal(validatePlan({ ...WEB, sections: [sec('a', { estHeight: 0.4 })] }).plan.sections[0].estHeight, 1, 'a tiny section still gets a box');
  assert.match(errs({ ...WEB, sections: [sec('a', { band: 'Row', estHeight: undefined })] }), /estHeight/, 'a band does not make it optional');
  assert.equal(DEFAULT_EST_HEIGHT, 240);
});

test('validateRound: C-2 example passes; references are checked against the plan', () => {
  const plan = { ...WEB, sections: [sec('hero'), sec('pricing'), sec('team')] };
  const ok = { v: 1, summary: 's', touch: [{ id: 'hero', brief: 'b' }], add: [{ id: 'faq', job: 'FAQ', brief: 'b', parts: ['html', 'css'], after: 'pricing' }], remove: ['team'] };
  const r = validateRound(ok, { plan });
  assert.equal(r.ok, true, r.errors.join());
  assert.equal(r.round.add[0].estHeight, DEFAULT_EST_HEIGHT);
  assert.equal(validateRound({ v: 1, summary: 'global colours only' }, { plan }).ok, true, 'a round may touch only global files');
  assert.deepEqual(validateRound({ v: 1, summary: 's' }, { plan }).round.touch, []);
  const e = (o) => validateRound({ v: 1, summary: 's', ...o }, { plan }).errors.join('\n');
  assert.match(e({ touch: [{ id: 'ghost', brief: 'b' }] }), /touch.*ghost/);
  assert.match(e({ touch: [{ id: 'hero', brief: 'b' }], remove: ['hero'] }), /hero.*both/);
  assert.match(e({ remove: ['ghost'] }), /remove.*ghost/);
  assert.match(e({ add: [{ ...ok.add[0], id: 'hero' }] }), /add.*hero.*exists/);
  assert.match(e({ add: [ok.add[0], ok.add[0]] }), /duplicate section id "faq"/);
  assert.match(e({ add: [{ ...ok.add[0], id: 'team' }], remove: ['team'] }), /add.*team/);
  assert.match(e({ add: [{ ...ok.add[0], id: 'nul' }] }), /section id "nul"/);
  assert.match(e({ add: [{ ...ok.add[0], id: 'global' }] }), /section id "global"/);
  assert.match(e({ add: [{ ...ok.add[0], after: 'ghost' }] }), /after.*ghost/);
  assert.match(e({ add: [{ ...ok.add[0], after: 'team' }], remove: ['team'] }), /after.*team/);
  assert.match(e({ remove: ['hero', 'pricing', 'team'] }), /at least one section/);
  assert.match(e({ add: Array.from({ length: 38 }, (_, i) => ({ ...ok.add[0], id: `n${i}`, after: 'hero' })) }), /at most 40 sections/);
  assert.match(validateRound({ v: 1, summary: '' }, { plan }).errors.join(), /summary/);
  const a2 = validateRound({ v: 1, summary: 's', add: [{ ...ok.add[0], id: 'one', after: 'hero' }, { ...ok.add[0], id: 'two', after: 'one' }] }, { plan });
  assert.equal(a2.ok, true, 'after may name a section added earlier in the round');
  const filmPlan = FILM;
  assert.match(validateRound({ v: 1, summary: 's', add: [{ id: 'scene-2', job: 'Scene 2', brief: 'b', parts: ['html'] }] }, { plan: filmPlan }).errors.join(), /duration/);
  for (const x of [null, 'nope', []]) assert.equal(validateRound(x, { plan }).ok, false);
});

test('validateIntegration: the C-2 example passes, rework ids must be real', () => {
  const r = validateIntegration({ v: 1, done: true, rework: [{ id: 'hero', why: 'clashes' }] }, { plan: WEB });
  assert.equal(r.ok, true);
  assert.deepEqual(validateIntegration({ v: 1, done: true }, { plan: WEB }).integration.rework, []);
  const e = (o) => validateIntegration(o, { plan: WEB }).errors.join('\n');
  assert.deepEqual(validateIntegration({ v: 1, rework: [{ id: 'hero', why: 'x' }] }, { plan: WEB }).integration.rework, [{ id: 'hero', why: 'x' }], 'done is optional: M10, the engine reads rework');
  assert.match(e({ v: 1, done: 'yes' }), /done/);
  assert.match(e({ v: 1, done: true, rework: [{ id: 'ghost', why: 'x' }] }), /ghost/);
  assert.match(e({ v: 1, done: true, rework: [{ id: 'hero', why: '' }] }), /why/);
  assert.match(e({ v: 1, done: true, rework: [{ id: 'hero', why: 'a' }, { id: 'hero', why: 'b' }] }), /duplicate/);
  for (const x of [null, 'nope', []]) assert.equal(validateIntegration(x, { plan: WEB }).ok, false);
});

test('pinned limits and output shapes the rows above leave open', () => {
  const MiB = 1024 * 1024;
  const text = JSON.stringify(WEB);
  assert.equal(validatePlan(text + ' '.repeat(MiB - text.length)).ok, true, 'exactly 1 MiB is read');
  assert.match(validatePlan(text + ' '.repeat(MiB - text.length + 1)).errors.join(), /1 MiB/);
  assert.equal(validatePlan({ ...WEB, sections: Array.from({ length: 30 }, (_, i) => sec(`s${i}`, { brief: '' })) }).errors.length, 20, 'first 20 errors kept');
  for (const w of [320, 3840]) assert.equal(validatePlan({ ...WEB, canvas: { w } }).ok, true, `canvas.w ${w}`);
  assert.match(errs({ ...WEB, canvas: { w: 1440.5 } }), /canvas\.w/);
  assert.equal(validatePlan({ ...WEB, sections: [sec('a', { estHeight: 20000, brief: 'x'.repeat(4000) })] }).ok, true);
  assert.match(errs({ ...WEB, sections: [sec('a', { brief: 'x'.repeat(4001) })] }), /brief/);
  assert.equal(validatePlan({ ...FILM, sections: [{ ...FILM.sections[0], duration: 600 }] }).ok, true);
  assert.equal(validatePlan({ ...WEB, sections: [sec('a', { band: '  Hero ' })] }).plan.sections[0].band, 'Hero', 'band is kept trimmed');
  assert.match(errs({ ...WEB, title: '   ' }), /title/, 'blank text is empty');
  assert.match(errs({ ...WEB, sections: [sec('a', { parts: 'html' })] }), /parts must be an array/);
  const plan = { ...WEB, sections: [sec('hero'), sec('pricing')] };
  const r = (o) => validateRound({ v: 1, summary: 's', ...o }, { plan });
  assert.match(r({ touch: [{ id: 'hero', brief: '' }] }).errors.join(), /touch "hero": brief/);
  const kept = r({ add: [{ id: 'one', job: 'One', brief: 'b', parts: ['html'], after: 'hero' }, { id: 'two', job: 'Two', brief: 'b', parts: ['html'] }] }).round.add;
  assert.deepEqual(kept.map((a) => a.after), ['hero', undefined]);
  assert.equal('after' in kept[1], false, 'an absent after stays absent');
  assert.deepEqual(r({ extra: 1, touch: [{ id: 'hero', brief: 'b', x: 1 }], remove: ['pricing'] }).round,
    { v: 1, summary: 's', touch: [{ id: 'hero', brief: 'b' }], add: [], remove: ['pricing'] }, 'unknown round keys drop');
  const add = { id: 'one', job: 'One', brief: 'b', parts: ['html'] };
  assert.match(r({ add: [{ ...add, id: 'two', after: 'one' }, { ...add, after: 'hero' }] }).errors.join(), /after "one"/, 'after may not name a later add');
  assert.match(r({ add: [{ ...add, after: 'one' }] }).errors.join(), /after "one"/, 'nor the add itself');
  assert.match(r({ touch: [{ id: 'hero', brief: 'a' }, { id: 'hero', brief: 'b' }] }).errors.join(), /duplicate section id "hero"/);
  assert.match(r({ remove: ['hero', 'hero'] }).errors.join(), /duplicate section id "hero"/);
  assert.match(r({ v: 2 }).errors.join(), /v must be 1/);
  assert.match(validateIntegration({ v: 2 }, { plan }).errors.join(), /v must be 1/);
  assert.match(validateIntegration({ v: 1, rework: [{ id: 'hero', why: 'x'.repeat(1001) }] }, { plan }).errors.join(), /why/);
  assert.deepEqual(validateIntegration({ v: 1, done: false, extra: 1, rework: [{ id: 'hero', why: 'x', y: 1 }] }, { plan }).integration,
    { v: 1, done: false, rework: [{ id: 'hero', why: 'x' }] }, 'done is kept when given, unknown keys drop');
  assert.equal('done' in validateIntegration({ v: 1 }, { plan }).integration, false, 'absent done stays absent');
  for (const opts of [undefined, null, {}, { plan: { sections: 'x' } }]) {
    assert.equal(validateRound({ v: 1, summary: 's' }, opts).ok, false, 'no plan to check against');
    assert.equal(validateIntegration({ v: 1 }, opts).ok, false, 'no plan to check against');
  }
});

const DOC = { v: 1, kind: 'document', title: 'Q3 platform review', page: 'A4', notes: 'n', sections: [sec('summary', { estHeight: 900 }), sec('findings')] };

test('a document plan: worca sets the canvas from the page, toc and numbered default, the other kinds keep their keys', () => {
  const a4 = validatePlan(DOC, { kind: 'document' });
  assert.equal(a4.ok, true, a4.errors.join());
  assert.deepEqual(a4.plan.canvas, { w: 794 });
  assert.deepEqual([a4.plan.page, a4.plan.toc, a4.plan.numbered], ['A4', true, false]);
  assert.deepEqual(Object.keys(a4.plan), ['v', 'kind', 'title', 'canvas', 'page', 'toc', 'numbered', 'notes', 'sections']);
  assert.deepEqual(a4.plan.sections.map((s) => s.estHeight), [900, 600]);
  const letter = validatePlan({ ...DOC, page: 'Letter', toc: false, numbered: true });
  assert.deepEqual([letter.plan.canvas, letter.plan.toc, letter.plan.numbered], [{ w: 816 }, false, true]);
  assert.deepEqual(validatePlan({ ...DOC, canvas: { w: 1920, h: 1080 } }).plan.canvas, { w: 794 }, 'a canvas the lead writes is ignored');
  assert.deepEqual(Object.keys(validatePlan(WEB).plan), ['v', 'kind', 'title', 'canvas', 'notes', 'sections']);
  assert.deepEqual(Object.keys(validatePlan(DECK).plan), ['v', 'kind', 'title', 'canvas', 'notes', 'sections']);
  assert.equal('page' in validatePlan({ ...WEB, page: 'A4', toc: true }).plan, false, 'a web plan drops the document keys');
});

test('a document plan: page, toc, numbered, parts and estHeight each give their exact error', () => {
  const errs = (p) => validatePlan(p).errors;
  const { page: _page, ...noPage } = DOC;
  assert.deepEqual(errs(noPage), ['page must be "A4" or "Letter"']);
  for (const page of ['a4', 'Legal', 4, null]) assert.deepEqual(errs({ ...DOC, page }), ['page must be "A4" or "Letter"'], String(page));
  assert.deepEqual(errs({ ...DOC, toc: 'yes' }), ['toc must be true or false']);
  assert.deepEqual(errs({ ...DOC, numbered: 1 }), ['numbered must be true or false']);
  assert.deepEqual(errs({ ...DOC, sections: [sec('intro', { parts: ['html', 'css', 'js'] })] }),
    ['section "intro": a document runs no script, so parts are html and css']);
  assert.match(errs({ ...DOC, sections: [sec('intro', { estHeight: undefined })] }).join(), /^section "intro": estHeight must be/);
});

test('a document round: an add defaults estHeight, refuses js, and the applied plan keeps page, toc and numbered', () => {
  const plan = validatePlan({ ...DOC, numbered: true }).plan;
  const add = { id: 'risks', job: 'Risks', brief: 'b', parts: ['html', 'css'], after: 'summary' };
  const r = validateRound({ v: 1, summary: 's', add: [add] }, { plan });
  assert.equal(r.ok, true, r.errors.join());
  assert.equal(r.round.add[0].estHeight, DEFAULT_EST_HEIGHT);
  assert.deepEqual(validateRound({ v: 1, summary: 's', add: [{ ...add, parts: ['html', 'js'] }] }, { plan }).errors,
    ['add "risks": a document runs no script, so parts are html and css']);
  const applied = applyRound({ plan, round: r.round, shellHtml: '<main><!--worca:sections--></main>' });
  const again = validatePlan(applied.plan, { kind: 'document' });
  assert.equal(again.ok, true, again.errors.join());
  assert.deepEqual([again.plan.page, again.plan.toc, again.plan.numbered, again.plan.canvas], ['A4', true, true, { w: 794 }]);
  assert.deepEqual(again.plan.sections.map((s) => s.id), ['summary', 'risks', 'findings']);
});
test('a video section keeps say, folded; other kinds drop it', () => {
  const video = (say) => ({ v: 1, kind: 'video', title: 'T', canvas: { w: 1920, h: 1080, fps: 60 }, notes: '', sections: [{ id: 'open', job: 'Open', brief: 'b', parts: ['html'], duration: 4, ...(say === undefined ? {} : { say }) }] });
  assert.equal(validatePlan(video(' Meet\n worca.  ')).plan.sections[0].say, 'Meet worca.');
  assert.equal('say' in validatePlan(video('   ')).plan.sections[0], false);
  assert.equal('say' in validatePlan(video(undefined)).plan.sections[0], false);
  assert.deepEqual(validatePlan(video('x'.repeat(1501))).errors, ['section "open": say must be text of at most 1500 characters']);
  assert.deepEqual(validatePlan(video(7)).errors, ['section "open": say must be text of at most 1500 characters']);
  const web = { v: 1, kind: 'web', title: 'T', canvas: { w: 1280 }, notes: '', sections: [{ id: 'hero', job: 'Hero', brief: 'b', parts: ['html'], estHeight: 300, say: 'x' }] };
  assert.equal('say' in validatePlan(web).plan.sections[0], false);
});
test('a round touch may change or remove the words; an add may carry them', () => {
  const plan = validatePlan({ v: 1, kind: 'video', title: 'T', canvas: { w: 1920, h: 1080, fps: 60 }, notes: '', sections: [
    { id: 'open', job: 'Open', brief: 'b', parts: ['html'], duration: 4, say: 'A.' }, { id: 'close', job: 'Close', brief: 'b', parts: ['html'], duration: 4 }] }).plan;
  const r = validateRound({ v: 1, summary: 's', touch: [{ id: 'open', brief: 'b', say: '' }, { id: 'close', brief: 'b', say: ' New  words. ' }],
    add: [{ id: 'mid', job: 'Mid', brief: 'b', parts: ['html'], duration: 3, say: 'Added.', after: 'open' }], remove: [] }, { plan });
  assert.deepEqual(r.round.touch, [{ id: 'open', brief: 'b', say: '' }, { id: 'close', brief: 'b', say: 'New words.' }]);
  assert.equal(r.round.add[0].say, 'Added.');
  const out = applyRound({ plan, round: r.round, shellHtml: '' }).plan;
  assert.deepEqual(out.sections.map((s) => [s.id, s.say]), [['open', undefined], ['mid', 'Added.'], ['close', 'New words.']]);
  const kept = validateRound({ v: 1, summary: 's', touch: [{ id: 'open', brief: 'b' }], add: [], remove: [] }, { plan }).round;
  assert.deepEqual(kept.touch, [{ id: 'open', brief: 'b' }]);
  assert.equal(applyRound({ plan, round: kept, shellHtml: '' }).plan.sections[0].say, 'A.');
});
test('say: null reads as absent, the bound counts folded text, a touch names itself, other kinds drop a touch\'s say', () => {
  const plan = validatePlan({ v: 1, kind: 'video', title: 'T', canvas: { w: 1920, h: 1080, fps: 60 }, notes: '', sections: [
    { id: 'open', job: 'Open', brief: 'b', parts: ['html'], duration: 4, say: null },
    { id: 'close', job: 'Close', brief: 'b', parts: ['html'], duration: 4, say: `\n${'x'.repeat(MAX_SAY)}  ` }] }).plan;
  assert.equal('say' in plan.sections[0], false);
  assert.equal(plan.sections[1].say, 'x'.repeat(MAX_SAY));
  const frozen = JSON.stringify(plan);
  const r = validateRound({ v: 1, summary: 's', touch: [{ id: 'open', brief: 'b', say: null }, { id: 'close', brief: 'Wave.', say: 'Bye.' }], add: [], remove: [] }, { plan });
  assert.deepEqual(r.round.touch, [{ id: 'open', brief: 'b' }, { id: 'close', brief: 'Wave.', say: 'Bye.' }]);
  assert.deepEqual(applyRound({ plan, round: r.round, shellHtml: '' }).plan.sections[1], { ...plan.sections[1], say: 'Bye.' });
  assert.equal(JSON.stringify(plan), frozen);
  const bad = validateRound({ v: 1, summary: 's', touch: [{ id: 'open', brief: 'b', say: 7 }],
    add: [{ id: 'mid', job: 'Mid', brief: 'b', parts: ['html'], duration: 3, say: 'x'.repeat(MAX_SAY + 1) }], remove: [] }, { plan });
  assert.deepEqual(bad.errors, ['touch "open": say must be text of at most 1500 characters', 'add "mid": say must be text of at most 1500 characters']);
  const web = validatePlan({ v: 1, kind: 'web', title: 'T', canvas: { w: 1280 }, notes: '', sections: [{ id: 'hero', job: 'Hero', brief: 'b', parts: ['html'], estHeight: 300 }] }).plan;
  const w = validateRound({ v: 1, summary: 's', touch: [{ id: 'hero', brief: 'b', say: 7 }], add: [{ id: 'faq', job: 'FAQ', brief: 'b', parts: ['html'], say: 'x' }], remove: [] }, { plan: web });
  assert.deepEqual(w.errors, []);
  assert.deepEqual(w.round.touch, [{ id: 'hero', brief: 'b' }]);
  assert.equal('say' in w.round.add[0], false);
});
