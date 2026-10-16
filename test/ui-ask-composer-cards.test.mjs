// test/ui-ask-composer-cards.test.mjs — the description source Ask's graph cards read (ask-composer-cards.mjs
// describe / describeGraphs): the newest draft of a key in this chat, else the library row the composer reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createAskComposerCards, LIBRARY_TTL_MS } from '../ui/public/ask-composer-cards.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const draft = (id, key, description, state = 'proposed') => ({ kind: 'card', id, state,
  card: { type: 'agent-draft', draft: { key, meta: { key, description }, markdown: '' } } });

function make({ blocks = [], agents = [], scripts = [], fail = false } = {}) {
  const clock = { t: 1000 };
  const gets = [];
  let changes = 0;
  const fetch = async (url) => {
    gets.push(url);
    if (fail) return { ok: false, status: 500, json: async () => ({}) };
    return url === '/api/scripts' ? ok({ scripts }) : ok({ agents });
  };
  const cards = createAskComposerCards({ doc, fetch, blocks: () => blocks, postCard: async () => ({}), now: () => clock.t, onChange: () => { changes += 1; } });
  return { cards, clock, gets, changes: () => changes };
}

test('describe: a graph card\'s footer text — the newest live draft of the key in this chat, else the library row; describeGraphs loads once per page open and backs off on failure', async () => {
  const s = make({ blocks: [draft('card_0000d001', 'notes', 'Writes the notes.'), draft('card_0000d002', 'gone', 'Declined text.', 'declined')],
    agents: [{ key: 'planner', description: 'Plans.' }, { key: 'notes', description: 'Library notes.' }, { key: 'gone', description: 'Library gone.' }],
    scripts: [{ key: 'lint', description: 'Lints.' }] });
  assert.equal(s.cards.describe('notes'), 'Writes the notes.', 'a draft in this chat speaks first — before any load');
  assert.equal(s.cards.describe('planner'), '', 'nothing loaded yet');
  const at0 = s.cards.describedAt();
  await s.cards.describeGraphs();
  assert.deepEqual(s.gets, ['/api/agents?all=1', '/api/scripts']);
  assert.notEqual(s.cards.describedAt(), at0, 'describedAt moves (ask-panel repaints the footers)');
  assert.equal(s.changes(), 1, 'onChange once it landed');
  assert.equal(s.cards.describe('planner'), 'Plans.');
  assert.equal(s.cards.describe('lint'), 'Lints.', 'scripts too');
  assert.equal(s.cards.describe('notes'), 'Writes the notes.', 'the draft still wins');
  assert.equal(s.cards.describe('gone'), 'Library gone.', 'a declined draft does not speak');
  s.clock.t += LIBRARY_TTL_MS * 4;
  await s.cards.describeGraphs();
  assert.equal(s.gets.length, 2, 'loaded once: no reload while it stays loaded');
  assert.equal(s.changes(), 1);
  s.cards.stale();
  await s.cards.describeGraphs();
  assert.equal(s.gets.length, 4, 'stale() (the Chat page shown again) re-reads it');
  const f = make({ fail: true });
  await f.cards.describeGraphs(); await f.cards.describeGraphs();
  assert.equal(f.gets.length, 2, 'a failed load is retried at the TTL, never on every render');
  f.clock.t += LIBRARY_TTL_MS + 1;
  await f.cards.describeGraphs();
  assert.equal(f.gets.length, 4);
  assert.equal(f.changes(), 0, 'no repaint for a load that never landed');
});
