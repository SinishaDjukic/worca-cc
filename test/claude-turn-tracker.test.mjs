// test/claude-turn-tracker.test.mjs
// When a Claude Code step's turn is over for good (claude.mjs claudeTurnTracker, R15-1): what superviseSpawn's leftover
// kill waits for. Background sub-agents give a result per turn; the step is over only after their notification turns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeTurnTracker } from '../src/core/engines/claude.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const frames = (f) => readFileSync(join(HERE, 'fixtures', f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
/** The 1-based line numbers at which the tracker says the turn is over. */
const overAt = (lines) => { const t = claudeTurnTracker(); return lines.flatMap((e, i) => { t.see(e); return t.over() ? [i + 1] : []; }); };

test('a background agent: the main turn`s result is not the end; the notification turn`s is', () => {
  const lines = frames('hooks/subagent-background.jsonl');
  const at = overAt(lines);
  assert.equal(at[0], 31, 'over at the notification turn`s result, never at line 24');
});

test('a foreground agent and a plain turn end at their result', () => {
  const lines = frames('hooks/subagent-foreground.jsonl');
  const last = lines.map((e) => e.type).lastIndexOf('result') + 1;
  assert.equal(overAt(lines)[0], last);
  assert.deepEqual(overAt([{ type: 'system', subtype: 'init' }, { type: 'result' }]), [2]);
});

test('a later init opens the turn again; a result with queued turns does not end it', () => {
  assert.deepEqual(overAt([{ type: 'result' }, { type: 'system', subtype: 'init' }]), [1]);
  assert.deepEqual(overAt([{ type: 'result', queued_turn_count: 1 }, { type: 'system', subtype: 'init' }, { type: 'result', queued_turn_count: 0 }]), [3]);
});
