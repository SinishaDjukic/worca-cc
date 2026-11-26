// test/helpers/os-store-fake.mjs — the OS key store fake for the secret vault tests. It ships nowhere (`test/` is
// not in package.json `files`); src/core/secrets/os-store.mjs imports it only under the test switch plus the
// node:test runner marker. One core, two backings: memory (createFakeOsStore) and a 0600 state file plus an
// append-only `.calls` JSONL (fileFakeOsStore), so a spawned process can reach the same fake. The call log
// records `{ op, pid }` only, never key bytes. The fake is keyed by OS item, like a real store: each store is bound
// to one item (`{ service, account }`, default account `default`), and one state file can hold many items. `probe`
// round-trips random bytes on its own probe item (default account `default-probe`); `failProbe` (FAIL_PROBE_MODES)
// makes it fail one way, and `keyReadBack: { differsFromCall: n }` (default 2) makes getKey return one other key from
// its n-th call on (counted over every getKey of the state, any item, any process).
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { writeJsonAtomic } from '../../src/core/json-atomic.mjs';

export const FAKE_STATES = ['available', 'unavailable', 'locked', 'item-missing', 'different-key', 'never-answers'];

export const FAIL_PROBE_MODES = ['set-locked', 'set-denied', 'timeout', 'wrong-value', 'missing', 'delete-failed'];

const OTHER_KEY = Buffer.alloc(32, 0x5a);
const READ_BACK_KEY = Buffer.alloc(32, 0x6b);
const never = () => new Promise(() => {});
const storeError = (code) => Object.assign(new Error(`fake OS store: ${code}`), { code });
const copy = (k) => (k ? Buffer.from(k) : null);

/**
 * The shared answer logic. `backing` gives `load() → { state, key, failSetKey, failProbe, keyReadBack, probe }`,
 * `saveKey(key)`, `dropKey()`, `saveProbe(bytes|null)`, `log(op)`, `getKeyCalls()` and `late(land)` (hold a 'late' setKey until
 * released).
 */
function fakeCore(backing) {
  return {
    kind: 'fake',
    async getKey() {
      backing.log('getKey');
      const { state, key, delayMs, keyReadBack } = backing.load();
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));   // a slow store: answers after delayMs
      if (state === 'unavailable' || state === 'locked') throw storeError(state);
      if (state === 'never-answers') return never();
      if (state === 'different-key') return copy(OTHER_KEY);
      if (keyReadBack && backing.getKeyCalls() >= (keyReadBack.differsFromCall ?? 2)) return copy(READ_BACK_KEY);
      return copy(key);
    },
    // Write random bytes to the probe item, read them back, compare, delete (also after a failed read).
    async probe() {
      backing.log('probe');
      const { state, failProbe } = backing.load();
      if (state === 'unavailable' || state === 'locked') throw storeError(state);
      if (state === 'never-answers' || failProbe === 'timeout') return never();
      if (failProbe === 'set-locked') throw storeError('locked');
      if (failProbe === 'set-denied') throw storeError('unavailable');
      const bytes = randomBytes(32);
      backing.saveProbe(bytes);
      let failure = null;
      const back = failProbe === 'missing' ? null : failProbe === 'wrong-value' ? Buffer.from(bytes.map((x) => x ^ 1)) : backing.load().probe;
      if (!back) failure = storeError('probe-missing');
      else if (!back.equals(bytes)) failure = storeError('probe-mismatch');
      if (failProbe === 'delete-failed') throw failure ?? storeError('probe-delete');
      backing.saveProbe(null);
      if (failure) throw failure;
      return undefined;
    },
    // Remove the bound item; true when one was there. A locked or unavailable state refuses.
    async deleteKey() {
      backing.log('deleteKey');
      const { state, key } = backing.load();
      if (state === 'unavailable' || state === 'locked') throw storeError(state);
      if (state === 'never-answers') return never();
      if (!key) return false;
      backing.dropKey();
      return true;
    },
    async setKey(key) {
      backing.log('setKey');
      const { state, key: held, failSetKey } = backing.load();
      if (failSetKey === 'locked') throw storeError('locked');
      if (failSetKey === 'never-answers') return never();
      if (failSetKey === 'drop') return undefined;
      // 'late': this one call lands only when the test calls landLate() (memory only), create-only as ever.
      if (failSetKey === 'late') return backing.late(() => { if (backing.load().key) throw storeError('exists'); backing.saveKey(copy(key)); });
      if (state === 'unavailable' || state === 'locked') throw storeError(state);
      if (state === 'never-answers') return never();
      if (held) throw storeError('exists'); // create-only: an existing item is never overwritten
      backing.saveKey(copy(key));
      return undefined;
    },
  };
}

function checkState(state) {
  if (!FAKE_STATES.includes(state)) throw new Error(`fake OS store: unknown state ${state}`);
  return state;
}

export const DEFAULT_ITEM = Object.freeze({ service: 'worca-cc', account: 'default' });
const accountOf = (item) => (typeof item === 'string' ? item : (item ?? DEFAULT_ITEM).account);

/**
 * In memory, bound to `item`. `calls` is the live call log; `setState` enters a state (item-missing drops the bound
 * item). The legacy `key` option sets the bound item's key.
 */
