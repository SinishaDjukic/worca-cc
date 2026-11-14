// test/stillhet-chat-app-host-3.test.mjs — Chat in the app host, live kind, part 3 of 4 (jsdom, the app's scripts in
// boot.js's order, data-adapter="live"); the host and its helpers are test/helpers/stillhet-chat-live-host.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { LISTS, SOURCES, THREAD, clone, go, liveHost, posts, saidText, settle, toastText, withRun, closeHosts } from './helpers/stillhet-chat-live-host.mjs';

afterEach(closeHosts);   // each test's window closes when the test ends
test('panel.answer-refs: a run Worca names is a RefChip once dev confirms it, and it lands on the card in the chat that started it; an unconfirmed id stays words', async () => {
  const said = { thread: { id: 'ask_2', title: 'Writing' }, messages: [{ id: 'w1', role: 'assistant', status: 'done', text: 'It is the same as 0a1b2c3d, not 9f9f9f9f.', createdAt: THREAD.messages[0].createdAt, blocks: [] }], runLinks: [], inFlight: null };
  const { w, d, calls } = await liveHost({ thread: (url) => (url.endsWith('ask_2') ? [200, said] : [200, THREAD]), write: (url) => (url === '/api/ask/refs/resolve' ? [200, { refs: { 'run:0a1b2c3d': { ok: true, kind: 'run', id: 'pa', runId: 'run-a', title: 'Ask me', status: 'running' }, 'run:9f9f9f9f': { ok: false } } }] : [200, {}]) });
  await go(w, '#chat/ask_2', 120);
  assert.ok(calls.some((c) => c.url === '/api/ask/refs/resolve'), 'dev\'s resolve is asked');
  const chip = d.querySelector('#route-chat .convo-words [data-ref-run]');
  assert.ok(chip, 'a RefChip in Worca\'s words');
  assert.equal(chip.textContent, 'Ask me');
  assert.match(d.querySelector('#route-chat .convo-words').textContent, /not 9f9f9f9f\./, 'an unconfirmed id stays words');
  chip.click(); await settle(60);
  assert.equal(w.location.hash, '#chat/ask_1', 'the chat that started it');
});

test('chatOfTask in the live kind: the starting chat by the run links, an archived one too; a run id never falls back to a title', async () => {
  const src = clone(SOURCES);
  src.threads.threads[0].archivedAt = src.threads.threads[0].updatedAt;
  const { w } = await liveHost({ sources: src });
  assert.equal(w.RailConversation.chatOfTask({ run: 'pa' }), 'ask_1', 'by pipeline id too');
  assert.equal(w.RailConversation.chatOfTask({ run: 'run-a' }), 'ask_1');
  assert.equal(w.RailConversation.chatOfTask({ run: 'run-zzz', title: 'Ask me' }), '');
});

test('a Shaper run\'s plan waiting for you is a live PlanCard under its TaskCard: Approve and Ask for changes are dev\'s plan answer (R-fit-5)', async () => {
  const plan = { id: 'q1', kind: 'plan', plan: { title: 'CSV plan', summary: 'Two slices, then one PR', perspectives: ['Product', 'Security'] } };
  const { w, d, calls } = await liveHost({ sources: withRun({ pendingQuestion: plan }) });
  await go(w, '#chat/ask_1');
  const card = d.querySelector('#route-chat [data-anchor="plan-card_run"]');
  assert.ok(card, 'the PlanCard is drawn');
  assert.match(card.textContent, /CSV plan/);
  assert.match(card.textContent, /Two slices, then one PR/);
  d.querySelector('#route-chat [data-lplan-changes="card_run"]').click(); await settle(10);
  const field = d.querySelector('#route-chat [data-ask-changes="card_run"]');
  field.value = 'Keep it to one slice'; field.dispatchEvent(new w.Event('input', { bubbles: true }));
  d.querySelector('#route-chat [data-changes-send="card_run"]').click(); await settle(40);
  d.querySelector('#route-chat [data-lplan-approve="card_run"]').click(); await settle(40);
  assert.deepEqual(posts(calls), [
    ['POST', '/api/runs/run-a/answer', { id: 'q1', decision: 'revise', feedback: 'Keep it to one slice' }],
    ['POST', '/api/runs/run-a/answer', { id: 'q1', decision: 'approve' }],
  ]);
});

