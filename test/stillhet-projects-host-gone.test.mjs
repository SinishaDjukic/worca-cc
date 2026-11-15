// Stillhet Projects, live (F-6-18 follow-up): a project page is never stuck on Loading. While the store's projects part
// loads, the page may wait; once it has loaded, a key it does not list is the not-found page, and nothing is read under it.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { projectsHost, gate, settle, closeHosts } from './helpers/stillhet-projects-host.mjs';
import { SOURCES } from './helpers/stillhet-chat-live-host.mjs';

afterEach(closeHosts);
const NOPE = 'nope-00000000';
const until = async (f, ms = 8000) => { for (let t = 0; t < ms && !f(); t += 50) await settle(50); };

test('F-6-18: a project address the loaded store does not list says There is no project called …, never Loading, and reads nothing', async () => {
  const g = gate();
  const h = await projectsHost({ hash: `#projects/${NOPE}`, hold: (u) => (u === '/api/projects' ? g.p : null) });
  const under = () => h.calls.filter((c) => c.url.includes(NOPE)).length;
  assert.equal(under(), 0, 'while the list loads: nothing is read under it');
  g.open(); await settle(100);
  h.sockets.at(-1)?.onmessage({ data: JSON.stringify({ type: 'hello', bootId: 'b', runs: SOURCES.hello.runs }) });   // the socket opens after the first load
  await until(() => /There is no project called/.test(h.d.body.textContent));
  assert.match(h.d.body.textContent, new RegExp(`There is no project called ${NOPE}`), 'loaded and not listed: the not-found page');
  assert.ok(!/Reading its settings|Loading/.test(h.d.getElementById('route-place')?.hidden ? '' : h.d.getElementById('route-place').textContent), 'not stuck on Loading');
  assert.equal(under(), 0, 'and no read under a key the store does not list');
});
