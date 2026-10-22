// test/marketplace-update-sheet.test.mjs — the Update review sheet end to end over P3's sheet, with a scripted api.
import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { createUpdateReview } from '../ui/public/marketplace/update-sheet.mjs';
import { sheetHarness, ok, fail, settle, deferred } from './helpers/marketplace-sheet-harness.mjs';
import { MCP_ROW, SRC_ROW, MCP_PREVIEW, SRC_PREVIEW } from './helpers/marketplace-update-fixtures.mjs';

const trackDom = useDomRelease(afterEach);
function setup(plugins, routes) {
  const h = sheetHarness({ trackDom, plugins, routes });
  return { ...h, review: createUpdateReview({ doc: h.doc, win: h.window, page: h.page, deps: h.deps }) };
}
const $ = (doc, s) => doc.querySelector(`#mk-sheet ${s}`);
const cardOf = (doc, name) => doc.querySelector(`#mk-sheet .mk-upd[data-name="${name}"]`);
const chips = (el) => [...el.querySelectorAll('.mk-upd-top .mk-chip')].map((c) => c.textContent.trim());
const tick = (win, input) => { input.checked = !input.checked; input.dispatchEvent(new win.Event('change', { bubbles: true })); };
const both = (confirm = () => ok({ ok: true, updated: true })) => ({
  'POST /api/plugins/atlassian-mcp/update': (b) => (b.confirm ? confirm('atlassian-mcp', b) : ok({ preview: MCP_PREVIEW })),
  'POST /api/plugins/github-source/update': (b) => (b.confirm ? confirm('github-source', b) : ok({ preview: SRC_PREVIEW })),
});

test('opens every plugin with an update, previews one at a time, then shows the canvas footer', async () => {
  const first = deferred();
  const slack = { name: 'slack-chat', version: '0.1.0', contributions: { chatChannels: 1 }, latest: null };
  const { doc, calls, review } = setup([SRC_ROW, slack, MCP_ROW], {
    'POST /api/plugins/atlassian-mcp/update': () => first.p,
    'POST /api/plugins/github-source/update': ok({ preview: SRC_PREVIEW }),
  });
  const opening = review.open();
  await settle();
  assert.equal(doc.querySelector('#mk-sheet').dataset.mode, 'update');
  assert.equal($(doc, 'h2').textContent, 'Update 2 plugins');
  assert.deepEqual([...doc.querySelectorAll('#mk-sheet .mk-upd')].map((s) => s.dataset.name), ['atlassian-mcp', 'github-source']);
  assert.deepEqual(calls, [['POST', '/api/plugins/atlassian-mcp/update', {}]], 'one preview at a time');
  assert.equal($(doc, '.mk-upd-when').textContent, 'Previewing…');
  assert.equal($(doc, '.mk-upd-go').disabled, true);
  first.resolve(ok({ preview: MCP_PREVIEW }));
  await opening;
  assert.deepEqual(calls.map((c) => c[1]), ['/api/plugins/atlassian-mcp/update', '/api/plugins/github-source/update']);
  assert.deepEqual([$(doc, '.mk-upd-meta').textContent, $(doc, '.mk-upd-only').textContent, $(doc, '.mk-upd-go').textContent, $(doc, '.mk-upd-go').disabled],
    ['1 of 2 ready', 'Update atlassian-mcp only', 'Update 2 plugins', true]);
  assert.equal(cardOf(doc, 'github-source').querySelector('.mk-disc').getAttribute('aria-expanded'), 'true', 'the card to review is open');
  assert.equal(cardOf(doc, 'atlassian-mcp').querySelector('.mk-disc').getAttribute('aria-expanded'), 'false');
  assert.match($(doc, '.mk-upd-when').textContent, /^Previewed /);
});

test('the review tick enables "Update 2 plugins"; unticking Include leaves only github-source', async () => {
  const { window, doc, review } = setup([MCP_ROW, SRC_ROW], both());
  await review.open();
  tick(window, cardOf(doc, 'github-source').querySelector('input.mk-reviewed'));
  assert.deepEqual([$(doc, '.mk-upd-meta').textContent, $(doc, '.mk-upd-go').disabled, $(doc, '.mk-upd-only').hidden], ['2 of 2 ready', false, true]);
  tick(window, cardOf(doc, 'atlassian-mcp').querySelector('input.mk-include'));
  assert.deepEqual([$(doc, '.mk-upd-meta').textContent, $(doc, '.mk-upd-go').textContent], ['1 of 1 ready', 'Update github-source']);
});