test('panel.plan-folds: the live PlanCard draws dev\'s role verdicts, coverage under Read the plan, Fix all in its ⋯ and its open decisions; the picks ride the answer', async () => {
  const roleReviews = { rounds: [{ pass: 1, target: 'plan', roles: [{ key: 'product', label: 'Product', findings: [] }, { key: 'qa', label: 'QA', findings: [{ id: 'f1', severity: 'major', status: 'open' }] }], conflicts: [{ id: 'conflict-1', question: 'One PR or two?', options: ['One PR', 'Two PRs'], roles: ['product', 'qa'] }] }] };
  const plan = { id: 'q1', kind: 'plan', plan: { title: 'CSV plan', summary: 'Two slices', revisable: true, roleReviews, check: { ok: false, items: [{ id: 'tests', label: 'Has a test plan', pass: false }] },
    coverage: { ok: false, passed: 1, total: 2, items: [{ id: 'R-1', label: 'R-1 · covered by Step 2', pass: true }, { id: 'R-2', label: 'R-2 · not covered by any step', pass: false, detail: 'Totals stay right' }] } } };
  const { w, d, calls } = await liveHost({ sources: withRun({ pendingQuestion: plan }), write: (url) => (url.endsWith('/plan') ? [200, { text: '## Steps' }] : [200, {}]), lists: { ...LISTS, '/api/runs/run-a/plan': { text: '## Steps' } } });
  await go(w, '#chat/ask_1');
  const card = () => d.querySelector('#route-chat [data-anchor="plan-card_run"]');
  assert.match(card().textContent, /Reviewed by Product, QA · 1 open · 1 to fix/, 'the roles\' verdicts, not the perspective names');
  assert.doesNotMatch(card().textContent, /Totals stay right/, 'coverage is folded');
  d.querySelector('#route-chat [data-lplan-full="card_run"]').click(); await settle(40);
  assert.match(card().textContent, /Requirements 1 of 2 covered[\s\S]*R-2 · Totals stay right not covered by any step/);
  assert.match(d.getElementById('route-chat').textContent, /One PR or two\?/, 'the open decision is an OptionList under the card');
  d.querySelector('#route-chat [data-lplan-pick="card_run|conflict-1|1"]').click(); await settle(10);
  d.querySelector('#route-chat [data-menu="lplan:card_run"]').click(); await settle(5);
  d.querySelector('#route-chat [data-menu-pick="lplan:card_run|fix"]').click(); await settle(40);
  const fix = posts(calls).at(-1);
  assert.deepEqual([fix[0], fix[1], fix[2].decision, fix[2].source, fix[2].conflicts], ['POST', '/api/runs/run-a/answer', 'revise', 'check', [{ id: 'conflict-1', choice: 'Two PRs' }]]);
  assert.match(fix[2].feedback, /Has a test plan/); assert.match(fix[2].feedback, /R-2: Totals stay right/);
  d.querySelector('#route-chat [data-lplan-approve="card_run"]').click(); await settle(40);
  assert.deepEqual(posts(calls).at(-1), ['POST', '/api/runs/run-a/answer', { id: 'q1', decision: 'approve', conflicts: [{ id: 'conflict-1', choice: 'Two PRs' }] }]);
});

test('panel.plan-folds: a run in a feature shows the feature\'s total cost and time in its folded Figures, from dev\'s run-groups', async () => {
  const { w, d } = await liveHost({ lists: { ...LISTS, '/api/run-groups': { groups: [{ id: 'f1', kind: 'feature', title: 'CSV', planning: null, members: [{ pipelineId: 'pa', position: 1 }, { pipelineId: 'h1', position: 2 }], cost: { usd: 3.5, byPipeline: {} } }] } } });
  await go(w, '#chat/ask_1', 120);
  const figs = d.querySelector('#route-chat [data-figs]');
  assert.ok(figs, 'the Figures fold is offered');
  figs.click(); await settle(60);
  assert.match(d.getElementById('route-chat').textContent, /\$3\.50\s*the feature so far/);
  assert.match(d.getElementById('route-chat').textContent, /since its first task · 2 tasks/);
});

