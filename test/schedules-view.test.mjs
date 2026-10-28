// test/schedules-view.test.mjs — the view's ticket accessors: every model ticket (upcoming() drops
// the ones more than a window out), an optimistic upsert by id, and a forget.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/#schedules' });
for (const k of ['document', 'location', 'DOMParser']) Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });
const { createSchedulesView } = await import('../ui/public/schedules-view.mjs');

const summary = { target: 'project', workflowId: 'wf_default', prompt: 'p', source: null, sourceBranch: null, mock: false };
const ticketAt = (id, ms, extra = {}) => ({ id, kind: 'once', scheduleId: null, title: id, runAt: new Date(Date.now() + ms).toISOString(),
  scheduledFor: new Date(Date.now() + ms).toISOString(), status: 'scheduled', ifMissed: 'run', graceMin: 360, summary, ...extra });
const SOON = ticketAt('t_soon', 3600_000);
const WEEK = ticketAt('t_week', 3 * 86400_000, { resumePipelineId: 'p_1' });

async function mount(extra = {}) {
  globalThis.fetch = async (url) => {
    const key = String(url).split('?')[0];
    const body = key === '/api/schedules' ? { schedules: [], tickets: [SOON, WEEK], counts: {}, ...extra } : { notifications: [], unread: 0 };
    return { ok: true, status: 200, json: async () => body };
  };
  const host = () => document.createElement('div');
  const hosts = { feedHost: host(), onceHost: host(), repeatingHost: host() };
  document.body.replaceChildren(hosts.feedHost, hosts.onceHost, hosts.repeatingHost);
  const view = createSchedulesView({ ...hosts, msgEl: document.createElement('p'), deps: { confirmModal: async () => true, targetLabel: () => '', workflowLabel: () => '' } });
  await view.load();
  return view;
}

test('tickets() lists every model ticket, including ones upcoming() leaves out', async () => {
  const view = await mount();
  try {
    assert.deepEqual(view.tickets().map((t) => t.id), ['t_soon', 't_week']);
    assert.deepEqual(view.upcoming(86400_000).map((t) => t.id), ['t_soon'], 'upcoming() drops a ticket more than 24h out');
  } finally { view.destroy(); }
});

test('noteTicket() upserts by id; forgetTicket() removes one', async () => {
  const view = await mount();
  try {
    view.noteTicket({ ...WEEK, status: 'firing' });
    assert.equal(view.tickets().length, 2, 'same id: replaced, not appended');
    assert.equal(view.tickets().find((t) => t.id === 't_week').status, 'firing');
    view.noteTicket(ticketAt('t_new', 7200_000, { resumePipelineId: 'p_2' }));
    assert.deepEqual(view.tickets().map((t) => t.id), ['t_soon', 't_week', 't_new']);
    view.forgetTicket('t_week');
    assert.deepEqual(view.tickets().map((t) => t.id), ['t_soon', 't_new']);
    view.forgetTicket('nope');
    assert.equal(view.tickets().length, 2, 'an unknown id is a no-op');
  } finally { view.destroy(); }
});

test('chains() is empty without a server list, and reflects the loaded chains otherwise', async () => {
  const bare = await mount();
  try {
    assert.deepEqual(bare.chains(), []);
  } finally { bare.destroy(); }
  const chains = [{ id: 'c_1', tickets: ['t_soon', 't_week'] }];
  const view = await mount({ chains });
  try {
    assert.deepEqual(view.chains(), chains);
    assert.equal(view.chains(), view.chains(), 'the same array until the next load()');
  } finally { view.destroy(); }
});

test('a row that follows a preset names it; a deleted preset says the next run will fail', async () => {
  const live = ticketAt('t_preset', 3600_000, { presetId: 'rp_aaaaaaaaaaaa', presetName: 'Quick fix' });
  const gone = ticketAt('t_gone', 7200_000, { presetId: 'rp_bbbbbbbbbbbb', presetName: null, presetGoneName: 'Old fix' });
  const view = await mount({ tickets: [live, gone] });
  try {
    const text = document.body.textContent;
    assert.match(text, /preset Quick fix/);
    assert.match(text, /Quick fix \(read when the run starts\)/);
    assert.match(text, /preset deleted/);
    assert.match(text, /Old fix \(deleted: the next run will fail\)/);
  } finally { view.destroy(); }
});

test('run 4 D22: feed messages read as plain words; the raw detail is kept for the tooltip', async () => {
  const { plainFeedMessage } = await import('../ui/public/schedules-view.mjs');
  assert.deepEqual(plainFeedMessage('paused (drain): Paused while worca was stopping'),
    { text: 'paused · worca was stopping', detail: 'Paused while worca was stopping' });
  assert.deepEqual(plainFeedMessage("paused (usage limit): You've hit your usage limit — resume on Claude, Copilot or Cursor to continue now."),
    { text: 'paused · usage limit reached. Resume on Claude, Copilot or Cursor to continue now.', detail: "You've hit your usage limit" });
  assert.deepEqual(plainFeedMessage('paused (usage limit). resume on Claude to continue now.'),
    { text: 'paused · usage limit reached. Resume on Claude to continue now.', detail: '' });
  assert.deepEqual(plainFeedMessage('ended with an error: spawn ENOENT'), { text: 'ended with an error', detail: 'spawn ENOENT' });
  assert.deepEqual(plainFeedMessage('could not start: project not found.'), { text: 'could not start', detail: 'project not found' });
  assert.deepEqual(plainFeedMessage('finished.'), { text: 'finished.', detail: '' });
  assert.deepEqual(plainFeedMessage('paused (something new): x'), { text: 'paused', detail: 'x' });
});