test('apply: one confirm at a time with the previewed candidateSha; Escape is ignored while it runs; Done closes', async () => {
  const gate = deferred();
  const confirms = [];
  const { window, doc, page, notified, review } = setup([MCP_ROW, SRC_ROW], both((name, b) => {
    confirms.push([name, b.candidateSha]);
    return name === 'atlassian-mcp' ? gate.p : ok({ ok: true, updated: true });
  }));
  await review.open();
  tick(window, cardOf(doc, 'github-source').querySelector('input.mk-reviewed'));
  $(doc, '.mk-upd-go').click();
  await settle();
  assert.deepEqual(confirms, [['atlassian-mcp', MCP_PREVIEW.candidateSha]]);
  assert.deepEqual(chips(cardOf(doc, 'atlassian-mcp')), ['Updating…']);
  assert.equal(review.isApplying(), true);
  doc.getElementById('mk-sheet').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
  assert.equal(review.isOpen(), true, 'Escape waits while updates apply');
  gate.resolve(ok({ ok: true, updated: true }));
  await settle();
  assert.deepEqual(confirms, [['atlassian-mcp', MCP_PREVIEW.candidateSha], ['github-source', SRC_PREVIEW.candidateSha]]);
  assert.deepEqual([...doc.querySelectorAll('#mk-sheet .mk-upd')].map((s) => s.dataset.state), ['done', 'done']);
  assert.deepEqual([$(doc, '.mk-upd-meta').textContent, $(doc, '.mk-upd-go').textContent], ['2 of 2 updated', 'Done']);
  assert.equal(page.loads, 1, 'the page reloads once after the run');
  assert.deepEqual(notified, []);
  $(doc, '.mk-upd-go').click();
  await settle();
  assert.equal(review.isOpen(), false);
});

test('STALE_PREVIEW: that card re-previews in place, says so, needs the tick; the others still update', async () => {
  const NEW_SHA = `1234567${'9'.repeat(33)}`;
  let previews = 0;
  const { window, doc, review } = setup([MCP_ROW, SRC_ROW], {
    'POST /api/plugins/atlassian-mcp/update': (b) => {
      if (!b.confirm) {
        previews += 1;
        return ok({ preview: previews === 1 ? MCP_PREVIEW : { ...MCP_PREVIEW, candidateSha: NEW_SHA, candidateVersion: '0.1.2' } });
      }
      return b.candidateSha === NEW_SHA ? ok({ ok: true, updated: true })
        : fail(409, { error: 'the plugin moved since the preview', code: 'STALE_PREVIEW', candidateSha: NEW_SHA });
    },
    'POST /api/plugins/github-source/update': (b) => (b.confirm ? ok({ ok: true, updated: true }) : ok({ preview: SRC_PREVIEW })),
  });
  await review.open();
  tick(window, cardOf(doc, 'github-source').querySelector('input.mk-reviewed'));
  $(doc, '.mk-upd-go').click();
  await settle(16);
  const a = cardOf(doc, 'atlassian-mcp');
  assert.equal(previews, 2, 'the stale card previewed again');
  assert.equal(a.dataset.state, 'review');
  assert.deepEqual(chips(a), ['No new access', 'Changed since preview']);
  assert.equal(a.querySelector('.mk-upd-ver').textContent, '0.1.0 → 0.1.2');
  assert.equal(a.querySelector('input.mk-reviewed').checked, false);
  assert.equal(a.querySelector('.mk-disc').getAttribute('aria-expanded'), 'true', 'the stale card opens');
  assert.equal(cardOf(doc, 'github-source').dataset.state, 'done', 'the others still update');
  assert.deepEqual([$(doc, '.mk-upd-meta').textContent, $(doc, '.mk-upd-go').textContent, $(doc, '.mk-upd-go').disabled],
    ['0 of 1 ready', 'Update atlassian-mcp', true]);
  tick(window, a.querySelector('input.mk-reviewed'));
  $(doc, '.mk-upd-go').click();
  await settle(16);
  assert.equal(cardOf(doc, 'atlassian-mcp').dataset.state, 'done', 'applied with the new candidateSha');
});