test('panel.ship-card: a feature\'s ship marks each requirement (dev\'s acceptance PUT), ships one PR or stacked (dev\'s feature ship), and Create PR waits for every mark', async () => {
  let marked = false;
  const shipBlock = () => ({ kind: 'card', id: 'card_ship', state: 'proposed', card: { type: 'ship', featureId: 'f1', title: 'CSV export', files: 7, suggested: 'one', acceptance: { agreed: [{ id: 'R-1', text: 'Totals' }, { id: 'R-2', text: 'ISO dates' }], entries: [{ id: 'R-1', mark: 'met' }, ...(marked ? [{ id: 'R-2', mark: 'dropped', reason: 'not needed' }] : [])] } } });
  const thread = () => ({ thread: { id: 'ask_2', title: 'Writing' }, messages: [{ id: 's1', role: 'assistant', status: 'done', text: '', createdAt: THREAD.messages[0].createdAt, blocks: [shipBlock()] }], runLinks: [], inFlight: null });
  const { w, d, calls } = await liveHost({ thread: (url) => (url.endsWith('ask_2') ? [200, thread()] : [200, THREAD]), write: (url) => { if (url.endsWith('/acceptance')) marked = true; return [200, {}]; } });
  await go(w, '#chat/ask_2');
  const go1 = () => d.querySelector('#route-chat [data-ship]');
  assert.equal(go1().disabled, true, 'one requirement is not marked yet');
  assert.match(go1().title, /1 left/);
  d.querySelector('#route-chat [data-menu="ship-card_ship-1"]').click(); await settle(5);
  d.querySelector('#route-chat [data-menu-pick="ship-card_ship-1|dropped"]').click(); await settle(10);
  d.querySelector('#route-chat [data-ship-why="card_ship"]').value = 'not needed';
  d.querySelector('#route-chat [data-ship-why-save="card_ship"]').click(); await settle(60);
  assert.deepEqual(posts(calls).at(-1), ['PUT', '/api/shape/features/f1/acceptance', { entries: [{ id: 'R-2', mark: 'dropped', reason: 'not needed' }] }]);
  assert.equal(go1().disabled, false, 'every requirement is marked: Create PR is on');
  d.querySelector('#route-chat [data-menu="shiphow-card_ship"]').click(); await settle(5);
  d.querySelector('#route-chat [data-menu-pick="shiphow-card_ship|as stacked PRs"]').click(); await settle(10);
  go1().click(); await settle(40);
  assert.deepEqual(posts(calls).at(-1), ['POST', '/api/shape/features/f1/ship', { mode: 'stacked' }]);
  assert.ok(!calls.some((c) => c.url === '/api/pr'), 'never the single-run PR route');
});

test('Settings › Chat › Delete all chats: dev\'s counts read fresh, the confirm says them, Delete all is dev\'s DELETE /api/ask/threads', async () => {
  const { w, d, calls } = await liveHost({ lists: { ...LISTS, '/api/ask/history': { threads: 3, worktrees: 1, attachments: 2, inFlight: 1 } }, write: (url, body, method) => (method === 'DELETE' && url === '/api/ask/threads' ? [200, { ok: true, removed: { threads: 3, worktrees: 1 }, failed: [] }] : [200, {}]) });
  await go(w, '#settings/ask', 120);
  const btn = [...d.querySelectorAll('[data-svdo]')].find((b) => /Delete all chats/.test(b.textContent));
  assert.ok(btn, 'the row\'s action is drawn');
  assert.ok(!btn.disabled);
  btn.click(); await settle(80);
  assert.ok(calls.some((c) => c.method === 'GET' && c.url === '/api/ask/history'), 'the counts are dev\'s, read now');
  assert.match(d.body.textContent, /Delete all 3 chats, with 1 worktree and 2 attachments\? 1 chat in progress will be stopped\./);
  const yes = d.querySelector('[data-confirm="yes"]');
  assert.ok(yes, 'its confirm');
  yes.click(); await settle(80);
  assert.deepEqual(posts(calls).filter((c) => c[1] === '/api/ask/threads'), [['DELETE', '/api/ask/threads', undefined]]);
  assert.match(toastText(d), /Deleted 3 chats and 1 worktree\./);
});

