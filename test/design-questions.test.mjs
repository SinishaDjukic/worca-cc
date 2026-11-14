// test/design-questions.test.mjs — Design P2 Task 13: mid-build questions through the `.asks` folder.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { framesOf, newBuild, newDesign, useDesignEnv, waitForFrame, waitUntil } from './helpers/design-fixture.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { prepare } from '../src/core/db.mjs';
import { asksDir, sectionDir } from '../src/core/design/paths.mjs';
import {
  ASK_ROUNDS, newAskId, readAskFile, removeAskFile, validateAnswers, validateAsk,
} from '../src/core/design/questions.mjs';
import { DesignBuild } from '../src/core/design/build.mjs';
import { getAgent, getBuild, listAgents } from '../src/core/design/store.mjs';

useDesignEnv(after);
const Q = { id: 'q1', text: 'Tone?', why: 'mock', options: [{ label: 'Calm', value: 'a' }, { label: 'Bold', value: 'b' }] };

const mockRun = (o) => runClaude({ ...o, mock: true });
const questionFileOf = (prompt) => /^Question file: (.+)$/m.exec(prompt)?.[1] ?? null;
const askFileOf = (designId, agentId) => join(asksDir(designId), `${agentId}.json`);
/** `p`'s value, or a rejection `hung` after `ms` (ref'd): a loop that never ends fails its row in seconds. */
function within(p, ms = 10_000) {
  return new Promise((resolve, reject) => {
    const bound = setTimeout(() => reject(new Error('hung')), ms);
    p.then((v) => { clearTimeout(bound); resolve(v); }, (e) => { clearTimeout(bound); reject(e); });
  });
}
const ANSWERS = /^Answers to your questions:/;
/** An event that shows a process received its prompt: its main thread's session, or its first message_start. */
const isReceipt = (e) => e?.parentId == null && (e?.type === 'session' || (e?.type === 'usage' && e.phase === 'start'));
const classed = (message, errorClass) => Object.assign(new Error(message), { errorClass });
/** A process that runs until its signal aborts, then rejects as the runner does; a ref'd 10 s bound rejects `hung`. */
function hangUntilAbort(o) {
  return new Promise((resolve, reject) => {
    const bound = setTimeout(() => reject(new Error('hung')), 10_000);
    const onAbort = () => { clearTimeout(bound); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); };
    if (o.signal.aborted) onAbort();
    else o.signal.addEventListener('abort', onAbort, { once: true });
  });
}

test('validateAsk: C-2 shape, max 8, unique ids, 2 to 6 options', () => {
  assert.equal(validateAsk({ questions: [Q] }).ok, true);
  assert.equal(validateAsk({ questions: Array.from({ length: 9 }, (_, i) => ({ ...Q, id: `q${i}` })) }).ok, false);
  assert.equal(validateAsk({ questions: [] }).ok, false);
  const rec = (flags) => ({ questions: [{ ...Q, options: Q.options.map((o, i) => (flags[i] ? { ...o, recommended: true } : o)) }] });
  assert.equal(validateAsk(rec([true, false])).questions[0].options[0].recommended, true);
  assert.equal(validateAsk(rec([true, true])).ok, false, 'one recommended option at most');
  assert.equal(validateAsk({ questions: [Q, Q] }).ok, false);
  assert.equal(validateAsk({ questions: [{ ...Q, options: [] }] }).ok, false);
  assert.equal(validateAsk({ questions: [{ ...Q, text: '' }] }).ok, false);
  assert.equal(validateAsk({ questions: [{ id: 'q1', question: 'old shape', options: ['a', 'b'] }] }).ok, false, 'M10: not the clarify shape');
  assert.equal(validateAsk('x').ok, false);
});