test('"Update atlassian-mcp only" applies just the ready card', async () => {
  const confirms = [];
  const { doc, review } = setup([MCP_ROW, SRC_ROW], both((name, b) => { confirms.push(name); return ok({ ok: true, updated: true }); }));
  await review.open();
  $(doc, '.mk-upd-only').click();
  await settle();
  assert.deepEqual(confirms, ['atlassian-mcp']);
  assert.equal(cardOf(doc, 'github-source').dataset.state, 'review');
  assert.deepEqual([$(doc, '.mk-upd-meta').textContent, $(doc, '.mk-upd-go').textContent], ['0 of 1 ready', 'Update github-source']);
});

test('failures stay in their card and nothing is toasted', async () => {
  const { window, doc, notified, review } = setup([MCP_ROW, SRC_ROW], {
    'POST /api/plugins/atlassian-mcp/update': fail(409, { error: 'git is not installed on this machine', code: 'GIT_MISSING' }),
    'POST /api/plugins/github-source/update': (b) => (b.confirm ? fail(500, { error: 'npm ci failed' }) : ok({ preview: SRC_PREVIEW })),
  });
  await review.open();
  assert.equal(cardOf(doc, 'atlassian-mcp').querySelector('.pl-needs-git').textContent, 'Needs git');
  assert.equal($(doc, '.mk-upd-meta').textContent, '0 of 1 ready');
  tick(window, cardOf(doc, 'github-source').querySelector('input.mk-reviewed'));
  $(doc, '.mk-upd-go').click();
  await settle();
  assert.deepEqual(chips(cardOf(doc, 'github-source')), ['Update failed']);
  assert.equal(cardOf(doc, 'github-source').querySelector('.mk-upd-err').textContent, 'npm ci failed');
  assert.equal($(doc, '.mk-upd-go').textContent, 'Done');
  assert.deepEqual(notified, []);
});

test('SM55: while the shared panel shows another mode, the review cards and foot ignore clicks; Close is P3\'s', async () => {
  const { doc, calls, review } = setup([MCP_ROW, SRC_ROW], both());
  await review.open();
  doc.getElementById('mk-sheet').dataset.mode = 'install';
  $(doc, '.mk-upd-only').click();
  cardOf(doc, 'atlassian-mcp').querySelector('.mk-disc').click();
  await settle();
  assert.equal(calls.filter((c) => c[2] && c[2].confirm).length, 0, 'no apply');
  assert.equal(cardOf(doc, 'atlassian-mcp').querySelector('.mk-disc').getAttribute('aria-expanded'), 'false', 'no fold');
  doc.getElementById('mk-sheet').dataset.mode = 'update';
  doc.querySelector('#mk-sheet-host .mk-close').click();
  await settle();
  assert.equal(review.isOpen(), false);
});

test('SM70: leaving #marketplace closes the review sheet', async () => {
  const { window, review } = setup([MCP_ROW, SRC_ROW], both());
  await review.open();
  window.location.hash = '#models';
  window.dispatchEvent(new window.Event('hashchange'));
  await settle();
  assert.equal(review.isOpen(), false);
});

test('open([name]) reviews that plugin only; the commits button folds in place; closing stops later previews', async () => {
  const { doc, calls, review } = setup([MCP_ROW, SRC_ROW], both());
  await review.open(['github-source']);
  assert.equal($(doc, 'h2').textContent, 'Update github-source');
  assert.deepEqual(calls.map((c) => c[1]), ['/api/plugins/github-source/update']);
  const disc = cardOf(doc, 'github-source').querySelector('.mk-disc');
  disc.click();
  assert.equal(cardOf(doc, 'github-source').querySelector('.mk-disc').getAttribute('aria-expanded'), 'false');
  assert.equal(cardOf(doc, 'github-source').querySelector('.mk-upd-panel').hidden, true);
  const gate = deferred();
  const s2 = setup([MCP_ROW, SRC_ROW], { 'POST /api/plugins/atlassian-mcp/update': () => gate.p, 'POST /api/plugins/github-source/update': ok({ preview: SRC_PREVIEW }) });
  const opening = s2.review.open();
  await settle();
  s2.review.close();
  gate.resolve(ok({ preview: MCP_PREVIEW }));
  await opening;
  assert.deepEqual(s2.calls.map((c) => c[1]), ['/api/plugins/atlassian-mcp/update'], 'no preview after the sheet closed');
});

