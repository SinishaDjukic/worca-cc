import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { revalidate } from '../ui/public/requirements-attach/revalidate.mjs';
import { createAttachStore } from '../ui/public/requirements-attach/store.mjs';

const mkStore = (seqs = [3, 7]) => {
  const store = createAttachStore({ storage: null, key: 'k' });
  store.add(seqs.map((seq) => ({ seq, status: 'ready' })));
  return store;
};
const statuses = (store) => store.get().items.map((i) => [i.seq, i.status]);

describe('attach revalidate', () => {
  it('flag off: no network call, every item becomes unavailable', async () => {
    const store = mkStore();
    let calls = 0;
    const fetchJson = async () => {
      calls += 1;
      return {};
    };
    const r = await revalidate(store, fetchJson, { scopeType: 'project', scopeKey: 'p' }, false);
    assert.equal(calls, 0);
    assert.deepEqual(statuses(store), [[3, 'unavailable'], [7, 'unavailable']]);
    assert.deepEqual(r, { ok: true, changed: true });
  });

  it('flag may be a function', async () => {
    const store = mkStore();
    await revalidate(store, async () => assert.fail('no fetch'), null, () => false);
    assert.deepEqual(statuses(store), [[3, 'unavailable'], [7, 'unavailable']]);
  });

  it('flag on: posts exactly the seqs and scope, applies statuses', async () => {
    const store = mkStore();
    let seen;
    const fetchJson = async (url, init) => {
      seen = { url, init };
      return { items: [{ seq: 3, status: 'archived', version: 2 }, { seq: 7, status: 'wrong_scope' }] };
    };
    const r = await revalidate(store, fetchJson, { scopeType: 'project', scopeKey: 'p1' });
    assert.equal(seen.url, '/api/requirements/attach/resolve');
    assert.equal(seen.init.method, 'POST');
    assert.deepEqual(JSON.parse(seen.init.body), { seqs: [3, 7], scopeType: 'project', scopeKey: 'p1' });
    assert.deepEqual(statuses(store), [[3, 'archived'], [7, 'wrong_scope']]);
    assert.equal(store.get().items[0].version, 2);
    assert.deepEqual(r, { ok: true, changed: true });
  });

  it('null scope sends no scope fields', async () => {
    const store = mkStore();
    let body;
    await revalidate(store, async (_u, init) => {
      body = JSON.parse(init.body);
      return { items: [] };
    }, null);
    assert.deepEqual(body, { seqs: [3, 7] });
  });

  it('items not returned keep their status; unchanged reports changed:false', async () => {
    const store = mkStore();
    const r = await revalidate(store, async () => ({ items: [{ seq: 3, status: 'ready' }] }), null);
    assert.deepEqual(statuses(store), [[3, 'ready'], [7, 'ready']]);
    assert.equal(r.changed, false);
  });

  it('empty store makes no call', async () => {
    const store = mkStore([]);
    const r = await revalidate(store, async () => assert.fail('no fetch'), null);
    assert.deepEqual(r, { ok: true, changed: false });
  });

  it('network error: ok:false, items untouched, no throw', async () => {
    const store = mkStore();
    const r = await revalidate(store, async () => {
      throw new Error('down');
    }, null);
    assert.deepEqual(r, { ok: false, changed: false });
    assert.deepEqual(statuses(store), [[3, 'ready'], [7, 'ready']]);
  });

  it('malformed response: ok:false, items untouched', async () => {
    const store = mkStore();
    for (const bad of [null, {}, { items: 'x' }, 'str']) {
      const r = await revalidate(store, async () => bad, null);
      assert.equal(r.ok, false);
    }
    assert.deepEqual(statuses(store), [[3, 'ready'], [7, 'ready']]);
  });

  it('an older response that arrives after a newer one does not overwrite it', async () => {
    const store = mkStore([3]);
    let release;
    const slow = new Promise((r) => { release = r; });
    const older = revalidate(store, async () => { await slow; return { items: [{ seq: 3, status: 'ok' }] }; }, { scopeType: 'project', scopeKey: 'old' });
    const newer = await revalidate(store, async () => ({ items: [{ seq: 3, status: 'wrong_scope' }] }), { scopeType: 'project', scopeKey: 'new' });
    assert.deepEqual(newer, { ok: true, changed: true });
    release();
    assert.deepEqual(await older, { ok: false, changed: false });
    assert.deepEqual(statuses(store), [[3, 'wrong_scope']]);
  });

  it('a flag-off pass supersedes an older flag-on response still in flight', async () => {
    const store = mkStore([3]);
    let release;
    const slow = new Promise((r) => { release = r; });
    const older = revalidate(store, async () => { await slow; return { items: [{ seq: 3, status: 'ok' }] }; }, { scopeType: 'project', scopeKey: 'p' }, true);
    await revalidate(store, async () => assert.fail('no fetch'), null, false);
    release();
    assert.deepEqual(await older, { ok: false, changed: false });
    assert.deepEqual(statuses(store), [[3, 'unavailable']]);
  });
});
