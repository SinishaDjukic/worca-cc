// test/marketplace-update-view.test.mjs — one Update review card and the footer (board 3.2), detached DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { newCard } from '../ui/public/marketplace/update-model.mjs';
import { renderUpdateCard, renderUpdateFoot } from '../ui/public/marketplace/update-view.mjs';
import { MCP_ROW, SRC_ROW, MCP_PREVIEW, SRC_PREVIEW } from './helpers/marketplace-update-fixtures.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const chips = (el) => [...el.querySelectorAll('.mk-upd-top .mk-chip')].map(text);

test('no new access: tile, name, range, "No new access", Include ticked, commits folded', () => {
  const el = renderUpdateCard(doc, { ...newCard(MCP_ROW), state: 'review', preview: MCP_PREVIEW });
  assert.equal(el.tagName, 'SECTION');
  assert.equal(el.getAttribute('aria-label'), 'atlassian-mcp update');
  assert.ok(el.querySelector('.mk-upd-top .mk-mt.mk-mt-sm.mk-t-mcp'), 'the plugin icon (U7)');
  assert.equal(text(el.querySelector('.mk-upd-name')), 'atlassian-mcp');
  const ver = el.querySelector('.mk-upd-ver');
  assert.deepEqual([text(ver), ver.classList.contains('mk-ver'), ver.classList.contains('mk-mono')], ['0.1.0 → 0.1.1', true, false], 'versions are sans (SM30)');
  assert.deepEqual(chips(el), ['No new access']);
  assert.ok(el.querySelector('.mk-upd-top .mk-chip').classList.contains('mk-chip-ok'));
  const inc = el.querySelector('input.mk-include[type="checkbox"]');
  assert.deepEqual([inc.checked, inc.dataset.name, text(inc.closest('label'))], [true, 'atlassian-mcp', 'Include']);
  const disc = el.querySelector('button.mk-disc');
  assert.deepEqual([disc.type, disc.getAttribute('aria-expanded'), text(disc)], ['button', 'false', '2 commits 2441b36 → 735b354']);
  assert.equal(disc.querySelector('.mk-mono').textContent, '2441b36 → 735b354');
  assert.equal(el.querySelector(`#${disc.getAttribute('aria-controls')}`).hidden, true, 'the panel starts folded');
  assert.equal(el.querySelector('input.mk-reviewed'), null);
});

test('new access: red chip, no Include, open panel — commits, diffstat, What changes, the review tick', () => {
  const el = renderUpdateCard(doc, { ...newCard(SRC_ROW), state: 'review', preview: SRC_PREVIEW, expanded: true });
  assert.deepEqual(chips(el), ['New secret']);
  assert.ok(el.querySelector('.mk-upd-top .mk-chip').classList.contains('mk-chip-bad'));
  assert.equal(el.querySelector('input.mk-include'), null);
  assert.equal(el.querySelector('button.mk-disc').getAttribute('aria-expanded'), 'true');
  const panel = el.querySelector('.mk-upd-panel');
  assert.equal(panel.hidden, false);
  assert.deepEqual([...panel.querySelectorAll('h4')].map(text), ['Commits', 'What changes']);
  assert.deepEqual([...panel.querySelectorAll('ul.mk-commits li')].map(text), [
    'a91f2c3 Add a label filter to the issue query', '4be07d1 Write the PR link back to the issue',
    'c0d5e88 Verify webhook deliveries']);
  assert.equal(panel.querySelector('ul.mk-commits li .mk-mono').textContent, 'a91f2c3');
  const ds = panel.querySelector('.mk-diffstat');
  assert.equal(text(ds), '4 files changed, 86 insertions(+), 12 deletions(-)');
  assert.deepEqual([ds.querySelector('.mk-ins').textContent, ds.querySelector('.mk-del').textContent],
    ['86 insertions(+)', '12 deletions(-)']);
  const lines = [...panel.querySelectorAll('.mk-delta')];
  assert.deepEqual(lines.map(text), ['New secret: webhookSecret', 'Setup commands changed']);
  assert.deepEqual(lines.map((l) => l.classList.contains('is-red')), [true, false]);
  assert.equal(lines[0].querySelector('.mk-mono').textContent, 'webhookSecret');
  const tick = panel.querySelector('label.mk-review input.mk-reviewed[type="checkbox"]');
  assert.deepEqual([tick.checked, tick.dataset.name, text(tick.closest('label'))],
    [false, 'github-source', "I've reviewed these changes"]);
});

