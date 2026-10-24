import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandSummariser, summariseCommandCard, commandSummariesWanted, redactCommand, buildSummaryPrompt, parseSummary } from '../src/core/ask/command-summary.mjs';
import { resolveNamingModel } from '../src/core/naming.mjs';

const TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';   // ghp_ + 36 characters
const HAIKU = async () => ({ model: 'claude-haiku-5-5', effort: 'low' });
const spy = (text = 'Listing the files') => {
  const calls = [];
  return { calls, run: async (o) => { calls.push(o); return { text }; } };
};

test('the prompt holds the redacted command and nothing else: never the output', async () => {
  const s = spy();
  const sm = createCommandSummariser({ pickModel: HAIKU, run: s.run });
  const OUTPUT = 'total 0\nSECRET-OUTPUT-LINE';
  const r = await sm.summarise('ls -la /tmp');
  assert.equal(r, 'Listing the files');
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].prompt, 'Command:\nls -la /tmp');
  assert.ok(!s.calls[0].prompt.includes(OUTPUT) && !s.calls[0].systemPrompt.includes(OUTPUT));
  assert.deepEqual(s.calls[0].tools, [], 'no built-in tool');
  assert.equal(s.calls[0].model, 'claude-haiku-5-5');
  assert.equal(s.calls[0].effort, 'low');
});

test('a ghp_ token is replaced by the redaction marker before the call', async () => {
  const s = spy('Pushing with a token');
  const sm = createCommandSummariser({ pickModel: HAIKU, run: s.run });
  await sm.summarise(`git push https://x:${TOKEN}@github.com/o/r.git`);
  assert.ok(!s.calls[0].prompt.includes(TOKEN), 'the raw token never reaches the model');
  assert.ok(s.calls[0].prompt.includes(redactCommand(TOKEN)));
  assert.match(redactCommand(TOKEN), /^ghp_<redacted>$/);
});

test('the same command twice calls the model once (cache hit), even while the first is in flight', async () => {
  const s = spy();
  const sm = createCommandSummariser({ pickModel: HAIKU, run: s.run });
  const [a, b] = await Promise.all([sm.summarise('npm test'), sm.summarise('npm test')]);
  const c = await sm.summarise('  npm test  ');
  assert.deepEqual([a, b, c], ['Listing the files', 'Listing the files', 'Listing the files']);
  assert.equal(s.calls.length, 1);
  await sm.summarise('npm run lint');
  assert.equal(s.calls.length, 2, 'another command is another call');
});

test('two commands differing only in their secret share one cache entry (keyed by the redacted command)', async () => {
  const s = spy();
  const sm = createCommandSummariser({ pickModel: HAIKU, run: s.run });
  await sm.summarise(`curl -H "Authorization: Bearer abc.def" https://api`);
  await sm.summarise(`curl -H "Authorization: Bearer xyz.uvw" https://api`);
  assert.equal(s.calls.length, 1);
});

test('no ready model: null, and the model is never called', async () => {
  const s = spy();
  const sm = createCommandSummariser({ pickModel: async () => ({ model: null, effort: null, source: 'default' }), run: s.run });
  assert.equal(await sm.summarise('npm test'), null);
  assert.equal(s.calls.length, 0);
  assert.equal(sm.size(), 0, 'a miss is not cached');
});

test('unset: the job runs on the cheapest ready Claude model (resolveNamingModel over Opus, Haiku and Sonnet)', async () => {
  const CLAUDE = { kind: 'signin', engine: 'claude' };
  const row = (id, extra = {}) => ({ id, label: id, efforts: ['low', 'medium', 'high'], engine: 'claude', connection: CLAUDE, harnesses: ['claude'], ...extra });
  const rows = [row('claude-opus-5-5'), row('claude-haiku-5-5', { efforts: ['minimal', 'low'] }), row('claude-sonnet-5-5')];
  const s = spy();
  const sm = createCommandSummariser({ pickModel: async () => resolveNamingModel({ model: null, effort: null }, rows, () => null), run: s.run });
  await sm.summarise('npm test');
  assert.equal(s.calls[0].model, 'claude-haiku-5-5', 'the cheapest, not the first row');
  assert.equal(s.calls[0].effort, 'minimal', 'at its lowest listed effort');
});