test('STALE on a ticked card: unticked again and opened', async () => {
  const NEW_SHA = `1234567${'9'.repeat(33)}`;
  let previews = 0;
  const { window, doc, review } = setup([SRC_ROW], {
    'POST /api/plugins/github-source/update': (b) => {
      if (!b.confirm) { previews += 1; return ok({ preview: previews === 1 ? SRC_PREVIEW : { ...SRC_PREVIEW, candidateSha: NEW_SHA } }); }
      return b.candidateSha === NEW_SHA ? ok({ ok: true, updated: true }) : fail(409, { error: 'moved', code: 'STALE_PREVIEW', candidateSha: NEW_SHA });
    },
  });
  await review.open();
  cardOf(doc, 'github-source').querySelector('.mk-disc').click();     // fold it, so only the STALE rule re-opens it
  tick(window, cardOf(doc, 'github-source').querySelector('input.mk-reviewed'));
  $(doc, '.mk-upd-go').click();
  await settle(16);
  const c = cardOf(doc, 'github-source');
  assert.equal(c.querySelector('input.mk-reviewed').checked, false, 'the tick is asked for again');
  assert.equal(c.querySelector('.mk-disc').getAttribute('aria-expanded'), 'true', 'the stale card opens');
});

test('while applying: close() refuses, the foot is disabled, a second go sends nothing', async () => {
  const gate = deferred();
  const confirms = [];
  const { doc, review } = setup([MCP_ROW], {
    'POST /api/plugins/atlassian-mcp/update': (b) => (b.confirm ? (confirms.push(b.candidateSha), gate.p) : ok({ preview: MCP_PREVIEW })),
  });
  await review.open();
  $(doc, '.mk-upd-go').click();
  await settle();
  assert.equal($(doc, '.mk-upd-go').disabled, true);
  $(doc, '.mk-upd-go').disabled = false;
  $(doc, '.mk-upd-go').click();
  await settle();
  assert.equal(confirms.length, 1, 'one run at a time');
  review.close();
  assert.equal(review.isOpen(), true, 'close() waits while updates apply');
  gate.resolve(ok({ ok: true, updated: true }));
  await settle();
});

test('a run with an updated plugin drops the agent caches; an all-failed run does not', async () => {
  const a = setup([MCP_ROW], { 'POST /api/plugins/atlassian-mcp/update': (b) => (b.confirm ? ok({ ok: true, updated: true }) : ok({ preview: MCP_PREVIEW })) });
  await a.review.open();
  $(a.doc, '.mk-upd-go').click();
  await settle();
  assert.deepEqual(a.calls.filter((c) => c[0] === 'invalidate'), [['invalidate']]);
  const b = setup([MCP_ROW], { 'POST /api/plugins/atlassian-mcp/update': (x) => (x.confirm ? fail(500, { error: 'no' }) : ok({ preview: MCP_PREVIEW })) });
  await b.review.open();
  $(b.doc, '.mk-upd-go').click();
  await settle();
  assert.deepEqual(b.calls.filter((c) => c[0] === 'invalidate'), []);
});

test('apply answers: updated:false is Up to date; 409 GIT_MISSING is Needs git, no error line', async () => {
  const { doc, review } = setup([MCP_ROW, SRC_ROW], {
    'POST /api/plugins/atlassian-mcp/update': (b) => (b.confirm ? ok({ ok: true, updated: false }) : ok({ preview: MCP_PREVIEW })),
    'POST /api/plugins/github-source/update': (b) => (b.confirm ? fail(409, { error: 'git is not installed', code: 'GIT_MISSING' }) : ok({ preview: SRC_PREVIEW })),
  });
  await review.open();
  const t = cardOf(doc, 'github-source').querySelector('input.mk-reviewed');
  t.checked = true; t.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  $(doc, '.mk-upd-go').click();
  await settle();
  assert.deepEqual(chips(cardOf(doc, 'atlassian-mcp')), ['Up to date']);
  assert.equal(cardOf(doc, 'github-source').querySelector('.pl-needs-git').textContent, 'Needs git');
  assert.equal(cardOf(doc, 'github-source').querySelector('.mk-upd-err'), null);
  assert.equal($(doc, '.mk-upd-meta').textContent, '0 of 2 updated');
});

