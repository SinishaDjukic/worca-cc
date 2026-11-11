// test/design-mock-engine.test.mjs
// The mock Design roles (plan Task 7): design-lead, design-builder and design-integrate, picked from the system
// prompt only, write real files and stream the raw frames the normalizer turns into toolInput, tool and toolResult.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { runClaude } from '../src/core/claude-runner.mjs';
import { isNormalized } from '../src/core/engines/events.mjs';
import { MOCK_WRITER_ROLES } from '../src/core/engines/mock.mjs';
import { _testing as mockDesignTesting, mockDesignPaceMs } from '../src/core/engines/mock-design.mjs';
import { validatePlan, validateRound, validateIntegration } from '../src/core/design/plan.mjs';
import { lintDesign } from '../src/core/design/assemble.mjs';
import { leadPlanPrompt } from '../src/core/design/prompts.mjs';

const scratch = [];
const mkdtemp = () => { const d = mkdtempSync(join(tmpdir(), 'dmock-')); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });
beforeEach(() => mockDesignTesting.reset());

const run = (role, cwd, prompt, extra = {}) => { const ev = []; return runClaude({ mock: true, cwd, systemPrompt: `MOCK_ROLE: ${role}`, prompt, onEvent: (e) => ev.push(e), ...extra }).then((r) => ({ r, ev })); };