test('a refusal, a question, an empty reply and a spawn failure are null and not cached', async () => {
  for (const run of [async () => ({ text: 'Sorry, I cannot help' }), async () => ({ text: 'What does it do?' }),
    async () => ({ text: '' }), async () => { throw new Error('spawn ENOENT'); }]) {
    const sm = createCommandSummariser({ pickModel: HAIKU, run });
    assert.equal(await sm.summarise('npm test'), null);
    assert.equal(sm.size(), 0);
  }
});

test('parseSummary keeps one clean line, clipped to 120', () => {
  assert.equal(parseSummary('"Running the tests."\nextra'), 'Running the tests');
  assert.equal(parseSummary('Running ' + 'x'.repeat(300)).length, 120);
  assert.equal(buildSummaryPrompt('a'.repeat(5000)).prompt.length, 'Command:\n'.length + 2000);
});

test('the cache holds at most cacheMax entries, oldest out first', async () => {
  const s = spy();
  const sm = createCommandSummariser({ pickModel: HAIKU, run: s.run, cacheMax: 2 });
  await sm.summarise('a'); await sm.summarise('b'); await sm.summarise('c');
  assert.equal(sm.size(), 2);
  await sm.summarise('a');
  assert.equal(s.calls.length, 4, '"a" was evicted');
});

test('summariseCommandCard: gate off calls nothing; an answer patches the card and broadcasts once; null does neither', async () => {
  const flips = []; const frames = []; let asked = 0;
  const summariser = { summarise: async () => { asked += 1; return 'Running the tests'; } };
  const io = { summariser, flipCard: (...a) => { flips.push(a); return { id: a[1] }; }, broadcast: (f) => frames.push(f) };
  const card = { threadId: 'ask_1', cardId: 'card_1', blockId: 't-0000000001:1', command: 'npm test' };
  assert.equal(await summariseCommandCard(card, { ...io, enabled: () => false }), null);
  assert.equal(asked, 0);
  assert.equal(await summariseCommandCard(card, { ...io, enabled: () => true }), 'Running the tests');
  assert.deepEqual(flips, [['ask_1', 'card_1', { card: { summary: 'Running the tests' } }]]);
  assert.deepEqual(frames, [{ type: 'ask-command-summary', threadId: 'ask_1', blockId: 't-0000000001:1', summary: 'Running the tests' }]);
  await summariseCommandCard(card, { ...io, enabled: () => true, summariser: { summarise: async () => null } });
  assert.equal(flips.length, 1); assert.equal(frames.length, 1);
  let open = true;                                          // the switch goes off while the model is answering
  const late = { summarise: async () => { open = false; return 'Running the tests'; } };
  assert.equal(await summariseCommandCard(card, { ...io, enabled: () => open, summariser: late }), null);
  assert.equal(flips.length, 1, 'a gate closed mid-call writes nothing'); assert.equal(frames.length, 1);
});

test('summariseCommandCard with the real summariser and no ready model: no call, no write, no frame (the row keeps the raw command)', async () => {
  const s = spy(); const flips = []; const frames = [];
  const summariser = createCommandSummariser({ pickModel: async () => ({ model: null, effort: null, source: 'default' }), run: s.run });
  const r = await summariseCommandCard({ threadId: 'ask_1', cardId: 'card_1', blockId: 't-0000000001:1', command: 'npm test' },
    { enabled: () => true, summariser, flipCard: (...a) => { flips.push(a); return {}; }, broadcast: (f) => frames.push(f) });
  assert.equal(r, null);
  assert.deepEqual([s.calls.length, flips.length, frames.length], [0, 0, 0]);
});

test('commandSummariesWanted: true only with the flag on, the switch not off, no mock and no cost block', () => {
  const ON = { flag: true, summariseCommands: true, mock: false, blocked: false };
  assert.equal(commandSummariesWanted(ON), true);
  assert.equal(commandSummariesWanted({ ...ON, summariseCommands: undefined }), true, 'an unset switch is on (default)');
  for (const [k, v] of [['flag', false], ['flag', undefined], ['summariseCommands', false], ['mock', true], ['blocked', true]]) {
    assert.equal(commandSummariesWanted({ ...ON, [k]: v }), false, `${k}=${v}`);
  }
  assert.equal(commandSummariesWanted(), false);
});
