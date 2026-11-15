// test/stillhet-classic-extras-chat-host.test.mjs — COV-3 (#1390) in a live chat: classic's chat extras on dev's own routes.
// A YouTurn's file chip opens the attachment; a FilesCard's Download saves it and its Show in ‹file manager› shows only
// when the server offers it; a run question's files open by index; a proposal's files ride Start as extras; a TaskCard ⋯
// Restore. Live app host (jsdom): the conversation's controls are the subject.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, clone, SOURCES, THREAD, posts, toastText } from './helpers/stillhet-chat-live-host.mjs';

const realOpen = globalThis.open, realDoc = globalThis.document;
// chat-live.mjs runs as a Node module here: its new tab is globalThis.open and its saved file a link in globalThis.document
afterEach(() => { closeHosts(); globalThis.open = realOpen; globalThis.document = realDoc; });
const root = (d) => d.querySelector('#route-chat');
// ask_1's thread with a files card from Worca after its proposal (dev's `files` card: items with their attachment ids)
function thread() {
  const t = clone(THREAD);
  t.messages.push({ id: 'm5', role: 'assistant', text: 'Here are the files', status: 'done', createdAt: t.messages[2].createdAt, blocks: [{ kind: 'card', id: 'card_files', state: 'shown', card: { type: 'files', title: 'The export', items: [{ name: 'out.csv', kind: 'file', bytes: 2048, attId: 'att2' }, { name: 'chart.png', kind: 'image', bytes: 900, attId: 'att3' }] } }] });
  return t;
}
const threadOf = (t) => (u) => (u === '/api/ask/threads/ask_1' ? [200, t] : [404, {}]);
const opened = () => { const out = []; globalThis.open = (u) => { out.push(u); return {}; }; return out; };

test('COV-3 #5: a YouTurn\'s attached file is a chip that opens the attachment in a new tab', async () => {
  const h = await liveHost({ thread: threadOf(thread()) });
  const tabs = opened(h.w);
  await go(h.w, '#chat/ask_1', 120);
  const chip = root(h.d).querySelector('.convo-you button.kind-chip');
  assert.ok(chip, 'a chip button');
  assert.match(chip.textContent, /spec\.md/);
  chip.click(); await settle(30);
  assert.deepEqual(tabs, ['/api/ask/threads/ask_1/attachments/att1']);
});

test('COV-3 #8: FilesCard Download saves the file under its name, without a tab', async () => {
  const h = await liveHost({ thread: threadOf(thread()) });
  const tabs = opened(h.w);
  const saved = [];
  h.w.HTMLAnchorElement.prototype.click = function () { saved.push([this.getAttribute('href'), this.download]); };
  globalThis.document = h.d;
  await go(h.w, '#chat/ask_1', 120);
  root(h.d).querySelector('[data-file-dl^="att2|"]').click(); await settle(30);
  assert.deepEqual(saved, [['/api/ask/threads/ask_1/attachments/att2', 'out.csv']]);
  assert.deepEqual(tabs, [], 'no tab');
});

test('COV-3 #9: Show in Finder when the probe says available; a refusal says why; none when the server offers none', async () => {
  const h = await liveHost({ thread: threadOf(thread()), read: (u) => (u === '/api/ask/reveal' ? [200, { available: true, label: 'Finder' }] : null),
    write: (u, b) => (/\/reveal$/.test(u) ? [409, { error: 'It was not shown from a folder', code: 'NO_SOURCE' }] : [200, {}]) });
  await go(h.w, '#chat/ask_1', 200);
  const shows = [...root(h.d).querySelectorAll('.files-card button')].filter((b) => b.textContent.trim() === 'Show in Finder');
  assert.equal(shows.length, 2, 'one per file');
  shows[0].click(); await settle(60);
  assert.ok(posts(h.calls).some(([m, u, b]) => m === 'POST' && u === '/api/ask/threads/ask_1/attachments/att3/reveal' && JSON.stringify(b) === '{}') || posts(h.calls).some(([m, u]) => m === 'POST' && /attachments\/att[23]\/reveal$/.test(u)));
  assert.match(toastText(h.d), /Could not show it in its folder: It was not shown from a folder/);
  assert.equal(h.calls.filter((c) => c.url === '/api/ask/reveal').length, 1, 'the probe is read once');
  const n = await liveHost({ thread: threadOf(thread()), read: (u) => (u === '/api/ask/reveal' ? [200, { available: false, label: null }] : null) });
  await go(n.w, '#chat/ask_1', 200);
  assert.ok(root(n.d).querySelector('.files-card'));
  assert.ok(![...root(n.d).querySelectorAll('.files-card button')].some((b) => /^Show in/.test(b.textContent.trim())), 'not offered');
});

test('COV-3 #2: a run question\'s files are drawn above its Answer row; View opens the file by its index', async () => {
  const s = clone(SOURCES);
  s.hello.runs = s.hello.runs.map((r) => (r.runId === 'run-a' ? { ...r, pendingQuestion: { id: 'q1', askId: 'tok_1', questions: [{ question: 'Which format?', options: ['CSV', 'TSV'] }], files: [{ index: 0, name: 'mock.png', mime: 'image/png' }, { index: 1, name: 'notes.txt', mime: 'text/plain' }] } } : r));
  const h = await liveHost({ sources: s, thread: threadOf(thread()) });
  const tabs = opened(h.w);
  await go(h.w, '#chat/ask_1', 200);
  const card = [...root(h.d).querySelectorAll('.files-card')].find((c) => c.getAttribute('aria-label') === 'Its files');
  assert.ok(card, 'Its files');
  const box = card.closest('[data-anchor^="ask-"]');
  assert.ok(box && card.compareDocumentPosition(box.querySelector('[data-rq-go]')) & 4, 'above the Answer row');
  assert.doesNotMatch(card.innerHTML, /Download/, 'view only, as classic');
  [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'View').click(); await settle(30);
  assert.deepEqual(tabs, ['/api/runs/run-a/ask-files/tok_1/1']);
});