test('a preview whose candidate is the pin is Up to date and leaves the count', async () => {
  const { doc, review } = setup([MCP_ROW, SRC_ROW], {
    'POST /api/plugins/atlassian-mcp/update': ok({ preview: { ...MCP_PREVIEW, candidateSha: MCP_PREVIEW.pinnedSha, commits: [] } }),
    'POST /api/plugins/github-source/update': ok({ preview: SRC_PREVIEW }),
  });
  await review.open();
  assert.deepEqual(chips(cardOf(doc, 'atlassian-mcp')), ['Up to date']);
  assert.equal($(doc, '.mk-upd-meta').textContent, '0 of 1 ready');
});

test('the commits button keeps focus after it folds', async () => {
  const { doc, review } = setup([SRC_ROW], { 'POST /api/plugins/github-source/update': ok({ preview: SRC_PREVIEW }) });
  await review.open();
  cardOf(doc, 'github-source').querySelector('.mk-disc').click();
  assert.equal(doc.activeElement, cardOf(doc, 'github-source').querySelector('.mk-disc'));
});

test('a late preview of an earlier open neither paints nor previews on', async () => {
  const gate = deferred();
  let n = 0;
  const { doc, calls, review } = setup([MCP_ROW, SRC_ROW], {
    'POST /api/plugins/atlassian-mcp/update': () => (n++ === 0 ? gate.p : ok({ preview: MCP_PREVIEW })),
    'POST /api/plugins/github-source/update': ok({ preview: SRC_PREVIEW }),
  });
  const first = review.open();
  await settle();
  review.close();
  await review.open(['github-source']);
  gate.resolve(ok({ preview: MCP_PREVIEW }));
  await first;
  await settle();
  assert.deepEqual(calls.map((c) => c[1]), ['/api/plugins/atlassian-mcp/update', '/api/plugins/github-source/update']);
  assert.equal($(doc, '.mk-upd-go').textContent, 'Update github-source');
});

test('a monorepo preview (no commits, no diffstat) is Up to date in the sheet', async () => {
  const { doc, review } = setup([MCP_ROW, SRC_ROW], {
    'POST /api/plugins/atlassian-mcp/update': ok({ preview: { ...MCP_PREVIEW, commits: [], diffstat: '' } }),
    'POST /api/plugins/github-source/update': ok({ preview: SRC_PREVIEW }),
  });
  await review.open();
  assert.deepEqual(chips(cardOf(doc, 'atlassian-mcp')), ['Up to date']);
  assert.equal($(doc, '.mk-upd-meta').textContent, '0 of 1 ready');
});

test('a card un-ticked (Include or the review tick) while an earlier card applies is left out of the run', async () => {
  const gate = deferred();
  const applied = [];
  const B = { ...MCP_ROW, name: 'b-mcp' };
  const { window, doc, review } = setup([MCP_ROW, B, SRC_ROW], {
    'POST /api/plugins/atlassian-mcp/update': (b) => (b.confirm ? (applied.push('atlassian-mcp'), gate.p) : ok({ preview: MCP_PREVIEW })),
    'POST /api/plugins/b-mcp/update': (b) => (b.confirm ? (applied.push('b-mcp'), ok({ ok: true, updated: true })) : ok({ preview: MCP_PREVIEW })),
    'POST /api/plugins/github-source/update': (b) => (b.confirm ? (applied.push('github-source'), ok({ ok: true, updated: true })) : ok({ preview: SRC_PREVIEW })),
  });
  await review.open();
  tick(window, cardOf(doc, 'github-source').querySelector('input.mk-reviewed'));
  $(doc, '.mk-upd-go').click();
  await settle();
  tick(window, cardOf(doc, 'b-mcp').querySelector('input.mk-include'));
  tick(window, cardOf(doc, 'github-source').querySelector('input.mk-reviewed'));
  gate.resolve(ok({ ok: true, updated: true }));
  await settle(20);
  assert.deepEqual(applied, ['atlassian-mcp'], 'consent taken back during the run is honoured');
  assert.deepEqual(['b-mcp', 'github-source'].map((n) => cardOf(doc, n).dataset.state), ['review', 'review']);
  assert.deepEqual([$(doc, '.mk-upd-meta').textContent, $(doc, '.mk-upd-go').disabled], ['0 of 1 ready', true]);
});