test('MCP off: the composer\'s Sets are dev\'s preview; a set switched off in a chat is dev\'s PATCH {mcpOff}', async () => {
  const { w, d, calls } = await liveHost({ write: (url) => (url === '/api/ask/mcp-preview' ? [200, { sets: [{ id: 'team-a', name: 'Team tools', members: 2, skills: 1 }, { id: 'empty', name: 'Empty', members: 0, skills: 0 }] }] : [200, {}]) });
  await go(w, '#chat/ask_1', 120);
  const picker = d.querySelector('#route-chat [data-menu="cp-sets"]');
  assert.ok(picker, 'the Sets picker is drawn');
  assert.match(picker.textContent, /Sets · 1/, 'only a set with a server or a skill counts');
  picker.click(); await settle(5);
  d.querySelector('#route-chat [data-menu-pick="cp-sets|team-a"]').click(); await settle(40);
  assert.deepEqual(posts(calls).filter((c) => c[0] === 'PATCH'), [['PATCH', '/api/ask/threads/ask_1', { mcpOff: { sets: ['team-a'], members: [] } }]]);
});

test('a live run\'s own question is answered under its TaskCard: a pick, your own words or Worca\'s picks, as dev\'s POST /api/answer', async () => {
  const ask = { id: 'q9', kind: 'questions', questions: [{ id: 'fmt', question: 'Which format?', options: ['CSV', 'XLSX'], recommended: 'XLSX' }] };
  const { w, d, calls } = await liveHost({ sources: withRun({ pendingQuestion: ask }) });
  await go(w, '#chat/ask_1');
  assert.match(d.querySelector('#route-chat [data-anchor="ask-card_run"]').textContent, /Which format\?/);
  d.querySelector('#route-chat [data-rq="card_run|0|0"]').click(); await settle(10);
  d.querySelector('#route-chat [data-rq-go="card_run"]').click(); await settle(40);
  d.querySelector('#route-chat [data-rq-picks="card_run"]').click(); await settle(40);
  assert.deepEqual(posts(calls), [
    ['POST', '/api/answer', { runId: 'run-a', id: 'q9', payload: { answers: [{ id: 'fmt', choice: 'CSV' }] } }],
    ['POST', '/api/answer', { runId: 'run-a', id: 'q9', payload: { answers: [{ id: 'fmt', choice: 'XLSX' }] } }],
  ]);
});

// ---- web UI review cycle 1: no fake success, deep links, ids dev can never hold, Undo, the chat's project ----
test('a chat opened by its address (a reload, a bookmark) is read and drawn, not Chat home', async () => {
  const { d, calls } = await liveHost({ hash: '#chat/ask_1' });
  await settle(60);
  assert.ok(calls.some((c) => c.method === 'GET' && c.url === '/api/ask/threads/ask_1'), 'the thread is read');
  const text = d.getElementById('route-chat').textContent;
  assert.match(text, /Add a CSV export/);
  assert.equal(d.querySelector('#route-chat [data-home]'), null, 'not Chat home');
});

test('an id dev can never hold (400 invalid thread id) reads as gone, with no Try again; dev\'s #chat/new is Chat home', async () => {
  const { w, d, calls } = await liveHost({ thread: (url) => (url.endsWith('/ask_1') ? [200, THREAD] : [400, { error: 'invalid thread id' }]) });
  await go(w, '#chat/does-not-exist');
  assert.match(d.getElementById('route-chat').textContent, /This chat no longer exists/);
  assert.equal(d.querySelector('#route-chat [data-thread-retry]'), null);
  assert.doesNotMatch(d.querySelector('#route-chat .convo-head').textContent, /No project|\+ Label/, 'a gone chat has nothing to label or place');
  calls.length = 0;
  await go(w, '#chat/new');
  assert.equal(w.location.hash, '#chat');
  assert.ok(d.querySelector('#route-chat [data-home]'), 'Chat home');
  assert.ok(!calls.some((c) => c.url.includes('/threads/new')), 'thread "new" is never asked for');
});