test('validateAsk: the bounds themselves, the kept fields and text input', () => {
  const opts = (n) => Array.from({ length: n }, (_, i) => ({ label: `L${i}`, value: `v${i}` }));
  assert.equal(validateAsk({ questions: Array.from({ length: 8 }, (_, i) => ({ ...Q, id: `q${i}` })) }).ok, true, '8 questions');
  assert.equal(validateAsk({ questions: [{ ...Q, options: opts(1) }] }).ok, false, 'one option');
  assert.equal(validateAsk({ questions: [{ ...Q, options: opts(2) }] }).ok, true, 'two options');
  assert.equal(validateAsk({ questions: [{ ...Q, options: opts(6) }] }).ok, true, 'six options');
  assert.equal(validateAsk({ questions: [{ ...Q, options: opts(7) }] }).ok, false, 'seven options');
  assert.equal(validateAsk({ questions: [{ ...Q, options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'a' }] }] }).ok, false, 'one value twice');
  assert.equal(validateAsk({ questions: [{ ...Q, options: [{ label: '', value: 'a' }, { label: 'B', value: 'b' }] }] }).ok, false, 'a blank label');
  assert.equal(validateAsk({ questions: [{ ...Q, id: '' }] }).ok, false, 'a blank id');
  assert.equal(validateAsk({ questions: [{ ...Q, options: ['a', 'b'] }] }).ok, false, 'clarify options are strings');
  assert.equal(validateAsk({ questions: [{ id: 'q1', question: 'old shape', options: Q.options }] }).ok, false, 'clarify names the text question');
  assert.equal(validateAsk({ questions: [{ ...Q, why: 5 }] }).ok, false, 'why is text');
  assert.equal(validateAsk({ questions: [{ id: 'q1', text: 'Tone?', options: Q.options }] }).questions[0].why, '', 'why may be left out');
  assert.equal(validateAsk({ questions: [{ ...Q, allowFreeText: true }] }).ok, true, 'extra keys are dropped, not refused');
  assert.equal(validateAsk({ questions: [Q] }).questions[0].allowFreeText, undefined);
  const out = validateAsk({ questions: [{ ...Q, extra: 1, options: [{ label: 'Calm', value: 'a', recommended: false, x: 1 }, Q.options[1]] }] });
  assert.deepEqual(out, { ok: true, questions: [{ id: 'q1', text: 'Tone?', why: 'mock', options: [{ label: 'Calm', value: 'a' }, { label: 'Bold', value: 'b' }] }] });
  assert.equal(validateAsk(JSON.stringify({ questions: [Q] })).ok, true, 'the file text');
  for (const bad of [null, [], { questions: 'x' }, { questions: [null] }]) assert.equal(validateAsk(bad).ok, false);
  assert.equal(typeof validateAsk({ questions: [] }).error, 'string');
  assert.deepEqual(ASK_ROUNDS, { lead: 2, builder: 1 });
  assert.match(newAskId(), /^as_[0-9a-f]{8}$/);
  assert.notEqual(newAskId(), newAskId());
});

test('validateAnswers: every question once, value from its options', () => {
  assert.equal(validateAnswers([Q], [{ id: 'q1', value: 'a' }]).ok, true);
  for (const bad of [[], [{ id: 'q1', value: 'z' }], [{ id: 'q9', value: 'a' }], [{ id: 'q1', value: 'a' }, { id: 'q1', value: 'b' }], 'x']) assert.equal(validateAnswers([Q], bad).ok, false);
  const Q2 = { ...Q, id: 'q2' };
  assert.equal(validateAnswers([Q, Q2], [{ id: 'q2', value: 'b' }, { id: 'q1', value: 'a' }]).ok, true, 'any order');
  assert.equal(validateAnswers([Q, Q2], [{ id: 'q1', value: 'a' }]).ok, false, 'one left out');
  assert.equal(validateAnswers([Q], [null]).ok, false);
  assert.equal(validateAnswers([Q], null).ok, false);
  assert.equal(typeof validateAnswers([Q], []).error, 'string');
});

test('readAskFile and removeAskFile: missing, invalid, valid', () => {
  const d = newDesign();
  const file = askFileOf(d.id, 'a_00000001');
  assert.equal(readAskFile(file), null);
  writeFileSync(file, '{');
  assert.equal(typeof readAskFile(file).invalid, 'string');
  writeFileSync(file, JSON.stringify({ questions: [] }));
  assert.equal(typeof readAskFile(file).invalid, 'string');
  writeFileSync(file, JSON.stringify({ questions: [Q] }));
  assert.deepEqual(readAskFile(file), { questions: [Q] });
  removeAskFile(file);
  assert.equal(existsSync(file), false);
  removeAskFile(file);
  mkdirSync(join(file, 'x'), { recursive: true });
  assert.equal(typeof readAskFile(file).invalid, 'string', 'a folder is not a question file');
  removeAskFile(file);
  assert.equal(existsSync(file), false, 'and it is removed');
});

test('readAskFile never reads through a link at the file name', { skip: process.platform === 'win32' }, () => {
  const d = newDesign();
  const target = join(asksDir(d.id), 'elsewhere.txt');
  writeFileSync(target, JSON.stringify({ questions: [Q] }));
  symlinkSync(target, askFileOf(d.id, 'a_00000002'));
  assert.equal(typeof readAskFile(askFileOf(d.id, 'a_00000002')).invalid, 'string');
  removeAskFile(askFileOf(d.id, 'a_00000002'));
  assert.equal(existsSync(askFileOf(d.id, 'a_00000002')), false);
  assert.equal(readFileSync(target, 'utf8'), JSON.stringify({ questions: [Q] }), 'the link goes, never its target');
});