test('an open made while an earlier run still applies (SM70 closed its sheet) stays busy and previews only after that run', async () => {
  const gate = deferred();
  const log = [];
  const { window, doc, review } = setup([MCP_ROW], {
    'POST /api/plugins/atlassian-mcp/update': (b) => { log.push(b.confirm ? 'apply' : 'preview'); return b.confirm ? gate.p : ok({ preview: MCP_PREVIEW }); },
  });
  await review.open();
  $(doc, '.mk-upd-go').click();
  await settle();
  window.location.hash = '#models';
  window.dispatchEvent(new window.Event('hashchange'));
  await settle();
  window.location.hash = '#marketplace/installed';
  const reopening = review.open();
  await settle();
  assert.deepEqual(log, ['preview', 'apply'], 'no preview of a plugin while its apply is out');
  assert.equal(doc.getElementById('mk-sheet').getAttribute('aria-busy'), 'true');
  doc.getElementById('mk-sheet').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
  assert.equal(review.isOpen(), true, 'Escape waits while updates apply');
  gate.resolve(ok({ ok: true, updated: true }));
  await reopening;
  assert.deepEqual(log, ['preview', 'apply', 'preview']);
  assert.equal(doc.getElementById('mk-sheet').getAttribute('aria-busy'), null);
});

test('"Update <plugin> only" waits until every card has previewed (LC-P6-5)', async () => {
  const gate = deferred();
  const { doc, review } = setup([MCP_ROW, SRC_ROW], {
    'POST /api/plugins/atlassian-mcp/update': ok({ preview: MCP_PREVIEW }),
    'POST /api/plugins/github-source/update': () => gate.p,
  });
  const opening = review.open();
  await settle();
  assert.equal($(doc, '.mk-upd-only').hidden, true, 'no apply beside a preview still out');
  gate.resolve(ok({ preview: SRC_PREVIEW }));
  await opening;
  assert.equal($(doc, '.mk-upd-only').textContent, 'Update atlassian-mcp only');
});

test('a preview without a candidateSha is a failed preview, never a card applied unbound', async () => {
  const { doc, review } = setup([MCP_ROW], { 'POST /api/plugins/atlassian-mcp/update': ok({ preview: { ...MCP_PREVIEW, candidateSha: null } }) });
  await review.open();
  assert.deepEqual(chips(cardOf(doc, 'atlassian-mcp')), ['Preview failed']);
  assert.equal(cardOf(doc, 'atlassian-mcp').querySelector('.mk-upd-err .mk-wash-text').textContent, 'update preview failed');
});

test('focus: Done takes it when the run ends; closing with the opener gone parks it on the Installed tab, never <body>', async () => {
  const { doc, review } = setup([MCP_ROW], both());
  const tab = Object.assign(doc.createElement('a'), { href: '#marketplace/installed', className: 'tab mk-tab' });
  tab.dataset.tab = 'installed';
  doc.body.prepend(tab);
  const opener = doc.getElementById('opener');
  await review.open(null, { opener });
  $(doc, '.mk-upd-go').focus();
  $(doc, '.mk-upd-go').click();
  await settle();
  assert.deepEqual([$(doc, '.mk-upd-go').textContent, doc.activeElement === $(doc, '.mk-upd-go')], ['Done', true]);
  opener.remove();                                     // the reload took the opener's row away
  $(doc, '.mk-upd-go').click();
  await settle();
  assert.deepEqual([review.isOpen(), doc.activeElement === tab], [false, true]);
});