test('COV-3 #6: a proposal draws the files of the message it answers; × removes one; Start sends the rest as extras', async () => {
  const t = thread();
  t.messages[0].blocks.push({ kind: 'attachment', id: 'att9', name: 'logo.svg', bytes: 4, attKind: 'text' });
  const h = await liveHost({ thread: (u) => (u === '/api/ask/threads/ask_1' ? [200, t] : u === '/api/ask/threads/ask_1/attachments/att1' ? [200, 'spec!'] : [404, {}]), write: () => [200, { runId: 'r9' }] });
  await go(h.w, '#chat/ask_1', 150);
  root(h.d).querySelector('[data-pp-more="card_prop"]').click(); await settle(30);
  const chips = () => [...root(h.d).querySelectorAll('[data-pp-unfile^="card_prop|"]')].map((b) => b.textContent.trim());
  assert.deepEqual(chips(), ['spec.md', 'logo.svg']);
  root(h.d).querySelector('[data-pp-unfile="card_prop|att9"]').click(); await settle(20);
  assert.deepEqual(chips(), ['spec.md']);
  root(h.d).querySelector('[data-pp-start="card_prop"]').click(); await settle(80);
  const run = h.calls.find((c) => c.url === '/api/run');
  assert.deepEqual(run.body.extras, [{ name: 'spec.md', dataBase64: Buffer.from('spec!').toString('base64') }]);
  assert.equal(h.calls.filter((c) => /attachments\/att9/.test(c.url)).length, 0, 'a removed file is not read');
});

test('COV-3 #6: a file that cannot be read posts no run and says which', async () => {
  const h = await liveHost({ thread: (u) => (u === '/api/ask/threads/ask_1' ? [200, thread()] : [404, { error: 'attachment not found' }]), write: () => [200, { runId: 'r9' }] });
  await go(h.w, '#chat/ask_1', 150);
  root(h.d).querySelector('[data-pp-start="card_prop"]').click(); await settle(80);
  assert.equal(h.calls.filter((c) => c.url === '/api/run').length, 0);
  assert.match(toastText(h.d), /Could not start the task: could not read attachment spec\.md/);
});

test('COV-3 #3: a running task\'s card offers no Restore', async () => {
  const h = await liveHost({ thread: threadOf(thread()) });
  await go(h.w, '#chat/ask_1', 150);
  root(h.d).querySelector('[data-menu^="card:"]').click(); await settle(10);
  assert.ok(![...root(h.d).querySelectorAll('[data-menu-pick]')].some((x) => /\|Restore$/.test(x.dataset.menuPick)), 'a running task offers no Restore');
});

test('COV-3 #6: × removes the file by its id: two files of one name, and a name with "|", each go alone', async () => {
  const t = thread();
  t.messages[0].blocks.push({ kind: 'attachment', id: 'att8', name: 'spec.md', bytes: 4, attKind: 'text' }, { kind: 'attachment', id: 'att9', name: 'a|b.txt', bytes: 4, attKind: 'text' });
  const h = await liveHost({ thread: threadOf(t) });
  await go(h.w, '#chat/ask_1', 150);
  root(h.d).querySelector('[data-pp-more="card_prop"]').click(); await settle(30);
  const chips = () => [...root(h.d).querySelectorAll('[data-pp-unfile^="card_prop|"]')].map((b) => `${b.dataset.ppUnfile}:${b.textContent.trim()}`);
  assert.deepEqual(chips(), ['card_prop|att1:spec.md', 'card_prop|att8:spec.md', 'card_prop|att9:a|b.txt']);
  root(h.d).querySelector('[data-pp-unfile="card_prop|att8"]').click(); await settle(20);
  assert.deepEqual(chips(), ['card_prop|att1:spec.md', 'card_prop|att9:a|b.txt'], 'only the second spec.md goes');
  root(h.d).querySelector('[data-pp-unfile="card_prop|att9"]').click(); await settle(20);
  assert.deepEqual(chips(), ['card_prop|att1:spec.md'], 'a name with "|" goes too');
});

test('COV-3 #6: a proposal drawn before its message\'s files have ids picks them up when they arrive; a removed file stays removed', async () => {
  const t = thread(), att = t.messages[0].blocks.find((b) => b.kind === 'attachment'), id = att.id;
  delete att.id;   // the echo before the snapshot: the file has its name only
  const h = await liveHost({ thread: threadOf(t) });
  // back after a drop: the open chat is read again (the snapshot that brings the ids)
  const reread = async () => { h.sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'hello', bootId: 'b', runs: SOURCES.hello.runs }) }); await settle(150); };
  await go(h.w, '#chat/ask_1', 150);
  root(h.d).querySelector('[data-pp-more="card_prop"]').click(); await settle(30);
  const chips = () => [...root(h.d).querySelectorAll('[data-pp-unfile^="card_prop|"]')].map((b) => b.textContent.trim());
  assert.deepEqual(chips(), [], 'no id yet, no chip');
  att.id = id;
  await reread();
  assert.equal(h.calls.filter((c) => c.url === '/api/ask/threads/ask_1').length, 2, 'read again');
  assert.deepEqual(chips(), ['spec.md'], 'the files arrive');
  root(h.d).querySelector(`[data-pp-unfile="card_prop|${id}"]`).click(); await settle(20);
  await reread();
  assert.deepEqual(chips(), [], 'removed stays removed');
});