test('live chat labels: the picker lists the labels in use (GET /api/ask/labels); a change is PUT /api/ask/threads/:id/labels and the head and toast follow the answer', async () => {
  const sources = clone(SOURCES);
  sources.threads.threads[0].labels = ['infra'];
  let answer = [400, { error: '"a label": a label is at most 32 characters' }];
  const { w, d, calls } = await liveHost({ sources, lists: { ...LISTS, '/api/ask/labels': { labels: [{ label: 'billing', count: 2 }, { label: 'infra', count: 1 }] } },
    write: (url, body, method) => {
      if (method !== 'PUT' || url !== '/api/ask/threads/ask_1/labels') return [200, {}];
      if (answer[0] >= 300) return answer;
      sources.threads.threads[0].labels = body.labels;   // the server keeps them: the list's re-read brings them back
      return [200, { labels: body.labels, changed: true }];
    } });
  await go(w, '#chat/ask_1');
  const head = () => [...d.querySelectorAll('#route-chat .convo-head > .kind-chip')].map((e) => e.textContent).join(' ');   // the chips, not the open picker's rows
  assert.equal(head(), 'infra', 'the chat\'s stored labels');
  d.querySelector('#route-chat [data-menu="cl-label"]').click(); await settle(30);
  assert.ok(calls.some((c) => c.method === 'GET' && c.url === '/api/ask/labels'), 'the picker reads the labels in use');
  const rows = () => [...d.querySelectorAll('#route-chat [data-listtoggle^="label|"]')].map((e) => `${e.dataset.listtoggle.slice(6)}:${e.getAttribute('aria-checked')}`);
  assert.deepEqual(rows(), ['billing:false', 'infra:true']);
  // refused: one toast with the server's reason, nothing labelled
  d.querySelector('#route-chat [data-listtoggle="label|billing"]').click(); await settle(40);
  assert.deepEqual(posts(calls).at(-1), ['PUT', '/api/ask/threads/ask_1/labels', { labels: ['infra', 'billing'] }]);
  assert.equal(toastText(d), 'Could not label the chat: "a label": a label is at most 32 characters');
  assert.doesNotMatch(head(), /billing/);
  // ok: the head and the toast follow the answer
  answer = [200];
  d.querySelector('#route-chat [data-listtoggle="label|billing"]').click(); await settle(40);
  assert.match(head(), /billing/);
  assert.match(saidText(d), /Labelled billing/);
  // Enter makes a new one; taking one off is a PUT without it
  if (!d.querySelector('#route-chat #cl-label-q')) { d.querySelector('#route-chat [data-menu="cl-label"]').click(); await settle(30); }
  const q = d.querySelector('#route-chat #cl-label-q');
  q.value = 'Release'; q.dispatchEvent(new w.Event('input', { bubbles: true })); await settle(5);
  d.querySelector('#route-chat #cl-label-q').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settle(40);
  assert.deepEqual(posts(calls).at(-1)[2], { labels: ['infra', 'billing', 'release'] });
  assert.match(saidText(d), /Labelled release/);
  if (!d.querySelector('#route-chat [data-listtoggle="label|infra"]')) { d.querySelector('#route-chat [data-menu="cl-label"]').click(); await settle(30); }
  d.querySelector('#route-chat [data-listtoggle="label|infra"]').click(); await settle(40);
  assert.deepEqual(posts(calls).at(-1)[2], { labels: ['billing', 'release'] });
  assert.match(saidText(d), /Removed the label infra/);
  await settle(300);
  assert.ok(calls.filter((c) => c.url === '/api/ask/threads?show=all').length >= 2, 'the list is read again after a change');
  assert.equal(head(), 'billing release', 'the re-read list keeps what the server stored');
});