test('a builder question: waiting, others finish, answer resumes that session', async () => {
  const d = newDesign();
  const { build, frames, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=3 MOCK_ASK_SECTION=features' });
  const p = build.run();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  assert.match(q.askId, /^as_[0-9a-f]{8}$/);
  assert.equal(q.heading, 'Features needs a decision');
  assert.equal(q.job, 'Features');
  assert.deepEqual(q.questions[0].options[0], { label: 'Calm', value: 'a' });
  const before = frames.slice(0, frames.indexOf(q));
  assert.equal(framesOf(before, 'design-agent').filter((f) => f.agentId === q.agentId).at(-1).status, 'waiting', 'the agent frame goes out before the question');
  assert.equal(framesOf(before, 'design-build').at(-1).waiting, 1, 'entering waiting flushes design-build at once');
  await waitUntil(() => ['hero', 'pricing'].every((id) => frames.some((f) => f.type === 'design-section' && f.sectionId === id && f.status === 'done')));
  // design-build is held to 2 Hz, so .at(-1) mid-round can still be the planning frame: wait for the fact.
  await waitForFrame(frames, (f) => f.type === 'design-build' && f.status === 'building' && f.waiting === 1, 2000);
  assert.equal(build.runningCount, 0, 'it waits, with no process running');
  assert.equal(build.waitingCount, 1);
  assert.throws(() => build.answer('as_00000000', [{ id: 'q1', value: 'a' }]), { status: 409 });
  assert.throws(() => build.answer(q.askId, [{ id: 'q1', value: 'z' }]), { status: 422 });
  assert.ok(existsSync(askFileOf(d.id, q.agentId)), 'L2.8: the file stays until a valid answer');
  build.answer(q.askId, [{ id: 'q1', value: 'b' }]);
  assert.equal(framesOf(frames, 'design-build').at(-1).waiting, 0, 'leaving waiting flushes design-build at once');
  assert.throws(() => build.answer(q.askId, [{ id: 'q1', value: 'b' }]), { status: 409 }, 'a second tab answering');
  assert.deepEqual(await p, { status: 'done', reason: null });
  const resume = calls.filter((c) => c.cwd.endsWith('features'))[1];
  assert.equal(resume.resumeSessionId, listAgents(build.id).find((a) => a.sectionId === 'features').sessionId);
  assert.match(resume.prompt, /Bold/);
  assert.equal(listAgents(build.id).find((a) => a.sectionId === 'features').asks, 1);
  assert.equal(existsSync(askFileOf(d.id, q.agentId)), false, 'removed once the resume received the answers');
  assert.equal(framesOf(frames, 'design-question').length, 1);
});

test('M6 with M12: a waiting builder keeps its build slot, so running + waiting never passes the cap', async () => {
  const { build, frames, calls } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=2 MOCK_ASK_SECTION=hero', deps: { maxBuildersFor: () => 1 } });
  const ids = () => calls.filter((c) => c.cwd.includes('sections')).map((c) => c.cwd.split(sep).at(-1));
  const p = build.run();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(ids(), ['hero'], 'features waits for the slot');
  build.answer(q.askId, [{ id: 'q1', value: 'a' }]);
  await p;
  assert.deepEqual(ids(), ['hero', 'hero', 'features']);
});

test('M1: an answer a halt overtakes before its process starts is never lost: the question waits again', async () => {
  const d = newDesign();
  const { build, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero' });
  const p = build.run();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  build.answer(q.askId, [{ id: 'q1', value: 'b' }]);
  build.pauseForDrain();
  assert.deepEqual(await within(p), { status: 'paused', reason: 'drain' });
  const row = getAgent(q.agentId);
  assert.deepEqual([row.status, row.asks], ['waiting', 0], 'back to waiting, its round not used up');
  assert.ok(existsSync(askFileOf(d.id, q.agentId)), 'the question file is kept for a Continue');
  assert.equal(getBuild(build.id).sections[0].status, 'writing', 'L2.29: its section stays writing');
  const calls = [];
  const again = DesignBuild.rehydrate({ buildId: build.id, deps: { staggerMs: 0, retryDelayMs: 0, runClaude: (o) => { calls.push(o); return mockRun(o); } } });
  const seen = [];
  again.on('frame', (f) => seen.push(f));
  const c = again.continue();
  const q2 = await waitForFrame(seen, (f) => f.type === 'design-question');
  assert.deepEqual([q2.agentId, calls.length], [q.agentId, 0], 'asked again, nothing spawned');
  again.answer(q2.askId, [{ id: 'q1', value: 'b' }]);
  assert.deepEqual(await within(c), { status: 'done', reason: null });
  assert.match(calls[0].prompt, /Bold/, 'the resume carries the answer');
  assert.equal(getAgent(q.agentId).asks, 1);
  assert.equal(existsSync(askFileOf(d.id, q.agentId)), false, 'removed once its process starts');
});

test('M1: the answer is taken only once the slot is held: a spawn the limits refuse keeps the question', async () => {
  // The machine slot refuses the resume (the total limit reached while the agent waited); the agent waits again.
  let blocked = false;
  const d = newDesign();
  const { build, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero', deps: { budgetStatus: () => ({ blocked }) } });
  const p = build.run();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  blocked = true;
  build.answer(q.askId, [{ id: 'q1', value: 'a' }]);
  assert.deepEqual(await within(p), { status: 'paused', reason: 'total-limit' });
  assert.deepEqual([getAgent(q.agentId).status, getAgent(q.agentId).asks], ['waiting', 0]);
  assert.ok(existsSync(askFileOf(d.id, q.agentId)));
});

test('a lead whose integrate question is pending re-enters integrate written waiting, never starting', async () => {
  const d = newDesign();
  let asked = false;
  const askOnIntegrate = (o) => {
    if (o.maxTurns !== 40 || asked) return mockRun(o);
    asked = true;
    const lead = listAgents(build.id).find((a) => a.role === 'lead');
    writeFileSync(askFileOf(d.id, lead.id), JSON.stringify({ questions: [Q] }));
    return Promise.resolve({ text: '', exitCode: 0 });
  };
  const { build, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=1', deps: { runClaude: askOnIntegrate } });
  const p = build.run();
  const q0 = await waitForFrame(frames, (f) => f.type === 'design-question');
  build.pauseForDrain();
  assert.deepEqual(await within(p), { status: 'paused', reason: 'drain' });
  const calls = [];
  const again = DesignBuild.rehydrate({ buildId: build.id, deps: { staggerMs: 0, retryDelayMs: 0, runClaude: (o) => { calls.push(o); return mockRun(o); } } });
  const seen = [];
  again.on('frame', (f) => seen.push(f));
  const c = again.continue();
  const q = await waitForFrame(seen, (f) => f.type === 'design-question');
  assert.deepEqual([q.agentId, calls.length], [q0.agentId, 0]);
  const before = framesOf(seen.slice(0, seen.indexOf(q)), 'design-agent').filter((f) => f.agentId === q.agentId);
  assert.deepEqual(before.map((f) => f.status), ['waiting'], 'no process runs, so never starting');
  again.answer(q.askId, [{ id: 'q1', value: 'a' }]);
  assert.deepEqual(await within(c), { status: 'done', reason: null });
  assert.equal(calls[0].maxTurns, 40, 'the answer resumes the integrate pass');
});

test('M1 with M7: a halt at any microtask after the answer keeps the question until a process shows it received the answers', async () => {
  const microtasks = (k) => { let p = Promise.resolve(); for (let i = 0; i < k; i += 1) p = p.then(() => {}); return p; };
  let calledNotReceived = 0;
  for (let k = 0; k <= 12; k += 1) {
    let armed = false;
    let received = false;
    const d = newDesign();
    const { build, frames, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero', deps: {
      teamTotalGate: async () => {
        if (armed) { armed = false; void microtasks(k).then(() => build.pauseForDrain()); }
        return { blocked: false };
      },
      runClaude: (o) => mockRun({ ...o, onEvent: (e) => {
        if (ANSWERS.test(o.prompt) && !o.signal.aborted && isReceipt(e)) received = true;
        o.onEvent(e);
      } }),
    } });
    const p = build.run();
    const q = await waitForFrame(frames, (f) => f.type === 'design-question');
    armed = true;
    build.answer(q.askId, [{ id: 'q1', value: 'b' }]);
    assert.equal((await within(p)).status, 'paused', String(k));
    const row = getAgent(q.agentId);
    const file = existsSync(askFileOf(d.id, q.agentId));
    if (received) {
      assert.deepEqual([row.asks, file], [1, false], `${k}: its process received the answers, so they were taken`);
    } else {
      assert.deepEqual([row.status, row.asks, file], ['waiting', 0, true], `${k}: no process received the answers`);
      if (calls.some((o) => ANSWERS.test(o.prompt))) calledNotReceived += 1;
    }
  }
  assert.ok(calledNotReceived > 0, 'some halt landed after runClaude was called, before its process received the answers');
});

test('M1: a halt while the answers resume starts up keeps the question, and a Continue asks it again', async () => {
  // The reviewer's probe: the process never shows it received the prompt (the CLI killed during its start-up, or the
  // broker's network waits), so the answer reached no process.
  const d = newDesign();
  let built = null;
  const { build, frames, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero', deps: { runClaude: (o) => {
    if (!ANSWERS.test(o.prompt)) return mockRun(o);
    setImmediate(() => built.pauseForDrain());
    return hangUntilAbort(o);
  } } });
  built = build;
  const p = build.run();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  build.answer(q.askId, [{ id: 'q1', value: 'b' }]);
  assert.deepEqual(await within(p), { status: 'paused', reason: 'drain' });
  assert.equal(calls.filter((o) => ANSWERS.test(o.prompt)).length, 1, 'the resume was called');
  const row = getAgent(q.agentId);
  assert.deepEqual([row.status, row.asks], ['waiting', 0], 'its round is not used up');
  assert.ok(existsSync(askFileOf(d.id, q.agentId)), 'the question file is kept');
  const resumed = [];
  const again = DesignBuild.rehydrate({ buildId: build.id, deps: { staggerMs: 0, retryDelayMs: 0, runClaude: (o) => { resumed.push(o); return mockRun(o); } } });
  const seen = [];
  again.on('frame', (f) => seen.push(f));
  const c = again.continue();
  const q2 = await waitForFrame(seen, (f) => f.type === 'design-question');
  assert.deepEqual([q2.agentId, resumed.length], [q.agentId, 0], 'asked again, nothing spawned');
  again.answer(q2.askId, [{ id: 'q1', value: 'b' }]);
  assert.deepEqual(await within(c), { status: 'done', reason: null });
  assert.match(resumed[0].prompt, ANSWERS);
  assert.match(resumed[0].prompt, /Bold/);
  assert.deepEqual([getAgent(q.agentId).asks, existsSync(askFileOf(d.id, q.agentId))], [1, false]);
});

