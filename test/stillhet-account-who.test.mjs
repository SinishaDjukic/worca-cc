// test/stillhet-account-who.test.mjs — who the account corner names (F-b23m2-01). A live Stillhet follows dev's rule
// (ui/public/account-menu.mjs describeAccount, kept in the library as R.describeAccount): GET /api/whoami once at boot; a
// shared sign-in names the person and has the identity card, an operator only its name, local, nobody or a failed call
// "Profile" with "P". Never a demo name on live. The demo keeps its demo people.
import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { describeAccount } from '../ui/public/design-system/components/index.mjs';
import { describeAccount as devDescribe } from '../ui/public/account-menu.mjs';
import { liveHost, settle, closeHosts } from './helpers/stillhet-chat-live-host.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';

afterEach(closeHosts);

const CASES = [null, {}, { name: 'local' }, { name: 'local', shared: false }, { name: ' ' }, { name: 'sam.rivera@acme.dev', shared: true, source: 'access' },
  { name: 'Dana Ruiz', shared: true, source: 'header' }, { name: 'Ops Person', shared: false, source: 'operator' }, { name: 'Someone', shared: false, source: 'env' }, { name: 'x' }];

test('the library\'s describeAccount is dev\'s rule, case by case', () => {
  for (const who of CASES) assert.deepEqual(describeAccount(who), devDescribe(who), JSON.stringify(who));
  assert.equal(describeAccount({ name: 'sam.rivera@acme.dev', shared: true }).initials, 'SR');
});

const corner = (d) => ({ name: d.querySelector('.pz-acct-name')?.textContent, ini: d.querySelector('.pz-ava')?.textContent });
async function live(answer) {
  const { w, d } = await liveHost({ read: (url) => (url === '/api/whoami' ? answer : null) });
  await settle(30);
  return { w, d };
}
const card = (d) => { d.querySelector('[data-acct]').click(); return d.querySelector('.acct-menu .id-card'); };

test('live, whoami says local: "Profile" and "P", no identity card', async () => {
  const { d } = await live([200, { name: 'local', shared: false, source: 'local' }]);
  assert.deepEqual(corner(d), { name: 'Profile', ini: 'P' });
  assert.equal(card(d), null);
});

test('live, a shared sign-in: the person\'s short name, initials and the identity card with its via', async () => {
  const { d } = await live([200, { name: 'pat.lee@example.org', shared: true, source: 'access' }]);
  assert.deepEqual(corner(d), { name: 'pat.lee', ini: 'PL' });
  const c = card(d);
  assert.ok(c, 'the identity card');
  assert.match(c.textContent, /pat\.lee@example\.org/);
  assert.match(c.textContent, /via Cloudflare Access/);
});

test('live, an operator name: its name and initials, no identity card', async () => {
  const { d } = await live([200, { name: 'Pat Lee', shared: false, source: 'operator' }]);
  assert.deepEqual(corner(d), { name: 'Pat Lee', ini: 'PL' });
  assert.equal(card(d), null);
});

test('live, whoami fails (an error or no answer): "Profile", never a demo name', async () => {
  for (const answer of [[500, {}], [0, {}]]) {
    const { d } = await live(answer);
    assert.deepEqual(corner(d), { name: 'Profile', ini: 'P' });
    assert.doesNotMatch(d.body.textContent, /Sam Rivera|Dana Ruiz/);
  }
});

test('the demo keeps its demo person', async () => {
  const w = stillhetHost({ hash: '#chat', after });
  await settle(60);
  assert.deepEqual(corner(w.document), { name: 'Sam Rivera', ini: 'SR' });
});