test('focus inside a card that repaints during a run (its apply starts, then lands) stays in that card, never on <body>', async () => {
  const gate = deferred();
  const B = { ...MCP_ROW, name: 'b-mcp' };
  const { window, doc, review } = setup([MCP_ROW, B, SRC_ROW], {
    'POST /api/plugins/atlassian-mcp/update': (b) => (b.confirm ? gate.p : ok({ preview: MCP_PREVIEW })),
    'POST /api/plugins/b-mcp/update': (b) => (b.confirm ? ok({ ok: true, updated: true }) : ok({ preview: MCP_PREVIEW })),
    'POST /api/plugins/github-source/update': (b) => (b.confirm ? ok({ ok: true, updated: true }) : ok({ preview: SRC_PREVIEW })),
  });
  await review.open();
  tick(window, cardOf(doc, 'github-source').querySelector('input.mk-reviewed'));
  $(doc, '.mk-upd-go').focus();
  $(doc, '.mk-upd-go').click();
  await settle();
  cardOf(doc, 'atlassian-mcp').querySelector('.mk-disc').focus();   // Tab into the card that is applying (Include and the ticks stay live, LC-P6-25)
  gate.resolve(ok({ ok: true, updated: true }));
  await settle(4);
  assert.equal(doc.activeElement, cardOf(doc, 'atlassian-mcp').querySelector('.mk-disc'), 'the applied card: its commits button keeps it');
  const g2 = deferred();
  const s = setup([MCP_ROW, B, SRC_ROW], {
    'POST /api/plugins/atlassian-mcp/update': (b) => (b.confirm ? g2.p : ok({ preview: MCP_PREVIEW })),
    'POST /api/plugins/b-mcp/update': (b) => (b.confirm ? ok({ ok: true, updated: true }) : ok({ preview: MCP_PREVIEW })),
    'POST /api/plugins/github-source/update': (b) => (b.confirm ? ok({ ok: true, updated: true }) : ok({ preview: SRC_PREVIEW })),
  });
  await s.review.open();
  tick(s.window, cardOf(s.doc, 'github-source').querySelector('input.mk-reviewed'));
  $(s.doc, '.mk-upd-go').click();
  await settle();
  cardOf(s.doc, 'b-mcp').querySelector('input.mk-include').focus();                  // a later card's Include, left ticked
  g2.resolve(ok({ ok: true, updated: true }));
  await settle(20);
  assert.deepEqual([...s.doc.querySelectorAll('#mk-sheet .mk-upd')].map((c) => c.dataset.state), ['done', 'done', 'done']);
  assert.equal(s.doc.activeElement, cardOf(s.doc, 'b-mcp').querySelector('.mk-disc'), 'a card whose Include left with its repaint: its commits button');
});

test('a reopen while an earlier run still applies puts focus inside the sheet (P3\'s Close is held), never behind it', async () => {
  const gate = deferred();
  const { window, doc, review } = setup([MCP_ROW], {
    'POST /api/plugins/atlassian-mcp/update': (b) => (b.confirm ? gate.p : ok({ preview: MCP_PREVIEW })),
  });
  const opener = doc.getElementById('opener');
  await review.open(null, { opener });
  $(doc, '.mk-upd-go').click();
  await settle();
  window.location.hash = '#models';
  window.dispatchEvent(new window.Event('hashchange'));
  await settle();
  window.location.hash = '#marketplace/installed';
  opener.focus();
  const reopening = review.open(null, { opener });
  await settle();
  assert.equal(doc.getElementById('mk-sheet-host').contains(doc.activeElement), true, 'focus is inside the busy sheet');
  gate.resolve(ok({ ok: true, updated: true }));
  await reopening;
  assert.equal(doc.getElementById('mk-sheet-host').contains(doc.activeElement), true);
});

test('SM70: an open asked for after the person left #marketplace (a late P5 hand-over) opens nothing and previews nothing', async () => {
  const { window, doc, calls, review } = setup([MCP_ROW], both());
  window.location.hash = '#runs';
  await review.open(['atlassian-mcp']);
  assert.deepEqual([review.isOpen(), doc.getElementById('mk-sheet-host').classList.contains('hidden'), calls], [false, true, []]);
  window.location.hash = '#marketplace/installed';
  await review.open(['atlassian-mcp']);
  assert.equal(review.isOpen(), true, 'back on the page, it opens');
});