test('M1: only a main-thread session or message_start reported before the halt takes the answer', async () => {
  const usageStart = (parentId) => ({ type: 'usage', messageId: 'msg_1', parentId, usage: { input_tokens: 1, output_tokens: 0 }, phase: 'start' });
  const cases = [
    ['a main-thread session init', (o) => [{ type: 'session', init: true, sessionId: o.resumeSessionId, parentId: null }], true],
    ['a main-thread message_start', () => [usageStart(null)], true],
    ['a sub-agent message_start', () => [usageStart('toolu_1')], false],
  ];
  for (const [label, events, taken] of cases) {
    const d = newDesign();
    let built = null;
    const { build, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero', deps: { runClaude: (o) => {
      if (!ANSWERS.test(o.prompt)) return mockRun(o);
      for (const e of events(o)) o.onEvent(e);
      setImmediate(() => built.pauseForDrain());
      return hangUntilAbort(o);
    } } });
    built = build;
    const p = build.run();
    const q = await waitForFrame(frames, (f) => f.type === 'design-question');
    build.answer(q.askId, [{ id: 'q1', value: 'b' }]);
    assert.deepEqual(await within(p), { status: 'paused', reason: 'drain' }, label);
    const got = [getAgent(q.agentId).asks, existsSync(askFileOf(d.id, q.agentId))];
    assert.deepEqual(got, taken ? [1, false] : [0, true], label);
    if (taken) assert.deepEqual([getAgent(q.agentId).status === 'waiting', build.waitingCount], [false, 0], `${label}: nothing is left to answer`);
  }
  // A session the process reports only once the halt has landed (the mock does so while it stops) came too late.
  const d = newDesign();
  let built = null;
  const { build, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero', deps: { runClaude: (o) => {
    if (!ANSWERS.test(o.prompt)) return mockRun(o);
    o.signal.addEventListener('abort', () => o.onEvent({ type: 'session', init: true, sessionId: o.resumeSessionId, parentId: null }), { once: true });
    setImmediate(() => built.pauseForDrain());
    return hangUntilAbort(o);
  } } });
  built = build;
  const p = build.run();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  build.answer(q.askId, [{ id: 'q1', value: 'b' }]);
  assert.deepEqual(await within(p), { status: 'paused', reason: 'drain' });
  assert.deepEqual([getAgent(q.agentId).status, getAgent(q.agentId).asks, existsSync(askFileOf(d.id, q.agentId))], ['waiting', 0, true], 'a session reported after the halt');
});

