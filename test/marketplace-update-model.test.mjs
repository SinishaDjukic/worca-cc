// test/marketplace-update-model.test.mjs — the Update review sheet's rules (board 3.2, U2): which card is ready,
// what the footer says, which access chip and "What changes" lines a preview gives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accessChip, deltaLines, parseDiffstat, newCard, needsTick, isIncluded, isReady,
  footState, sheetTitle, versionRange, previewedLabel, isUpToDate,
} from '../ui/public/marketplace/update-model.mjs';

import { EMPTY_DELTA, MCP_ROW, SRC_ROW, MCP_PREVIEW, SRC_PREVIEW } from './helpers/marketplace-update-fixtures.mjs';

const card = (row, preview, over = {}) => ({ ...newCard(row), state: 'review', preview, ...over });

test('the access chip names the first red change, else the first change; no change gives no chip', () => {
  assert.equal(accessChip([]), null);
  assert.deepEqual(accessChip(SRC_PREVIEW.access), { label: 'New secret', red: true });
  assert.deepEqual(accessChip([{ kind: 'setup', id: null, red: false }, { kind: 'modelEnv', id: 'fast', red: true }]),
    { label: 'Model env changed', red: true });
  assert.deepEqual(accessChip([{ kind: 'agent', id: 'reviewer', red: false }]), { label: 'New agent', red: false });
});

test('What changes: access lines red first (a secret shows its key), then removed models, then the server MCP and skill lines', () => {
  assert.deepEqual(deltaLines(SRC_PREVIEW), [
    { text: 'New secret: ', mono: 'webhookSecret', red: true, glyph: 'key' },
    { text: 'Setup commands changed', mono: null, red: false, glyph: 'script' },
  ]);
  const p = { ...MCP_PREVIEW,
    access: [{ kind: 'mcp', id: 'linear', red: false }, { kind: 'agent', id: 'reviewer', red: false },
      { kind: 'channelSecret', id: 'slack.appToken', red: true }, { kind: 'modelSecret', id: 'BMF_KEY', red: true },
      { kind: 'skill', id: 'grows', red: false }],
    manifestDelta: { ...EMPTY_DELTA, removedModels: ['old-fast'],
      mcpLines: [{ red: false, text: 'new MCP server: linear' }],
      skillLines: [{ red: true, text: 'SKILL CHANGED: grows — in Billing' }] } };
  assert.deepEqual(deltaLines(p), [
    { text: 'New secret: ', mono: 'appToken', red: true, glyph: 'key' },
    { text: 'New secret: ', mono: 'BMF_KEY', red: true, glyph: 'key' },
    { text: 'New agent: ', mono: 'reviewer', red: false, glyph: 'agent' },
    { text: 'Removed model: ', mono: 'old-fast', red: false, glyph: 'cube' },
    { text: 'new MCP server: linear', mono: null, red: false, glyph: 'plug' },
    { text: 'SKILL CHANGED: grows — in Billing', mono: null, red: true, glyph: 'skill' },
  ]);
  const rest = { ...MCP_PREVIEW, access: [{ kind: 'modelEnv', id: 'fast', red: true },
    { kind: 'taskSource', id: 'gitlab', red: false }, { kind: 'chatChannel', id: 'teams', red: false },
    { kind: 'model', id: 'slow', red: false }] };
  assert.deepEqual(deltaLines(rest).map((l) => [l.text, l.mono, l.glyph]), [
    ['Model env changed: ', 'fast', 'alert'], ['New task source: ', 'gitlab', 'tray'],
    ['New chat channel: ', 'teams', 'chat'], ['New model: ', 'slow', 'cube'],
  ]);
});

test('parseDiffstat reads the git summary line (LF or CRLF; either half may be missing)', () => {
  assert.deepEqual(parseDiffstat(SRC_PREVIEW.diffstat), { files: 4, insertions: 86, deletions: 12 });
  assert.deepEqual(parseDiffstat(' a | 1 +\n 1 file changed, 1 insertion(+)'), { files: 1, insertions: 1, deletions: null });
  assert.deepEqual(parseDiffstat(' 2 files changed, 3 deletions(-)'), { files: 2, insertions: null, deletions: 3 });
  assert.equal(parseDiffstat(''), null);
  assert.equal(parseDiffstat('not a diffstat'), null);
});

test('readiness: no new access is ready while included; new access and a stale preview wait for the tick', () => {
  const mcp = card(MCP_ROW, MCP_PREVIEW);
  const src = card(SRC_ROW, SRC_PREVIEW);
  assert.equal(newCard(MCP_ROW).include, true, 'Include is ticked by default (U2)');
  assert.equal(needsTick(mcp), false);
  assert.equal(isReady(mcp), true);
  assert.equal(isIncluded({ ...mcp, include: false }), false);
  assert.equal(needsTick(src), true);
  assert.equal(isIncluded({ ...src, include: false }), true, 'new access has no Include: it is always in');
  assert.equal(isReady(src), false);
  assert.equal(isReady({ ...src, reviewed: true }), true);
  const stale = { ...mcp, stale: true };
  assert.equal(needsTick(stale), true);
  assert.equal(isReady(stale), false);
  assert.equal(isReady({ ...stale, reviewed: true }), true);
  assert.equal(isIncluded(newCard(SRC_ROW)), true, 'a card still previewing counts…');
  assert.equal(isReady(newCard(SRC_ROW)), false, '…and is never ready');
});

