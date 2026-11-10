// test/ask-design-tools.test.mjs — the Design chat (P5 Task 4): its tool allowlist, the design kit (design-deps.mjs), its system prompt and labels.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createAskTools } from '../src/core/ask/tools.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { defaultDesignDeps, designPromptBlock } from '../src/core/ask/design-deps.mjs';
import { defaultComposerDeps } from '../src/core/ask/composer-deps.mjs';
import { buildDesignSystemPrompt, DESIGN_SYSTEM_RULES } from '../src/core/ask/prompt.mjs';
import { labelForTool } from '../src/core/ask/events.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addAttachment, appendMessage, createThread, getThread } from '../src/core/ask/store.mjs';
import { createBuild, createDesign, updateBuild, updateDesign } from '../src/core/design/store.mjs';
import { designWorkDir } from '../src/core/design/paths.mjs';
import { createAskToolServer } from '../src/core/ask/mcp-stdio.mjs';
import { chatDescriptor } from '../src/core/engines/chat.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after, 'worca-design-tools-');   // the real-io row writes a design, a thread and a plan

const D = { id: 'd_0123456789ab', title: 'ShipRadar', kind: 'web', status: 'empty', version: 0, fast: false, projectKey: null };
const PLAN = { sections: [{ id: 'hero', job: 'Hero', parts: ['html', 'css'] }, { id: 'pricing', job: 'Pricing', parts: ['html'] }] };
const io = (over = {}) => ({ getThread: () => ({ id: 'ask_00000001', mode: 'design', composer: null }), designIdForThread: () => D.id, getDesign: () => D,
  readPlan: () => null, latestBuild: () => null, listAttachments: () => [], projectPath: async () => null, workDir: () => '/h/design/x/work', ...over });
const tools = (over, more = {}) => createAskTools({ limits: ASK_LIMITS, redact: (s) => s, askMode: 'design', ...more, ...defaultDesignDeps({ threadId: 'ask_00000001', io: io(over) }) });