test('M1: a network error before the answers resume shows receipt retries the answers on the session that asked', async () => {
  const d = newDesign();
  let failed = false;
  const { build, frames, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero', deps: { runClaude: (o) => {
    if (failed || !ANSWERS.test(o.prompt)) return mockRun(o);
    failed = true;
    return Promise.reject(classed('fetch failed', 'network'));
  } } });
  const p = build.run();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  build.answer(q.askId, [{ id: 'q1', value: 'b' }]);
  assert.deepEqual(await within(p), { status: 'done', reason: null });
  const hero = calls.filter((o) => o.cwd.endsWith('hero'));
  assert.equal(hero.length, 3, 'the ask, the failed resume, the retry');
  assert.equal(hero[2].prompt, hero[1].prompt, 'the retry sends the answers again');
  assert.match(hero[2].prompt, /Bold/);
  assert.ok(hero[2].resumeSessionId);
  assert.equal(hero[2].resumeSessionId, hero[1].resumeSessionId, 'on the session that asked');
  assert.deepEqual([getAgent(q.agentId).asks, existsSync(askFileOf(d.id, q.agentId))], [1, false]);
  assert.equal(framesOf(frames, 'design-question').length, 1, 'never asked twice');
});

test('M1: a usage limit before the answers resume shows receipt pauses the build and keeps the question', async () => {
  const d = newDesign();
  const { build, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero', deps: { runClaude: (o) => (
    ANSWERS.test(o.prompt) ? Promise.reject(classed('mock usage limit', 'usage_limit')) : mockRun(o)
  ) } });
  const p = build.run();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  build.answer(q.askId, [{ id: 'q1', value: 'b' }]);
  assert.deepEqual(await within(p), { status: 'paused', reason: 'usage_limit' });
  assert.deepEqual([getAgent(q.agentId).status, getAgent(q.agentId).asks, existsSync(askFileOf(d.id, q.agentId))], ['waiting', 0, true]);
});