test('design-lead writes the shared files and a plan, streaming the tool input', async () => {
  const w = mkdtemp();
  const { ev } = await run('design-lead', w, 'MOCK_SECTIONS=2 MOCK_BANDS');
  const plan = JSON.parse(readFileSync(join(w, 'plan.json'), 'utf8'));
  assert.deepEqual(plan.sections.map((s) => [s.id, s.band]), [['hero', 'Top'], ['features', 'Top']]);
  for (const f of ['tokens.css', 'global.css', 'shell.html']) assert.ok(existsSync(join(w, f)), f);
  const types = new Set(ev.map((e) => e.type));
  for (const t of ['session', 'usage', 'toolInput', 'tool', 'toolResult', 'result']) assert.ok(types.has(t), t);
  assert.ok(ev.every(isNormalized));
  const write = ev.find((e) => e.type === 'tool' && e.calls[0].input.file_path.endsWith('tokens.css')).calls[0];
  const joined = ev.filter((e) => e.type === 'toolInput' && e.toolUseId === write.toolUseId && e.phase === 'delta').map((e) => e.partialJson).join('');
  assert.deepEqual(JSON.parse(joined), write.input);
  assert.ok(isAbsolute(write.input.file_path));
});
test('design-builder writes its section, reads its orders from the plan, ends with one line', async () => {
  const w = mkdtemp();
  await run('design-lead', w, 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=none');
  const s = join(w, 'sections', 'hero'); mkdirSync(s, { recursive: true });
  const { r, ev } = await run('design-builder', s, 'Section: hero');
  assert.match(readFileSync(join(s, 'index.html'), 'utf8'), /^<section data-section="hero">/);
  assert.equal(r.text, 'Built hero.');
  assert.equal(ev.find((e) => e.type === 'result').costUsd, 0);
});
test('a Change: prompt reads and edits', async () => {
  const w = mkdtemp();
  await run('design-lead', w, 'MOCK_SECTIONS=1');
  const s = join(w, 'sections', 'hero'); mkdirSync(s, { recursive: true });
  await run('design-builder', s, 'Section: hero');
  const { ev } = await run('design-builder', s, 'Change: Bolder');
  assert.deepEqual(ev.filter((e) => e.type === 'tool').map((e) => e.calls[0].name), ['Read', 'Edit']);
  assert.match(readFileSync(join(s, 'index.html'), 'utf8'), /Changed hero\./);
});
test('a Change round: prompt writes round.json at the named path', async () => {
  const w = mkdtemp();
  await run('design-lead', w, 'MOCK_SECTIONS=2');
  await run('design-lead', w, `Change round: MOCK_ROUND_ADD=faq:hero MOCK_ROUND_REMOVE=features\nRound file: ${join(w, 'round.json')}`);
  const r = JSON.parse(readFileSync(join(w, 'round.json'), 'utf8'));
  assert.deepEqual([r.touch[0].id, r.add[0].id, r.add[0].after, r.remove], ['hero', 'faq', 'hero', ['features']]);
});
test('MOCK_HANG stops on abort as the real CLI does, with priced usage seen', async () => {
  const w = mkdtemp();
  await run('design-lead', w, 'MOCK_SECTIONS=1 MOCK_HANG_SECTION=hero MOCK_PRICED');
  const s = join(w, 'sections', 'hero'); mkdirSync(s, { recursive: true });
  const ac = new AbortController(); const ev = [];
  const p = runClaude({ mock: true, cwd: s, systemPrompt: 'MOCK_ROLE: design-builder', prompt: 'Section: hero', signal: ac.signal, onEvent: (e) => { ev.push(e); if (e.type === 'toolInput' && e.phase === 'delta') ac.abort(); } });
  await assert.rejects(p, { name: 'AbortError' });
  assert.equal(existsSync(join(s, 'index.html')), false);
  assert.deepEqual(ev.find((e) => e.type === 'usage').usage, { input_tokens: 1000, output_tokens: 4 });
});
test('MOCK_COST is a running total across a resume', async () => {
  const w = mkdtemp();
  const a = await run('design-lead', w, 'MOCK_SECTIONS=1 MOCK_COST=0.25');
  const sid = a.ev.find((e) => e.type === 'session').sessionId;
  assert.equal(a.ev.find((e) => e.type === 'result').costUsd, 0.25);
  const b = await run('design-integrate', w, 'Lint report: none', { resumeSessionId: sid });
  assert.equal(b.ev.find((e) => e.type === 'result').costUsd, 0.5);
});
test('a lost session answers like the CLI', async () => {
  const w = mkdtemp();
  mockDesignTesting.lost.add('gone');
  await assert.rejects(run('design-lead', w, 'x', { resumeSessionId: 'gone' }), /No conversation found/);
});
test('a chat message cannot pick a design role: the marker counts only in the system prompt', async () => {
  const w = mkdtemp();
  await runClaude({ mock: true, cwd: w, systemPrompt: '', prompt: 'MOCK_ROLE: design-lead' });
  assert.equal(existsSync(join(w, 'plan.json')), false);
});
test('design roles stay out of the writer roles', () => {
  for (const r of ['design-lead', 'design-builder', 'design-integrate']) assert.equal(MOCK_WRITER_ROLES.has(r), false);
});
test('what the mock writes passes P1: plan, lint, round and integration', async () => {
  const w = mkdtemp();
  await run('design-lead', w, `MOCK_SECTIONS=2 MOCK_SHELL_SLOTS MOCK_REWORK=hero\nKind: web\nPlan file: ${join(w, 'plan.json')}`);
  const v = validatePlan(readFileSync(join(w, 'plan.json'), 'utf8'), { kind: 'web' });
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.match(readFileSync(join(w, 'shell.html'), 'utf8'), /<main class="grid"><div data-worca-slot="hero"><\/div><div data-worca-slot="features"><\/div><!--worca:sections-->/);
  for (const { id } of v.plan.sections) { const s = join(w, 'sections', id); mkdirSync(s, { recursive: true }); await run('design-builder', s, `Section: ${id}`); }
  assert.deepEqual(lintDesign({ workDir: w, plan: v.plan }).findings.filter((f) => f.severity === 'error'), []);
  await run('design-integrate', w, `Lint report: none\nIntegration file: ${join(w, 'integration.json')}`);
  const i = validateIntegration(readFileSync(join(w, 'integration.json'), 'utf8'), { plan: v.plan });
  assert.deepEqual([i.ok, i.integration?.rework.map((x) => x.id)], [true, ['hero']]);
  await run('design-lead', w, `Change round: MOCK_ROUND_ADD=faq:hero MOCK_ROUND_REMOVE=features\nRound file: ${join(w, 'round.json')}`);
  assert.equal(validateRound(readFileSync(join(w, 'round.json'), 'utf8'), { plan: v.plan }).ok, true);
});
test('a resume names no token or question file, so the session keeps them: MOCK_BAD_PLAN heals, the _ALWAYS forms stay', async () => {
  const lead = async (tokens) => {
    const w = mkdtemp();
    const first = await run('design-lead', w, `MOCK_SECTIONS=2 ${tokens}`);
    const resumeSessionId = first.ev.find((e) => e.type === 'session').sessionId;
    return { w, again: (prompt) => run('design-lead', w, prompt, { resumeSessionId }) };
  };
  const planOk = (w) => validatePlan(readFileSync(join(w, 'plan.json'), 'utf8'), { kind: 'web' }).ok;
  const once = await lead('MOCK_BAD_PLAN');
  assert.equal(planOk(once.w), false);
  await once.again('Fix these and write plan.json again.');
  assert.deepEqual([planOk(once.w), JSON.parse(readFileSync(join(once.w, 'plan.json'), 'utf8')).sections.length], [true, 2]);
  const always = await lead('MOCK_BAD_PLAN_ALWAYS');
  await always.again('Fix these and write plan.json again.');
  assert.equal(planOk(always.w), false);
  const round = await lead('');
  const plan = readFileSync(join(round.w, 'plan.json'), 'utf8');
  const rf = join(round.w, 'round.json');
  const bad = await run('design-lead', round.w, `Change round: MOCK_BAD_ROUND\nRound file: ${rf}`);
  await run('design-lead', round.w, 'Fix these and write round.json again.', { resumeSessionId: bad.ev.find((e) => e.type === 'session').sessionId });
  assert.equal(validateRound(readFileSync(rf, 'utf8'), { plan: JSON.parse(plan) }).ok, false);
  assert.equal(readFileSync(join(round.w, 'plan.json'), 'utf8'), plan, 'a round fix never rewrites plan.json');
  const ask = await lead('MOCK_ASK_ALWAYS_SECTION=hero');
  const s = join(ask.w, 'sections', 'hero'); mkdirSync(s, { recursive: true });
  const q = join(ask.w, '.asks', 'a_11111111.json');
  const asked = await run('design-builder', s, `Section: hero\nQuestion file: ${q}`);
  rmSync(q);
  const answered = await run('design-builder', s, 'Answers: Calm', { resumeSessionId: asked.ev.find((e) => e.type === 'session').sessionId });
  assert.deepEqual([existsSync(q), answered.r.text, existsSync(join(s, 'index.html'))], [true, 'Asked a question.', false]);
});
test('a once token fires in the first process of a folder only, a fresh start included', async () => {
  const w = mkdtemp();
  await run('design-lead', w, 'MOCK_SECTIONS=1 MOCK_FAIL_SECTION=hero');
  const s = join(w, 'sections', 'hero'); mkdirSync(s, { recursive: true });
  await assert.rejects(run('design-builder', s, 'Section: hero'), /mock failure/);
  assert.equal((await run('design-builder', s, 'Section: hero')).r.text, 'Built hero.', 'no resumeSessionId, still not the first process');
});
test('failures answer like the CLI: MOCK_FAIL and a lost session send an error result, a limit carries its errorClass, each once per section folder', async () => {
  const w = mkdtemp();
  await run('design-lead', w, 'MOCK_SECTIONS=4 MOCK_FAIL_SECTION=hero MOCK_FAIL_SECTION=features MOCK_RATE_LIMIT_SECTION=pricing MOCK_USAGE_LIMIT_SECTION=faq');
  const dirs = {};
  for (const id of ['hero', 'features', 'pricing', 'faq']) { dirs[id] = join(w, 'sections', id); mkdirSync(dirs[id], { recursive: true }); }
  for (const id of ['hero', 'features']) {
    const ev = [];
    await assert.rejects(runClaude({ mock: true, cwd: dirs[id], systemPrompt: 'MOCK_ROLE: design-builder', prompt: `Section: ${id}`, onEvent: (e) => ev.push(e) }), { message: 'claude exited with code 1: mock failure' });
    assert.deepEqual(ev.filter((e) => e.type === 'result').map((e) => [e.isError, e.subtype]), [[true, 'error_during_execution']], id);
  }
  await assert.rejects(run('design-builder', dirs.pricing, 'Section: pricing'), { errorClass: 'rate_limit' });
  await assert.rejects(run('design-builder', dirs.faq, 'Section: faq'), { errorClass: 'usage_limit' });
  for (const id of Object.keys(dirs)) assert.equal((await run('design-builder', dirs[id], `Section: ${id}`)).r.text, `Built ${id}.`, id);
  mockDesignTesting.lost.add('gone');
  const ev = [];
  await assert.rejects(runClaude({ mock: true, cwd: dirs.hero, systemPrompt: 'MOCK_ROLE: design-builder', prompt: 'Continue your task.', resumeSessionId: 'gone', onEvent: (e) => ev.push(e) }), { message: 'claude exited with code 1: No conversation found with session ID: gone' });
  assert.deepEqual(ev.map((e) => [e.type, e.isError, e.subtype, e.costUsd]), [['result', true, 'error_during_execution', 0]]);
  const ac = new AbortController();
  await assert.rejects(runClaude({ mock: true, cwd: dirs.hero, systemPrompt: 'MOCK_ROLE: design-builder', prompt: 'Continue your task.', resumeSessionId: 'gone', signal: ac.signal, onEvent: (e) => { if (e.type === 'result') ac.abort(); } }), { name: 'AbortError' }, 'an abort inside the lost-session result wins, as after every emit');
});
test('a once token keeps one record per folder and token, and reset() forgets them', async () => {
  const w = mkdtemp(); const q = join(w, '.asks', 'a_55555555.json');
  await run('design-lead', w, 'MOCK_BAD_PLAN MOCK_SECTIONS=1');
  assert.equal((await run('design-lead', w, `MOCK_ASK_LEAD MOCK_SECTIONS=1\nQuestion file: ${q}`)).r.text, 'Asked a question.', 'another token is still unseen in this folder');
  mockDesignTesting.reset();
  await run('design-lead', w, 'MOCK_BAD_PLAN MOCK_SECTIONS=1');
  assert.equal(validatePlan(readFileSync(join(w, 'plan.json'), 'utf8'), { kind: 'web' }).ok, false, 'after reset() the folder sees MOCK_BAD_PLAN for the first time again');
});
test('the ask arm comes first, and the writer-switch audit still reads the real switch', async () => {
  const w = mkdtemp();
  await run('design-lead', w, 'MOCK_SECTIONS=1', { permissionMode: 'dontAsk' });
  assert.equal(existsSync(join(w, 'plan.json')), false, 'a dontAsk (chat) spawn takes the ask arm, a design role or not');
  const src = readFileSync(new URL('../src/core/engines/mock.mjs', import.meta.url), 'utf8');
  assert.equal(src.split('switch (role) {').length - 1, 1, 'mock-graph.test.mjs reads the case arms after the first `switch (role) {`');
});
test('the hang tokens show life, then wait for the abort: MOCK_HANG_LEAD in every process, MOCK_HANG once per folder', async () => {
  const within = (p) => { let t; return Promise.race([p, new Promise((_, no) => { t = setTimeout(() => no(new Error('no wait reached')), 5000); })]).finally(() => clearTimeout(t)); };
  const hang = async (role, cwd, prompt) => {
    const ac = new AbortController(); const types = [];
    const p = runClaude({ mock: true, cwd, systemPrompt: `MOCK_ROLE: ${role}`, prompt, signal: ac.signal, onEvent: (e) => { types.push(e.type); if (e.type === 'usage' && e.phase === 'delta' && e.usage?.input_tokens === 1000) ac.abort(); } });
    try { await assert.rejects(within(p), { name: 'AbortError' }); } finally { ac.abort(); }
    return types;
  };
  const w = mkdtemp();
  for (let i = 0; i < 2; i += 1) {
    const types = await hang('design-lead', w, 'MOCK_HANG_LEAD MOCK_SECTIONS=1');
    assert.deepEqual([types[0], types.includes('toolInput'), existsSync(join(w, 'tokens.css')), existsSync(join(w, 'plan.json'))], ['session', true, false, false]);
  }
  const v = mkdtemp();
  await run('design-lead', v, 'MOCK_SECTIONS=2 MOCK_HANG_SECTION=hero');
  const s = join(v, 'sections', 'hero'); mkdirSync(s, { recursive: true });
  await hang('design-builder', s, 'Section: hero');
  assert.equal(existsSync(join(s, 'index.html')), false);
  assert.equal((await within(run('design-builder', s, 'Section: hero'))).r.text, 'Built hero.', 'a fresh start in the same folder does not hang again');
  const f = join(v, 'sections', 'features'); mkdirSync(f, { recursive: true });
  const ac = new AbortController();
  await assert.rejects(runClaude({ mock: true, cwd: f, systemPrompt: 'MOCK_ROLE: design-builder', prompt: 'Section: features', signal: ac.signal, onEvent: (e) => { if (e.type === 'toolInput' && e.phase === 'delta') ac.abort(); } }), { name: 'AbortError' });
  assert.equal(existsSync(join(f, 'index.html')), false, 'an abort inside an ordinary Write stops before the file lands');
});
test('cost tokens reach every agent through the brief: MOCK_COST and MOCK_PRICED, while MOCK_NO_COST omits the figure', async () => {
  const agents = async (tokens) => {
    const w = mkdtemp();
    const lead = await run('design-lead', w, `MOCK_SECTIONS=1 ${tokens}`);
    const s = join(w, 'sections', 'hero'); mkdirSync(s, { recursive: true });
    const builder = await run('design-builder', s, 'Section: hero');
    return [lead, builder].map(({ ev }) => [ev.find((e) => e.type === 'session').model, ev.find((e) => e.type === 'result').costUsd]);
  };
  assert.deepEqual(await agents('MOCK_COST=0.25 MOCK_PRICED'), [['claude-sonnet-5-5', 0.25], ['claude-sonnet-5-5', 0.25]]);
  assert.deepEqual(await agents('MOCK_NO_COST'), [['mock', undefined], ['mock', undefined]]);
});
test('the other builder tokens: MOCK_TOOL_ERROR refuses one Write, MOCK_ASK asks once per folder, a Rework: prompt reads and edits', async () => {
  const w = mkdtemp();
  await run('design-lead', w, 'MOCK_SECTIONS=2 MOCK_TOOL_ERROR_SECTION=hero MOCK_ASK_SECTION=features');
  const hero = join(w, 'sections', 'hero'); const features = join(w, 'sections', 'features');
  for (const s of [hero, features]) mkdirSync(s, { recursive: true });
  const built = await run('design-builder', hero, 'Section: hero');
  assert.deepEqual(built.ev.filter((e) => e.type === 'toolResult').map((e) => e.results[0].isError), [true, false, false]);
  assert.match(readFileSync(join(hero, 'index.html'), 'utf8'), /Mock hero\./);
  const rework = await run('design-builder', hero, 'Rework: the title is too small', { resumeSessionId: built.ev.find((e) => e.type === 'session').sessionId });
  assert.deepEqual([rework.ev.filter((e) => e.type === 'tool').map((e) => e.calls[0].name), rework.r.text], [['Read', 'Edit'], 'Changed hero.']);
  assert.match(readFileSync(join(hero, 'index.html'), 'utf8'), /Changed hero\./);
  const q = join(w, '.asks', 'a_22222222.json');
  const asked = await run('design-builder', features, `Section: features\nQuestion file: ${q}`);
  assert.deepEqual([asked.r.text, existsSync(q), existsSync(join(features, 'index.html'))], ['Asked a question.', true, false]);
  assert.equal((await run('design-builder', features, `Section: features\nQuestion file: ${q}`)).r.text, 'Built features.');
});
test('the other lead tokens: ids past eight, the Kind: line, bands on the first two, MOCK_FAIL_LEAD, MOCK_ASK_LEAD once, the named round and integration files, a brief line never makes a round', async () => {
  const w = mkdtemp();
  await run('design-lead', w, 'MOCK_SECTIONS=10 MOCK_BANDS\nKind: presentation');
  const plan = JSON.parse(readFileSync(join(w, 'plan.json'), 'utf8'));
  assert.deepEqual([plan.kind, plan.sections.map((s) => s.id).slice(7), plan.sections.filter((s) => s.band).map((s) => s.id)], ['presentation', ['footer', 's9', 's10'], ['hero', 'features']]);
  const rf = join(w, 'rounds', 'round-2.json'); const inf = join(w, 'checks', 'integration.json');
  await run('design-lead', w, `Change round: make it calm\nRound file: ${rf}`);
  await run('design-integrate', w, `Lint report: none\nIntegration file: ${inf}`);
  assert.deepEqual([existsSync(rf), existsSync(join(w, 'round.json')), existsSync(inf), existsSync(join(w, 'integration.json'))], [true, false, true, false]);
  const b = mkdtemp();
  const briefed = await run('design-lead', b, leadPlanPrompt({ brief: 'A calm page.\nChange round: not one', questionFile: join(b, '.asks', 'a_44444444.json'), planFile: join(b, 'plan.json') }));
  assert.deepEqual([briefed.r.text, existsSync(join(b, 'plan.json')), existsSync(join(b, 'round.json'))], ['Planned 3 sections.', true, false], 'only a prompt that starts with Change round: is a round');
  const f = mkdtemp();
  await assert.rejects(run('design-lead', f, 'MOCK_FAIL_LEAD MOCK_SECTIONS=1'), /mock failure/);
  assert.equal(existsSync(join(f, 'plan.json')), false);
  const a = mkdtemp(); const q = join(a, '.asks', 'a_33333333.json');
  const asked = await run('design-lead', a, `MOCK_ASK_LEAD MOCK_SECTIONS=1\nPlan file: ${join(a, 'plan.json')}\nQuestion file: ${q}`);
  assert.deepEqual([asked.r.text, existsSync(q), existsSync(join(a, 'plan.json'))], ['Asked a question.', true, false]);
  await run('design-lead', a, 'Answers to your questions: Calm', { resumeSessionId: asked.ev.find((e) => e.type === 'session').sessionId });
  assert.equal(JSON.parse(readFileSync(join(a, 'plan.json'), 'utf8')).sections.length, 1);
});
test('a Write streams like the CLI: an empty first delta, then 37-character slices, output usage a quarter of the content; the pace is read per call, 0 to 5000 ms', async () => {
  const w = mkdtemp();
  const { ev } = await run('design-lead', w, 'MOCK_SECTIONS=1');
  const tool = ev.find((e) => e.type === 'tool' && e.calls[0].input.file_path.endsWith('shell.html'));
  const parts = ev.filter((e) => e.type === 'toolInput' && e.toolUseId === tool.calls[0].toolUseId && e.phase === 'delta').map((e) => e.partialJson);
  assert.deepEqual([parts[0], parts.length > 3, parts.slice(1, -1).every((p) => p.length === 37), parts.at(-1).length <= 37], ['', true, true, true]);
  const end = ev.find((e) => e.type === 'usage' && e.phase === 'delta' && e.messageId === tool.messageId);
  assert.equal(end.usage.output_tokens, Math.ceil(tool.calls[0].input.content.length / 4));
  const saved = process.env.WORCA_MOCK_DESIGN_MS;
  const pace = (v) => { if (v === undefined) delete process.env.WORCA_MOCK_DESIGN_MS; else process.env.WORCA_MOCK_DESIGN_MS = v; return mockDesignPaceMs(); };
  try {
    assert.deepEqual(['5', '0', '5000', '5001', '-1', 'soon', undefined].map(pace), [5, 0, 5000, 0, 0, 0, 0]);
  } finally {
    if (saved === undefined) delete process.env.WORCA_MOCK_DESIGN_MS; else process.env.WORCA_MOCK_DESIGN_MS = saved;
  }
});

test('a document lead writes brand.md with a Look source line, a page and a toc, and worca\'s font in tokens.css', async () => {
  const { readLookSource } = await import('../src/core/design/look-source.mjs');
  const w = mkdtemp();
  await run('design-lead', w, 'Kind: document\nMOCK_SECTIONS=2');
  const brand = readFileSync(join(w, 'brand.md'), 'utf8');
  assert.equal(brand.split('\n')[0], 'Look source: worca — mock');
  assert.deepEqual(readLookSource(brand), { ok: true, source: 'worca', why: 'mock' });
  const v = validatePlan(readFileSync(join(w, 'plan.json'), 'utf8'), { kind: 'document' });
  assert.equal(v.ok, true, v.errors.join());
  assert.deepEqual([v.plan.page, v.plan.toc], ['A4', true]);
  assert.ok(readFileSync(join(w, 'tokens.css'), 'utf8').includes('url(assets/worca/poppins-latin-400-normal.woff2)'));
  const s = join(w, 'sections', 'hero'); mkdirSync(s, { recursive: true });
  await run('design-builder', s, 'Section: hero');
  assert.match(readFileSync(join(s, 'index.html'), 'utf8'), /^<section data-section="hero"><h2 id="hero-title"/);
  const brief = mkdtemp();
  await run('design-lead', brief, 'Kind: document\nMOCK_LOOK=brief');
  assert.equal(readLookSource(readFileSync(join(brief, 'brand.md'), 'utf8')).source, 'brief');
  const bad = mkdtemp();
  await run('design-lead', bad, 'Kind: document\nMOCK_BAD_BRAND');
  assert.equal(readLookSource(readFileSync(join(bad, 'brand.md'), 'utf8')).ok, false);
  const web = mkdtemp();
  await run('design-lead', web, 'MOCK_SECTIONS=1');
  assert.equal(existsSync(join(web, 'brand.md')), false, 'a web lead writes no brand.md');
});