test('a design chat lists only its allowlist and refuses everything else', async () => {
  const web = { allowedDomains: ['example.com'], search: { provider: 'x' } };
  const names = tools({}, { web }).list().map((d) => d.name).sort();
  assert.deepEqual(names, ['change_design', 'design_questions', 'get_design', 'list_projects', 'read_attachment', 'start_design_build', 'web_fetch', 'web_search'].sort());
  await assert.rejects(() => tools().call('propose_run', { brief: 'x' }), /propose_run: not available in the Design chat/);
});
test('composer-deps gives a design thread the mode and no composer kit; an unreadable row stays closed', () => {
  assert.deepEqual(defaultComposerDeps({ threadId: 'x', io: { getThread: () => ({ id: 'x', mode: 'design' }) } }), { askMode: 'design' });
  assert.deepEqual(defaultComposerDeps({ threadId: 'x', io: { getThread: () => { throw new Error('db'); } } }), { askMode: 'composer' });
});
test('an Ask chat never sees or calls a design tool', async () => {
  const ask = createAskTools({ limits: ASK_LIMITS, redact: (s) => s });
  assert.equal(ask.list().some((d) => /design/.test(d.name)), false);
  await assert.rejects(() => ask.call('start_design_build', { brief: 'x' }), /start_design_build: only the Design chat/);
});
test('start_design_build: asks the parent to act; refused on a plan or a running build', async () => {
  const r = await tools().call('start_design_build', { brief: 'A landing page' });
  assert.deepEqual(r.requested, { kind: 'design-start', brief: 'A landing page' });
  assert.match(r.note, /never say it started/);
  assert.match(r.note, /Your reply after this call is at most TWO short sentences, 40 words in all \(rule 7\)\.$/, 'the note the model reads last agrees with rule 7');
  await assert.rejects(() => tools().call('start_design_build', { brief: '' }), /start_design_build: brief is required/);
  await assert.rejects(() => tools({ readPlan: () => PLAN }).call('start_design_build', { brief: 'x' }), /already has a plan: use change_design/);
  await assert.rejects(() => tools({ latestBuild: () => ({ id: 'b_1', round: 2, status: 'building' }) }).call('start_design_build', { brief: 'x' }), /a build is running \(round 2\)/);
});
test('change_design: needs a plan, known sections, one build at a time', async () => {
  const on = { readPlan: () => PLAN };
  await assert.rejects(() => tools().call('change_design', { instruction: 'x' }), /nothing built yet: use start_design_build/);
  await assert.rejects(() => tools(on).call('change_design', { instruction: 'x', sections: ['faq'] }), /unknown section "faq"/);
  assert.deepEqual((await tools(on).call('change_design', { instruction: 'x' })).requested, { kind: 'design-change', instruction: 'x', sections: [], needsLead: true });
  assert.deepEqual((await tools(on).call('change_design', { instruction: 'x', sections: ['hero'], needsLead: false })).requested, { kind: 'design-change', instruction: 'x', sections: ['hero'], needsLead: false });
  await assert.rejects(() => tools({ ...on, latestBuild: () => ({ id: 'b_1', round: 3, status: 'paused' }) }).call('change_design', { instruction: 'x' }), /a build is running \(round 3\)/);
});
test('the tools refuse a brief or instruction the engine would refuse: the limit leaves the upload names their room (BRIEF_MAX)', async () => {
  await assert.rejects(() => tools().call('start_design_build', { brief: 'x'.repeat(3401) }), /start_design_build: brief is longer than 3400 characters/);
  assert.equal((await tools().call('start_design_build', { brief: 'x'.repeat(3400) })).ok, true);
  const on = { readPlan: () => PLAN };
  await assert.rejects(() => tools(on).call('change_design', { instruction: 'x'.repeat(3401) }), /change_design: instruction is longer than 3400 characters/);
  assert.equal((await tools(on).call('change_design', { instruction: 'x'.repeat(3400) })).ok, true);
});
test('get_design reads the design, its plan, the running build and the attachments', async () => {
  const r = await tools({ readPlan: () => PLAN, listAttachments: () => [{ id: 'att_1', name: 'logo.png', kind: 'image', bytes: 9, messageId: 'm' }, { id: 'att_2', name: 'x', kind: 'text', bytes: 1, messageId: null }] }).call('get_design', {});
  assert.deepEqual(r.plan.sections.map((s) => s.id), ['hero', 'pricing']);
  assert.deepEqual(r.attachments.map((a) => a.name), ['logo.png']);
  assert.equal(r.paths.work, '/h/design/x/work');
});
test('the system prompt names only tools the chat has; rule 11 is the DATA rule the web section cites', () => {
  const p = buildDesignSystemPrompt({ web: { enabled: true, allowedDomains: ['example.com'], search: null }, engine: 'claude' });
  assert.doesNotMatch(p, /propose_run|propose_workflow|build_workflow|edit_canvas|save_script|propose_web_access|Task/);
  assert.match(p, /rule 11 applies/);
  assert.match(DESIGN_SYSTEM_RULES, /^11\. Each message starts with a \[worca context\]/m);
  assert.match(buildDesignSystemPrompt({ engine: 'codex' }), /plus the worca file tools read_file, grep and glob/);
  assert.doesNotMatch(buildDesignSystemPrompt({ engine: 'claude' }), /## Web access/);
});
// p7t1 live proof (plan Task 15 Step 5, Chat row): Opus 5.5 answered in long paragraphs after a build or change. The
// reply is capped, also on a resumed chat: two short sentences (2026-11-10: one read as silence next to a 13-minute
// build; the chat speaks in sentences, and its tool calls fold away).
test('rule 7 caps the reply after a build tool at two short sentences, on every reply; rule 13 has it say what it looks at', () => {
  const rule = (n) => DESIGN_SYSTEM_RULES.split('\n').find((l) => l.startsWith(`${n}. `)) || '';
  assert.match(rule(7), /Your reply after the call is then at most TWO short sentences, 40 words in all/);
  assert.match(rule(13), /Before your first tool call of a reply, write one short sentence/);
  assert.match(rule(13), /do not name tools, paths or ids/);
  assert.match(rule(5), /`fields` for anything else/);
  assert.match(rule(7), /however long your earlier replies in this chat were/);
  assert.match(rule(7), /never offer a follow-up/);
  assert.equal(rule(10), '10. Never write HTML, CSS or JavaScript into the chat: the page shows the work.');
  assert.doesNotMatch(DESIGN_SYSTEM_RULES, /one or two sentences/);
});
test('labels', () => {
  assert.equal(labelForTool('mcp__worca__get_design', {}), 'Reading the design');
  assert.equal(labelForTool('mcp__worca__start_design_build', {}), 'Starting the build');
  assert.equal(labelForTool('mcp__worca__change_design', {}), 'Starting a change');
  assert.equal(labelForTool('mcp__worca__design_questions', {}), 'Asking you');
});

// Rows beyond the plan's: the guards its cases leave open (questions, a lost design, a finished build, the thread
// check), the block every turn starts with, and the real io the MCP child reads through.
test('design_questions: the card comes back for the parent, checked first; every design tool needs its design and its chat', async () => {
  const q = { heading: 'Tone', questions: [{ id: 'tone', text: 'Which tone?', options: [{ label: 'Plain', value: 'plain' }, { label: 'Playful', value: 'playful', recommended: true }] }] };
  const r = await tools().call('design_questions', q);
  assert.deepEqual([r.ok, r.heading, r.questions.map((x) => x.id)], [true, 'Tone', ['tone']]);
  assert.match(r.note, /END YOUR TURN/);
  await assert.rejects(() => tools().call('design_questions', { questions: [{ ...q.questions[0], options: [q.questions[0].options[0]] }] }), /design_questions: tone: 2 to 6 options/);
  const lost = { getDesign: () => null };
  await assert.rejects(() => tools(lost).call('design_questions', q), /design_questions: this chat has no design/);
  await assert.rejects(() => tools(lost).call('start_design_build', { brief: 'x' }), /start_design_build: this chat has no design/);
  await assert.rejects(() => tools(lost).call('change_design', { instruction: 'x' }), /change_design: this chat has no design/);
  assert.deepEqual(await tools(lost).call('get_design', {}), { ok: false, error: 'this chat has no design' });
  await assert.rejects(() => createAskTools({ limits: ASK_LIMITS, redact: (s) => s, askMode: 'design' }).call('get_design', {}), /get_design: only the Design chat builds a design/);
  let ran = 0;
  const kit = { start: async () => { ran += 1; return { ok: true }; } };
  await assert.rejects(() => createAskTools({ limits: ASK_LIMITS, redact: (s) => s, design: kit }).call('start_design_build', { brief: 'x' }), /start_design_build: only the Design chat builds a design/);
  assert.equal(ran, 0, 'a kit outside a design chat never runs');
});
test('a finished build holds nothing; only a readable design thread gets the kit', async () => {
  const done = { readPlan: () => PLAN, latestBuild: () => ({ id: 'b_1', round: 2, status: 'done' }) };
  assert.equal((await tools(done).call('change_design', { instruction: 'x' })).ok, true);
  assert.equal((await tools(done).call('get_design', {})).build, null);
  assert.equal((await tools({ latestBuild: () => ({ id: 'b_1', round: 1, status: 'error' }) }).call('start_design_build', { brief: 'x' })).ok, true);
  assert.deepEqual((await tools({ latestBuild: () => ({ id: 'b_1', round: 3, kind: 'change', status: 'paused' }) }).call('get_design', {})).build, { id: 'b_1', round: 3, kind: 'change', status: 'paused' });
  for (const getThread of [() => ({ id: 'x' }), () => ({ id: 'x', mode: 'composer' }), () => null, () => { throw new Error('db'); }]) {
    assert.deepEqual(defaultDesignDeps({ threadId: 'x', io: io({ getThread }) }), {});
  }
  assert.deepEqual(defaultDesignDeps({ io: io() }), {});
});
test('designPromptBlock: the design, its sections, the open build only and the pins; a lost design says so', async () => {
  const pin = { id: 'hero', path: 'sections/hero/index.html', tag: 'h1', text: 'Hi', html: '<h1>Hi</h1>' };
  const thread = { id: 'ask_00000001', mode: 'design', composer: { designId: D.id, pins: [pin] } };
  const block = await designPromptBlock(thread, io({ readPlan: () => PLAN, latestBuild: () => ({ id: 'b_1', round: 3, status: 'paused' }) }));
  assert.match(block, /^\[design chat\]\ndesign: d_0123456789ab "ShipRadar"/);
  assert.match(block, /^sections: hero "Hero"; pricing "Pricing"$/m);
  assert.match(block, /^build: b_1 paused \(round 3\)$/m);
  assert.match(block, /^- pin 1: section "hero" tag "h1"/m);
  assert.match(await designPromptBlock(thread, io({ latestBuild: () => ({ id: 'b_1', round: 3, status: 'done' }) })), /^build: none running$/m);
  assert.equal(await designPromptBlock(thread, io({ getDesign: () => null })), '[design chat]\n(this chat has no design)\n[/design chat]');
});
test('the real io: a design thread reads its row, work/plan.json checked by kind, the open build and its message attachments', async () => {
  const d = createDesign({ kind: 'web', title: 'Real', engine: 'claude' }, { by: 'local' });
  const t = createThread({ title: 'Real', mode: 'design' });
  updateDesign(d.id, { threadId: t.id });
  assert.deepEqual(defaultDesignDeps({ threadId: createThread({ title: 'Ask' }).id }), {});
  const live = () => createAskTools({ limits: ASK_LIMITS, redact: (s) => s, ...defaultComposerDeps({ threadId: t.id }), ...defaultDesignDeps({ threadId: t.id }) });
  assert.deepEqual(live().list().map((x) => x.name).sort(), ['change_design', 'design_questions', 'get_design', 'list_projects', 'read_attachment', 'start_design_build']);
  const first = await live().call('get_design', {});
  assert.deepEqual([first.design.id, first.plan, first.build, first.paths.work, first.paths.project], [d.id, null, null, designWorkDir(d.id), null]);
  const web = { v: 1, kind: 'web', title: 'Real', canvas: { w: 1440 }, notes: 'n', sections: [{ id: 'hero', job: 'Hero', brief: 'b', parts: ['html', 'css'], estHeight: 600 }] };
  mkdirSync(designWorkDir(d.id), { recursive: true });
  writeFileSync(join(designWorkDir(d.id), 'plan.json'), JSON.stringify({ v: 1, kind: 'pitch', title: 'P', canvas: { w: 1920, h: 1080 }, sections: [{ id: 's1', job: 'One', brief: 'b', parts: ['html'] }] }));
  assert.equal((await live().call('get_design', {})).plan, null, 'a plan of another kind is no plan');
  writeFileSync(join(designWorkDir(d.id), 'plan.json'), JSON.stringify(web));
  assert.deepEqual((await live().call('get_design', {})).plan.sections.map((s) => s.id), ['hero']);
  await assert.rejects(() => live().call('start_design_build', { brief: 'x' }), /already has a plan: use change_design/);
  const m = appendMessage(t.id, { role: 'user', text: 'with notes' });
  addAttachment(t.id, m.id, { name: 'notes.txt', text: 'hi' });
  addAttachment(t.id, null, { name: 'shown.txt', text: 'x' });
  assert.deepEqual((await live().call('get_design', {})).attachments.map((a) => a.name), ['notes.txt']);
  const b = createBuild({ designId: d.id, kind: 'change', brief: 'x' }, { by: 'local' });
  await assert.rejects(() => live().call('change_design', { instruction: 'x' }), /a build is running \(round 1\)/);
  assert.match(await designPromptBlock(getThread(t.id)), new RegExp(`^build: ${b.id} planning \\(round 1\\)$`, 'm'));
  updateBuild(b.id, { status: 'done' });
  assert.equal((await live().call('change_design', { instruction: 'x', sections: ['hero'], needsLead: false })).ok, true);
});
test('get_design: what the model reads is redacted, and a design with a project names its checkout', async () => {
  const kit = defaultDesignDeps({ threadId: 'ask_00000001', io: io({ getDesign: () => ({ ...D, projectKey: 'shop-0123abcd' }), projectPath: async (k) => `/code/${k}` }) });
  const r = await createAskTools({ limits: ASK_LIMITS, redact: (s) => s.replace('ShipRadar', '[redacted]'), askMode: 'design', ...kit }).call('get_design', {});
  assert.deepEqual([r.design.title, r.design.projectKey, r.paths.project], ['[redacted]', 'shop-0123abcd', '/code/shop-0123abcd']);
});
test('the web section only when web access is on; a Codex design chat gets its engine\'s words for images and PDFs', () => {
  assert.doesNotMatch(buildDesignSystemPrompt({ web: { enabled: false, allowedDomains: ['example.com'], search: null } }), /## Web access/);
  const p = buildDesignSystemPrompt({ engine: 'codex' });
  assert.ok(p.includes(chatDescriptor('codex').prompt.composerBinary));
  assert.doesNotMatch(p, /pass it to your Read tool/);
});
test('the MCP tool server (classic child and relay) serves a design thread exactly its allowlist', async () => {
  const d = createDesign({ kind: 'web', title: 'Served', engine: 'claude' }, { by: 'local' });
  const t = createThread({ title: 'Served', mode: 'design' });
  updateDesign(d.id, { threadId: t.id });
  const out = [];
  const rpc = createAskToolServer({ threadId: t.id, env: { ...process.env, WORCA_ASK_WEB: '', WORCA_ASK_COMMANDS: '', ASK_COMMAND_TOKEN: '' }, write: (s) => out.push(s), log: () => {} });
  await rpc.feed(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })); await rpc.idle();
  assert.deepEqual(JSON.parse(out.join('').trim()).result.tools.map((x) => x.name).sort(),
    ['change_design', 'design_questions', 'get_design', 'list_projects', 'read_attachment', 'start_design_build']);
});