test('M1: a budget-stopped result with no receipt before it keeps the question too', async () => {
  const d = newDesign();
  const { build, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero', deps: { runClaude: async (o) => {
    if (!ANSWERS.test(o.prompt)) return mockRun(o);
    o.onEvent({ type: 'result', subtype: 'error_max_budget_usd', isError: true, costUsd: 0, cumulativeCost: true });
    return { text: '', exitCode: 0 };
  } } });
  const p = build.run();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  build.answer(q.askId, [{ id: 'q1', value: 'b' }]);
  assert.deepEqual(await within(p), { status: 'paused', reason: 'total-limit' });
  assert.deepEqual([getAgent(q.agentId).status, getAgent(q.agentId).asks, existsSync(askFileOf(d.id, q.agentId))], ['waiting', 0, true]);
});

test('M1: a halt during the retry wait of an answers resume that never showed receipt keeps the question', async () => {
  const d = newDesign();
  const { build, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero', deps: {
    retryDelayMs: 60_000,
    runClaude: (o) => (ANSWERS.test(o.prompt) ? Promise.reject(classed('fetch failed', 'network')) : mockRun(o)),
  } });
  const p = build.run();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  build.answer(q.askId, [{ id: 'q1', value: 'b' }]);
  await waitForFrame(frames, (f) => f.type === 'design-agent' && f.agentId === q.agentId && f.status === 'retrying');
  build.pauseForDrain();
  assert.deepEqual(await within(p), { status: 'paused', reason: 'drain' });
  assert.deepEqual([getAgent(q.agentId).status, getAgent(q.agentId).asks, existsSync(askFileOf(d.id, q.agentId))], ['waiting', 0, true]);
});

test('M1: a lost session on the answers resume drops the question with that session: the agent starts over once', async () => {
  const d = newDesign();
  let lost = false;
  const { build, frames, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero', deps: { runClaude: (o) => {
    if (lost || !ANSWERS.test(o.prompt)) return mockRun(o);
    lost = true;
    return Promise.reject(new Error('claude exited with code 1: No conversation found with session ID: x'));
  } } });
  const p = build.run();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  build.answer(q.askId, [{ id: 'q1', value: 'b' }]);
  assert.deepEqual(await within(p), { status: 'done', reason: null });
  const hero = calls.filter((o) => o.cwd.endsWith('hero'));
  assert.equal(hero.length, 3);
  assert.equal(hero[2].resumeSessionId, undefined, 'a fresh session');
  assert.equal(hero[2].prompt, hero[0].prompt, 'on its first prompt');
  assert.deepEqual([getAgent(q.agentId).asks, existsSync(askFileOf(d.id, q.agentId))], [1, false], 'its question went with the lost session');
  assert.equal(framesOf(frames, 'design-question').length, 1, 'and is never asked of the fresh one');
});

test('M1: a halt before the fresh start after a lost answers resume shows receipt never asks that question again', async () => {
  const d = newDesign();
  let lost = false;
  let halted = false;
  let built = null;
  const { build, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero', deps: { runClaude: (o) => {
    if (!lost && ANSWERS.test(o.prompt)) {
      lost = true;
      return Promise.reject(new Error('claude exited with code 1: No conversation found with session ID: x'));
    }
    if (lost && !halted && o.cwd.endsWith('hero')) {
      halted = true;
      setImmediate(() => built.pauseForDrain());
      return hangUntilAbort(o);
    }
    return mockRun(o);
  } } });
  built = build;
  const p = build.run();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  build.answer(q.askId, [{ id: 'q1', value: 'b' }]);
  assert.deepEqual(await within(p), { status: 'paused', reason: 'drain' });
  const row = getAgent(q.agentId);
  assert.deepEqual([row.status === 'waiting', row.asks, existsSync(askFileOf(d.id, q.agentId))], [false, 1, false], 'the question went with the lost session');
  const resumed = [];
  const again = DesignBuild.rehydrate({ buildId: build.id, deps: { staggerMs: 0, retryDelayMs: 0, runClaude: (o) => { resumed.push(o); return mockRun(o); } } });
  const seen = [];
  again.on('frame', (f) => seen.push(f));
  assert.deepEqual(await within(again.continue()), { status: 'done', reason: null });
  assert.equal(framesOf(seen, 'design-question').length, 0, 'never asked of the fresh session');
  assert.doesNotMatch(resumed[0].prompt, ANSWERS);
});