test('one commit is singular; no diffstat and no What changes when there is none', () => {
  const p = { ...MCP_PREVIEW, commits: [MCP_PREVIEW.commits[0]], diffstat: '' };
  const el = renderUpdateCard(doc, { ...newCard(MCP_ROW), state: 'review', preview: p, expanded: true });
  assert.equal(text(el.querySelector('button.mk-disc')), '1 commit 2441b36 → 735b354');
  assert.equal(el.querySelector('.mk-diffstat'), null);
  assert.deepEqual([...el.querySelectorAll('.mk-upd-panel h4')].map(text), ['Commits']);
});

test('state chips: previewing, updating, updated, up to date; a stale preview asks for the tick again', () => {
  const chipOf = (c) => chips(renderUpdateCard(doc, c));
  assert.deepEqual(chipOf(newCard(MCP_ROW)), ['Previewing…']);
  assert.deepEqual(chipOf({ ...newCard(MCP_ROW), state: 'applying', preview: MCP_PREVIEW }), ['Updating…']);
  assert.deepEqual(chipOf({ ...newCard(MCP_ROW), state: 'done', preview: MCP_PREVIEW }), ['Updated']);
  assert.deepEqual(chipOf({ ...newCard(MCP_ROW), state: 'uptodate', preview: { ...MCP_PREVIEW, commits: [] } }), ['Up to date']);
  const stale = renderUpdateCard(doc, { ...newCard(MCP_ROW), state: 'review', preview: MCP_PREVIEW, stale: true, expanded: true });
  assert.deepEqual(chips(stale), ['No new access', 'Changed since preview']);
  assert.equal(stale.querySelector('input.mk-include'), null);
  assert.ok(stale.querySelector('input.mk-reviewed'));
  const done = renderUpdateCard(doc, { ...newCard(SRC_ROW), state: 'done', preview: SRC_PREVIEW, reviewed: true, expanded: true });
  assert.equal(done.querySelector('input.mk-reviewed'), null, 'nothing to tick once updated');
  assert.equal(done.querySelector('input.mk-include'), null);
});

test('failures stay in the card: the server error under the chip; Needs git is one chip and no line', () => {
  const bad = renderUpdateCard(doc, { ...newCard(MCP_ROW), state: 'failed', preview: MCP_PREVIEW,
    error: { message: 'update exploded', gitMissing: false, phase: 'apply' } });
  assert.deepEqual(chips(bad), ['Update failed']);
  assert.equal(bad.querySelector('.mk-upd-err.mk-wash-bad[role="alert"] .mk-wash-text').textContent, 'update exploded');
  const pf = renderUpdateCard(doc, { ...newCard(MCP_ROW), state: 'failed', error: { message: 'boom', gitMissing: false, phase: 'preview' } });
  assert.deepEqual(chips(pf), ['Preview failed']);
  assert.equal(pf.querySelector('button.mk-disc'), null, 'no preview, no commits');
  const git = renderUpdateCard(doc, { ...newCard(MCP_ROW), state: 'failed', error: { message: null, gitMissing: true, phase: 'preview' } });
  assert.deepEqual([...git.querySelectorAll('.pl-needs-git')].map((n) => n.textContent), ['Needs git']);
  assert.equal(git.querySelector('.mk-upd-err'), null);
});

test('footer: meta, the "only" button while some are ready, the primary', () => {
  const pick = (fs) => {
    const nodes = renderUpdateFoot(doc, fs);
    return ['.mk-upd-meta', '.mk-upd-only', '.mk-upd-go'].map((s) => nodes.find((n) => n.matches(s)));
  };
  const [meta, only, go] = pick({ meta: '1 of 2 ready', only: 'Update atlassian-mcp only', primary: 'Update 2 plugins', enabled: false, finished: false });
  assert.equal(meta.textContent, '1 of 2 ready');
  assert.deepEqual([only.className, only.type, only.dataset.act, only.hidden, only.textContent], ['btn mk-upd-only', 'button', 'only', false, 'Update atlassian-mcp only']);
  assert.deepEqual([go.className, go.type, go.dataset.act, go.disabled, go.textContent], ['btn btn-primary mk-upd-go', 'button', 'go', true, 'Update 2 plugins']);
  assert.equal(pick({ meta: '2 of 2 ready', only: null, primary: 'Update 2 plugins', enabled: true, finished: false })[1].hidden, true);
});