export function createFakeOsStore({ item = DEFAULT_ITEM, probeItem, state = 'available', key = null, failSetKey = null, failProbe = null,
  keyReadBack = null } = {}) {
  const account = accountOf(item);
  const probeAccount = probeItem ? accountOf(probeItem) : `${account}-probe`;
  const mem = { state: checkState(state), items: new Map(), failSetKey, failProbe, keyReadBack };
  if (key && state !== 'item-missing') mem.items.set(account, copy(key));
  const calls = [];
  const pending = [];
  const store = fakeCore({
    load: () => ({ state: mem.state, key: mem.items.get(account) ?? null, failSetKey: mem.failSetKey, failProbe: mem.failProbe,
      keyReadBack: mem.keyReadBack, probe: mem.items.get(probeAccount) ?? null }),
    saveKey: (k) => { mem.items.set(account, k); },
    dropKey: () => { mem.items.delete(account); },
    saveProbe: (b) => { if (b) mem.items.set(probeAccount, copy(b)); else mem.items.delete(probeAccount); },
    log: (op) => calls.push({ op, pid: process.pid }),
    getKeyCalls: () => calls.filter((c) => c.op === 'getKey').length,
    late: (land) => { mem.failSetKey = null; return new Promise((resolve, reject) => pending.push(() => { try { resolve(land()); } catch (e) { reject(e); } })); },
  });
  return Object.assign(store, {
    calls,
    /** Land every held 'late' setKey now. */
    async landLate() { for (const f of pending.splice(0)) f(); await Promise.resolve(); },
    setState(s) { mem.state = checkState(s); if (s === 'item-missing') mem.items.delete(account); },
    peekKey: (other = account) => copy(mem.items.get(accountOf(other)) ?? null),
  });
}

const readState = (statePath) => {
  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf8'));
    const items = {};
    for (const [a, k] of Object.entries(raw.items ?? {})) items[a] = Buffer.from(k, 'base64');
    return { state: raw.state, items, failSetKey: raw.failSetKey ?? null, delayMs: raw.delayMs ?? 0, failProbe: raw.failProbe ?? null,
      keyReadBack: raw.keyReadBack ?? null, ...(typeof raw.label === 'string' ? { label: raw.label } : {}) };
  } catch (err) {
    if (err.code === 'ENOENT') return { state: 'available', items: {}, failSetKey: null, delayMs: 0, failProbe: null, keyReadBack: null };
    throw err;
  }
};

const saveState = (statePath, { state, items, failSetKey, delayMs = 0, failProbe = null, keyReadBack = null, label }) => writeJsonAtomic(statePath, {
  state: checkState(state),
  items: Object.fromEntries(Object.entries(items).map(([a, k]) => [a, Buffer.from(k).toString('base64')])),
  failSetKey,
  ...(delayMs ? { delayMs } : {}),
  ...(failProbe ? { failProbe: checkFailProbe(failProbe) } : {}),
  ...(keyReadBack ? { keyReadBack } : {}),
  ...(label ? { label } : {}),
}, { mode: 0o600 });

function checkFailProbe(mode) {
  if (!FAIL_PROBE_MODES.includes(mode)) throw new Error(`fake OS store: unknown failProbe ${mode}`);
  return mode;
}

/**
 * Write the file-backed fake's state (0600). `items` maps account → key; the legacy `key` sets `item`'s key (default
 * account `default`). Entering item-missing clears every item. `delayMs` makes every getKey answer after that long.
 */
export function writeFakeState(statePath, { state = 'available', key = null, item = DEFAULT_ITEM, items = {}, failSetKey = null, delayMs = 0,
  failProbe = null, keyReadBack = null } = {}) {
  const all = { ...items };
  if (key) all[accountOf(item)] = key;
  saveState(statePath, { state, items: state === 'item-missing' ? {} : all, failSetKey, delayMs, failProbe, keyReadBack });
}

/** The key the state file holds for `item`, or null. */
export function peekKey(statePath, item = DEFAULT_ITEM) {
  return readState(statePath).items[accountOf(item)] ?? null;
}

/** The accounts the state file holds, sorted. */
export function fakeAccounts(statePath) {
  return Object.keys(readState(statePath).items).sort();
}

/** Remove `item` from the state file (a lost OS item). */
export function dropItem(statePath, item) {
  const st = readState(statePath);
  delete st.items[accountOf(item)];
  saveState(statePath, st);
}

/**
 * The file-backed fake, bound to `item` (and `probeItem` for probe, default `ACCOUNT-probe`): every call re-reads the
 * state file, so other processes see the same store.
 */
export function fileFakeOsStore(statePath, { item = DEFAULT_ITEM, probeItem } = {}) {
  const account = accountOf(item);
  const probeAccount = probeItem ? accountOf(probeItem) : `${account}-probe`;
  mkdirSync(dirname(statePath), { recursive: true });
  // An optional `label` in the state file names the fake as a real store would be named (the UI screenshots).
  const label = readState(statePath).label;
  const core = fakeCore({
    load: () => {
      const st = readState(statePath);
      return { state: st.state, key: st.items[account] ?? null, failSetKey: st.failSetKey, delayMs: st.delayMs, failProbe: st.failProbe,
        keyReadBack: st.keyReadBack, probe: st.items[probeAccount] ?? null };
    },
    saveKey: (k) => { const st = readState(statePath); st.items[account] = k; saveState(statePath, st); },
    dropKey: () => { const st = readState(statePath); delete st.items[account]; saveState(statePath, st); },
    saveProbe: (b) => {
      const st = readState(statePath);
      if (b) st.items[probeAccount] = copy(b); else delete st.items[probeAccount];
      saveState(statePath, st);
    },
    log: (op) => appendFileSync(`${statePath}.calls`, JSON.stringify({ op, pid: process.pid }) + '\n', { mode: 0o600 }),
    getKeyCalls: () => readFakeCalls(statePath).filter((c) => c.op === 'getKey').length,
    late: never,
  });
  if (label) core.label = label;
  return core;
}
/** The file-backed fake's calls, `[]` when no `.calls` file exists. */
export function readFakeCalls(statePath) {
  let raw;
  try { raw = readFileSync(`${statePath}.calls`, 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