test('M1: a question file the resume cannot remove ends the round engine-error, its process stopped', { skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'POSIX, not root: a read-only folder stands in for a failed remove' : false }, async () => {
  const d = newDesign();
  const { build, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero' });
  const p = build.run();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  const logged = [];
  const error = console.error;
  console.error = (...a) => { logged.push(a.join(' ')); };
  chmodSync(asksDir(d.id), 0o555);
  try {
    build.answer(q.askId, [{ id: 'q1', value: 'b' }]);
    assert.deepEqual(await within(p), { status: 'error', reason: 'engine-error' });
    assert.equal(build.runningCount, 0);
    assert.equal(existsSync(join(sectionDir(d.id, 'hero'), 'style.css')), false, 'its process was stopped before it built');
    assert.ok(existsSync(askFileOf(d.id, q.agentId)), 'the question is still there for a Continue');
  } finally {
    console.error = error;
    chmodSync(asksDir(d.id), 0o755);
  }
});

test('a pause keeps a waiting agent waiting, its section writing and its file (L2.29)', async () => {
  const d = newDesign(); const { build, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero' });
  const p = build.run();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  assert.equal(build.pauseForDrain(), true);
  assert.throws(() => build.answer(q.askId, [{ id: 'q1', value: 'a' }]), { status: 409 }, 'answered in the same tick as the halt');
  assert.deepEqual(await p, { status: 'paused', reason: 'drain' });
  assert.equal(framesOf(frames, 'design-agent').filter((f) => f.agentId === q.agentId).at(-1).status, 'waiting');
  assert.equal(listAgents(build.id)[1].status, 'waiting');
  assert.deepEqual([getBuild(build.id).sections[0].status, framesOf(frames, 'design-build').at(-1).waiting], ['writing', 1]);
  assert.throws(() => build.answer(q.askId, [{ id: 'q1', value: 'a' }]), { status: 409 }, 'L2.25');
  assert.ok(existsSync(join(asksDir(d.id), `${q.agentId}.json`)));
  assert.deepEqual(build.snapshot().questions, [], 'askId lives in memory: a Continue asks again');
});

test('a failed section does not pause the round while a question still waits', async () => {
  const { build, frames } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=2 MOCK_ASK_SECTION=hero MOCK_FAIL_SECTION=features' });
  const p = build.run();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  await waitForFrame(frames, (f) => f.type === 'design-section' && f.sectionId === 'features' && f.status === 'failed');
  assert.equal(build.status, 'building', 'the 2 Hz frame may lag; the getter does not');
  assert.ok(!frames.some((f) => f.type === 'design-build' && f.status === 'paused'));
  build.answer(q.askId, [{ id: 'q1', value: 'a' }]);
  assert.deepEqual(await p, { status: 'paused', reason: 'failed' });
});

test('the lead may ask during planning; the build stays planning', async () => {
  const { build, frames } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_ASK_LEAD' });
  const p = build.run();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  assert.equal(framesOf(frames, 'design-build').at(-1).status, 'planning');
  assert.deepEqual([q.job, q.heading], ['Lead', 'Lead needs a decision']);
  build.answer(q.askId, [{ id: 'q1', value: 'a' }]);
  assert.equal((await p).status, 'done');
  assert.equal(listAgents(build.id)[0].asks, 1);
});

test('the lead has two rounds: asked twice, answered twice, then it plans', async () => {
  let file = null; let asked = 0;
  const { build, frames } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1', deps: { runClaude: async (o) => {
    const out = await mockRun(o);
    if (!o.cwd.includes(`${sep}sections${sep}`)) {
      file ??= questionFileOf(o.prompt);
      if (asked < 2) { asked += 1; writeFileSync(file, JSON.stringify({ questions: [Q] })); }
    }
    return out;
  } } });
  const p = build.run();
  for (let n = 1; n <= 2; n++) {
    const q = await waitForFrame(frames, (f) => f.type === 'design-question' && framesOf(frames, 'design-question').indexOf(f) === n - 1);
    build.answer(q.askId, [{ id: 'q1', value: 'a' }]);
  }
  assert.deepEqual(await within(p), { status: 'done', reason: null });
  const qs = framesOf(frames, 'design-question');
  assert.equal(qs.length, 2);
  assert.notEqual(qs[0].askId, qs[1].askId, 'a fresh askId per wait');
  assert.equal(listAgents(build.id)[0].asks, 2);
});

test('an answer sent from inside the question frame resumes the agent', async () => {
  const { build, frames } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero' });
  build.on('frame', (f) => { if (f.type === 'design-question') build.answer(f.askId, [{ id: 'q1', value: 'a' }]); });
  assert.deepEqual(await within(build.run()), { status: 'done', reason: null });
  assert.equal(framesOf(frames, 'design-question').length, 1);
});