test('footer: the canvas state, all ready, Include off, k>1 ready, nothing included', () => {
  const mcp = card(MCP_ROW, MCP_PREVIEW);
  const src = card(SRC_ROW, SRC_PREVIEW);
  assert.deepEqual(footState([mcp, src]),
    { meta: '1 of 2 ready', only: 'Update atlassian-mcp only', primary: 'Update 2 plugins', enabled: false, finished: false });
  assert.deepEqual(footState([mcp, { ...src, reviewed: true }]),
    { meta: '2 of 2 ready', only: null, primary: 'Update 2 plugins', enabled: true, finished: false });
  assert.deepEqual(footState([{ ...mcp, include: false }, src]),
    { meta: '0 of 1 ready', only: null, primary: 'Update github-source', enabled: false, finished: false });
  const bmf = card({ ...MCP_ROW, name: 'bmf-models' }, MCP_PREVIEW);
  assert.equal(footState([mcp, bmf, src]).only, 'Update 2 ready');
  assert.deepEqual(footState([{ ...mcp, include: false }]),
    { meta: '', only: null, primary: 'Update', enabled: false, finished: false });
});

test('footer after a run: done, failed and up-to-date cards leave the count; nothing pending → Done', () => {
  const mcp = card(MCP_ROW, MCP_PREVIEW);
  const src = card(SRC_ROW, SRC_PREVIEW);
  assert.deepEqual(footState([{ ...mcp, state: 'done' }, { ...src, state: 'failed' }]),
    { meta: '1 of 2 updated', only: null, primary: 'Done', enabled: true, finished: true });
  assert.deepEqual(footState([{ ...mcp, state: 'done' }, { ...src, stale: true }]),
    { meta: '0 of 1 ready', only: null, primary: 'Update github-source', enabled: false, finished: false });
  assert.equal(footState([{ ...mcp, state: 'uptodate' }]).primary, 'Done');
});

test('title, version range and the previewed line', () => {
  assert.equal(sheetTitle([newCard(MCP_ROW), newCard(SRC_ROW)]), 'Update 2 plugins');
  assert.equal(sheetTitle([newCard(SRC_ROW)]), 'Update github-source');
  assert.equal(versionRange(newCard(SRC_ROW)), '0.2.0 → 0.3.0', 'before the preview: row version → latest');
  assert.equal(versionRange(card(SRC_ROW, SRC_PREVIEW)), '0.2.0 → 0.3.0');
  const bare = { ...SRC_ROW, version: 'd12b77f', latest: null };
  assert.equal(versionRange(card(bare, { ...SRC_PREVIEW, pinnedVersion: null, candidateVersion: null })),
    'd12b77f → 9e41a0c', 'a version-less plugin shows shas');
  const now = Date.parse('2026-10-20T10:01:00.000Z');
  assert.equal(previewedLabel([newCard(SRC_ROW)], now), 'Previewing…');
  assert.equal(previewedLabel([card(MCP_ROW, MCP_PREVIEW), card(SRC_ROW, SRC_PREVIEW)], now), 'Previewed just now');
  assert.equal(previewedLabel([card(MCP_ROW, MCP_PREVIEW)], Date.parse('2026-10-20T10:05:00.000Z')), 'Previewed 5m ago');
});

test('isUpToDate: the pin itself, or no commits and an empty diffstat (a monorepo tip moved, as in P5 installed.mjs); else not', () => {
  assert.equal(isUpToDate({ ...MCP_PREVIEW, candidateSha: MCP_PREVIEW.pinnedSha }), true);
  assert.equal(isUpToDate({ ...MCP_PREVIEW, commits: [], diffstat: '' }), true, 'monorepo: the tip moved, the folder did not');
  assert.equal(isUpToDate({ ...MCP_PREVIEW, commits: [], diffstat: ' a | 1 +\n 1 file changed, 1 insertion(+)' }), false, 'a rollback diff is reviewed');
  assert.equal(isUpToDate({ ...MCP_PREVIEW, diffstat: '' }), false, 'commits to list');
  assert.equal(isUpToDate(MCP_PREVIEW), false);
  assert.equal(isUpToDate({ ...MCP_PREVIEW, candidateSha: null, commits: [], diffstat: '' }), false);
});

test('the "only" button waits for every preview (LC-P6-5); a range with nothing to go to shows the version alone', () => {
  const mcp = card(MCP_ROW, MCP_PREVIEW);
  assert.equal(footState([mcp, newCard(SRC_ROW)]).only, null, 'a preview still out: no apply beside it');
  assert.equal(footState([mcp, card(SRC_ROW, SRC_PREVIEW)]).only, 'Update atlassian-mcp only');
  assert.equal(versionRange(newCard({ ...SRC_ROW, latest: null })), '0.2.0');
});