test('stop one while it waits: that section ends stopped at once, its file kept, the round goes on', async () => {
  const d = newDesign();
  const { build, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=2 MOCK_ASK_SECTION=hero MOCK_HANG_SECTION=features' });
  const p = build.run();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  assert.equal(build.stopAgent(q.agentId), true);
  await waitUntil(() => listAgents(build.id).find((a) => a.id === q.agentId).status === 'stopped');
  assert.equal(framesOf(frames, 'design-build').at(-1).waiting, 0, 'leaving waiting flushes design-build at once');
  assert.equal(build.status, 'building', 'features still runs');
  assert.ok(existsSync(askFileOf(d.id, q.agentId)));
  assert.throws(() => build.answer(q.askId, [{ id: 'q1', value: 'a' }]), { status: 409 });
  assert.deepEqual(await build.stop('user'), { status: 'stopped', reason: 'user' });
  await p;
});

test('past its rounds an agent gets one no-more-questions resume, then fails', async () => {
  const d = newDesign(); const { build, frames, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_ASK_ALWAYS_SECTION=hero' });
  const p = build.run();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  build.answer(q.askId, [{ id: 'q1', value: 'a' }]);
  assert.deepEqual(await within(p), { status: 'paused', reason: 'failed' });
  assert.equal(framesOf(frames, 'design-question').length, 1);
  const hero = calls.filter((c) => c.cwd.endsWith('hero'));
  assert.equal(hero.length, 3);
  assert.match(hero[2].prompt, /No more questions/i);
  assert.equal(existsSync(askFileOf(d.id, q.agentId)), false, 'a section that fails past its rounds removes its file');
  const row = listAgents(build.id).find((a) => a.id === q.agentId);
  assert.deepEqual([row.status, row.asks], ['error', 1]);
  assert.match(row.error, /question/i);
});

test('a broken question file is ignored, judged by the output', async () => {
  const files = new Map();
  const { build, frames } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=2', deps: { runClaude: async (o) => {
    const id = o.cwd.split(sep).at(-1);
    const file = questionFileOf(o.prompt);
    if (file && (id === 'hero' || id === 'features')) {
      files.set(id, file);
      writeFileSync(file, id === 'hero' ? '{' : JSON.stringify({ questions: [{ id: 'q1', question: 'old shape', options: ['a', 'b'] }] }));
    }
    return mockRun(o);
  } } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.equal(files.size, 2);
  assert.equal(framesOf(frames, 'design-question').length, 0);
  assert.deepEqual(getBuild(build.id).sections.map((s) => s.status), ['done', 'done']);
  for (const file of files.values()) assert.equal(existsSync(file), false, 'an invalid file is removed');
  assert.deepEqual(listAgents(build.id).map((a) => a.asks), [0, 0, 0]);
});

test('no design-question once the build is halted or the agent stopped', async () => {
  // The process asked, and the halt (or the stop) landed after its result: the question is never sent.
  const asking = (act) => {
    let built = null;
    const box = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero', deps: { runClaude: async (o) => {
      const out = await mockRun(o);
      if (o.cwd.endsWith(`${sep}hero`)) act(built);
      return out;
    } } });
    built = box.build;
    return box;
  };
  const drain = asking((b) => b.pauseForDrain());
  assert.deepEqual(await within(drain.build.run()), { status: 'paused', reason: 'drain' });
  assert.equal(framesOf(drain.frames, 'design-question').length, 0);
  const hero = listAgents(drain.build.id).find((a) => a.sectionId === 'hero');
  assert.ok(existsSync(askFileOf(drain.build.designId, hero.id)), 'L2.8: the file stays for a Continue');
  assert.equal(framesOf(drain.frames, 'design-build').at(-1).waiting, 0);

  const one = asking((b) => b.stopAgent(b._agents.find((a) => a.sectionId === 'hero').id));
  assert.deepEqual(await within(one.build.run()), { status: 'done', reason: 'partial' });
  assert.equal(framesOf(one.frames, 'design-question').length, 0);
  assert.equal(listAgents(one.build.id).find((a) => a.sectionId === 'hero').status, 'stopped');
});

test('stop while a question waits: no hang, agent stopped, file kept', async () => {
  const d = newDesign(); const { build, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero' });
  const p = build.run();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  await build.stop('user'); await p;
  assert.ok(existsSync(join(asksDir(d.id), `${q.agentId}.json`)));
  assert.deepEqual([listAgents(build.id).find((a) => a.id === q.agentId).status, getBuild(build.id).sections[0].status], ['stopped', 'stopped']);
  assert.throws(() => build.answer(q.askId, [{ id: 'q1', value: 'a' }]), { status: 409 });
});

test('snapshot carries the waiting question', async () => {
  const { build, frames } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_ASK_SECTION=hero' });
  const p = build.run();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  const s = build.snapshot();
  assert.deepEqual(s.questions, [{ agentId: q.agentId, askId: q.askId, job: 'Hero', heading: 'Hero needs a decision', questions: q.questions }]);
  assert.equal(s.build.waiting, 1);
  assert.equal(s.agents.find((a) => a.agentId === q.agentId).status, 'waiting');
  s.questions[0].questions[0].text = 'changed';
  assert.equal(build.snapshot().questions[0].questions[0].text, 'Tone?', 'a copy, never the live question');
  build.answer(q.askId, [{ id: 'q1', value: 'a' }]);
  assert.deepEqual(build.snapshot().questions, [], 'gone after the answer');
  assert.deepEqual(await p, { status: 'done', reason: null });
  assert.deepEqual(build.snapshot().questions, []);
});

test('a resumed session books only its difference: the ledger equals the running totals', async () => {
  const { build, frames } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_COST=0.25 MOCK_ASK_SECTION=hero' });
  const p = build.run();
  const q = await waitForFrame(frames, (f) => f.type === 'design-question');
  build.answer(q.askId, [{ id: 'q1', value: 'a' }]);
  await p;
  const sum = prepare('SELECT SUM(amount_usd) s FROM design_cost_ledger WHERE build_id = ?').get(build.id).s;
  assert.ok(Math.abs(sum - 1.0) < 1e-9, 'lead 0.50 (plan + integrate on one session) + builder 0.50 (ask + answer)');
  assert.ok(Math.abs(getBuild(build.id).costUsd - 1.0) < 1e-9);
});
