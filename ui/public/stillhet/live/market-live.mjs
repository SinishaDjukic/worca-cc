// ui/public/stillhet/live/market-live.mjs — Stillhet's Marketplace in the live kind (slice 8 D2): the one module that reads
// and writes dev's plugin and marketplace routes (ui/routes/marketplace/plugins.mjs). Every request is built from
// MARKET_ACTIONS; every answer is { ok, status, data, error }, and every action answers { ok, text } (text: the toast).
// A refusal changes nothing here: the records are only ever read again from dev's lists.
import { marketOf, pluginsOf, setupFieldsOf, setupGroupOf, setupWhereOf, marketsOf, rowsOf, configRowsOf } from './market-map.mjs';

const enc = encodeURIComponent;
// the profile a multi-profile source gets when it has none (dev reserves `default` for the shared bucket)
export const FIRST_PROFILE = Object.freeze({ id: 'main', label: 'Default' });
// id → [the words a refusal starts with, args → [method, url, body?]]
export const MARKET_ACTIONS = Object.freeze({
  'list-plugins': ['read the plugins', () => ['GET', '/api/plugins']],
  'list-markets': ['read the sources', () => ['GET', '/api/marketplaces']],
  'get-plugin': ['read', ({ id }) => ['GET', `/api/plugins/${enc(id)}`]],
  'get-config': ['set up', ({ id }) => ['GET', `/api/plugins/${enc(id)}/config`]],
  install: ['install', ({ repoUrl, name, sha, subdir, marketplace }) => ['POST', '/api/plugins/install', { repoUrl, name, sha, subdir, marketplace }]],
  'update-preview': ['update', ({ id }) => ['POST', `/api/plugins/${enc(id)}/update`, {}]],
  'update-apply': ['update', ({ id, candidateSha }) => ['POST', `/api/plugins/${enc(id)}/update`, { confirm: true, candidateSha }]],
  remove: ['remove', ({ id }) => ['DELETE', `/api/plugins/${enc(id)}`]],
  'add-profile': ['set up', ({ id, sourceId }) => ['POST', `/api/plugins/${enc(id)}/profiles`, { sourceId, id: FIRST_PROFILE.id, label: FIRST_PROFILE.label }]],
  'remove-profile': ['set up', ({ id, sourceId, profile }) => ['DELETE', `/api/plugins/${enc(id)}/profiles/${enc(profile)}?sourceId=${enc(sourceId)}`]],
  'save-config': ['set up', ({ id, body }) => ['PUT', `/api/plugins/${enc(id)}/config`, body]],
  sync: ['sync', ({ id }) => ['POST', `/api/marketplaces/${enc(id)}/refresh`, {}]],
  'add-source': ['add', ({ url }) => ['POST', '/api/marketplaces', { url }]],
  'remove-source': ['remove', ({ id }) => ['DELETE', `/api/marketplaces/${enc(id)}`]],
});
const LISTS = { plugins: 'list-plugins', markets: 'list-markets' };
export const NOT_ANSWERING = 'Worca is not answering';
// what an update newly asks for (src/shared/plugin-access.mjs ACCESS_KINDS), in words
const ACCESS_WORDS = { secret: 'a secret', channelSecret: 'a chat channel secret', modelSecret: 'a model key', modelEnv: 'a model setting', setup: 'a set-up step', taskSource: 'a task source', chatChannel: 'a chat channel', agent: 'an agent', model: 'a model', mcp: 'an MCP server', skill: 'a skill' };
/** The set-up form's name for one field (market-map.mjs setupFieldsOf). */
export const fieldKey = (f) => [f.target, f.sourceId || f.channelId || '', f.key].join('|');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function startMarketLive({ fetch, toast = () => {}, open = (u) => globalThis.window?.open(u, '_blank', 'noopener'), on = () => {}, setTimeout: later = globalThis.setTimeout, clearTimeout: cancel = globalThis.clearTimeout, now = () => Date.now() }) {
  let lists = {}, configs = {}, state = 'loading', started = null, records = { markets: [], plugins: [] };
  const busy = new Map(), hidden = new Map(), asked = new Map(), fields = new Map(), seq = {};
  const tried = new Set(), pending = new Set();   // the first sync (#1298): sent once per never-synced builtin per page load

  async function send(id, args = {}) {
    const [, build] = MARKET_ACTIONS[id], [method, url, body] = build(args);
    let r;
    try { r = await fetch(url, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
    catch { return { ok: false, status: 0, data: {}, error: NOT_ANSWERING }; }
    const data = await r.json().catch(() => ({}));
    const why = !r.ok ? data?.error || data?.message || `HTTP ${r.status}` : '';
    return { ok: r.ok, status: r.status, data: data || {}, error: why };
  }
  function rebuild() {
    const markets = marketsOf(lists.markets).filter((m) => !hidden.has(m.id));
    records = { markets: markets.map((m) => marketOf(m, now())), plugins: pluginsOf(markets, rowsOf(lists.plugins), configs) };
  }
  // an installed plugin with settings asks for its config labels (D6): its config is read with the list
  async function readConfigs(answer) {
    const rows = configRowsOf(answer);
    const answers = await Promise.all(rows.map((r) => send('get-config', { id: r.name })));
    const out = {};
    rows.forEach((r, i) => { if (answers[i].ok) out[r.name] = answers[i].data; });
    return out;
  }
  /** Read lists again; each list keeps only its newest read's answer, so overlapping reads cannot land out of order. */
  async function refresh(...names) {
    const mine = Object.fromEntries(names.map((n) => [n, (seq[n] = (seq[n] || 0) + 1)]));
    const answers = await Promise.all(names.map((n) => send(LISTS[n])));
    const cfg = answers.every((a) => a.ok) && names.includes('plugins') ? await readConfigs(answers[names.indexOf('plugins')].data) : null;
    const fresh = names.filter((n) => seq[n] === mine[n]);
    if (!fresh.length) return answers.every((a) => a.ok);
    if (answers.some((a) => !a.ok)) { if (state !== 'ready') state = 'failed'; on(); return false; }
    fresh.forEach((n) => { lists[n] = answers[names.indexOf(n)].data; });
    if (cfg && fresh.includes('plugins')) configs = cfg;
    state = 'ready'; rebuild(); on();
    if (fresh.includes('markets')) firstSync();
    return true;
  }
  // a builtin that has never synced (dev seeds it with lastSync: null) is synced once, quietly: a failure shows on the
  // page through the market's error, never as a toast; a source the person added, or one that needs git, is never synced here
  const neverSynced = (m) => m?.builtin === true && !m.lastSync && !m.needsGit;
  function firstSync() {
    for (const m of marketsOf(lists.markets)) {
      if (!neverSynced(m) || tried.has(m.id)) continue;
      tried.add(m.id); pending.add(m.id);
      once(`source:${m.id}`, 'sync', async () => { await send('sync', { id: m.id }); await reread(); })
        .finally(() => { pending.delete(m.id); on(); });
    }
  }
  /** True while a never-synced builtin's first sync is still to be sent or still runs: read from the lists, so the very
   *  draw that first shows them is already Loading the catalogue, never No plugins yet. */
  const firstSyncing = () => marketsOf(lists.markets).some((m) => neverSynced(m) && (!tried.has(m.id) || pending.has(m.id)));
  let inflight = null;
  function load() {
    if (state === 'failed') { state = 'loading'; on(); }   // Try again shows the read it starts
    inflight ||= refresh(...Object.keys(LISTS)).finally(() => { inflight = null; }); started = inflight; return inflight;
  }
  const begin = () => { if (!started) load(); };
  const reread = () => refresh(...Object.keys(LISTS));

  const find = (id) => records.plugins.find((p) => p.id === id);
  const marketNamed = (id) => records.markets.find((m) => m.id === id) || null;
  const refused = (words, title, why) => ({ ok: false, text: `Could not ${words} ${title}: ${why}` });
  /** One action at a time per target: a second press while one runs answers { ok:false, text:'' } and sends nothing. */
  async function once(key, kind, fn) {
    if (busy.has(key)) return { ok: false, text: '' };
    busy.set(key, kind); on();
    try { return await fn(); } finally { busy.delete(key); on(); }
  }

  function install(id) {
    return once(id, 'install', async () => {
      const p = find(id);
      if (!p) return refused('install', id, 'it is not offered by any source');
      const { repoUrl, sha, subdir } = p.source;
      const a = await send('install', { repoUrl, name: id, sha, subdir, marketplace: p.market === 'linked' ? undefined : p.market });
      if (!a.ok) return refused('install', id, a.error);
      await reread();
      return { ok: true, text: `Installed ${id}${find(id)?.needsSetup ? ': set it up' : ''}` };
    });
  }

  /** Update (D9): the preview, then the apply with the candidate that preview returned. New access asks first. */
  async function updateOne(id, confirmed) {
    const p = find(id), title = p?.name || id;
    if (confirmed && !asked.has(id)) confirmed = false;   // a yes to an ask never shown: ask again
    let candidate = confirmed ? asked.get(id) : null, version = p?.update || '';
    if (!candidate) {
      const pv = await send('update-preview', { id });
      if (!pv.ok) return { ...refused('update', id, pv.error), title, why: pv.error };
      const v = pv.data?.preview || {};
      candidate = v.candidateSha; version = v.candidateVersion || version;
      const access = Array.isArray(v.access) ? v.access : [];
      if (access.length && !confirmed) {
        asked.set(id, candidate);
        return { ok: false, ask: { text: `Update ${id} to ${version}? It now asks for ${access.map((x) => `${ACCESS_WORDS[x.kind] || x.kind}${x.id ? `: ${x.id}` : ''}`).join(', ')}.` }, title };
      }
    }
    asked.delete(id);
    const a = await send('update-apply', { id, candidateSha: candidate });
    if (!a.ok) { await reread(); return { ...refused('update', id, a.error), title, why: a.error }; }
    if (a.data?.updated === false) { await reread(); return { ok: true, text: `${id} is up to date`, title }; }
    await reread();
    return { ok: true, text: `Updated ${title} to ${a.data?.candidateVersion || version}`, title };
  }
  const update = (id, { confirmed = false } = {}) => once(id, 'update', async () => { const { title, why, ...out } = await updateOne(id, confirmed); return out; });

  /** Update all (D10): one plugin at a time; one that asks for new access is skipped and named. */
  async function updateAll() {
    const done = [], failed = [], asking = [];
    for (const p of records.plugins.filter((x) => x.update)) {
      if (busy.has(p.id)) continue;
      busy.set(p.id, 'update'); on();
      try {
        const r = await updateOne(p.id, false);
        if (r.ask) { asked.delete(p.id); asking.push(p.name); } else if (r.ok) done.push(r.title); else failed.push(`${r.title}: ${r.why || r.text}`);
      } finally { busy.delete(p.id); on(); }
    }
    const parts = [done.length ? `Updated ${done.join(', ')}` : '', failed.length ? `could not update ${failed.join(', ')}` : '', asking.length ? `${asking.join(', ')} ${asking.length === 1 ? 'asks' : 'ask'} for something new: update ${asking.length === 1 ? 'it' : 'them'} on ${asking.length === 1 ? 'its' : 'their'} page` : ''].filter(Boolean);
    const text = parts.join('; ');
    return { ok: !failed.length, text: text.charAt(0).toUpperCase() + text.slice(1) };
  }

  function remove(id) {
    return once(id, 'remove', async () => {
      const a = await send('remove', { id });
      if (!a.ok) return refused('remove', id, a.error);
      await reread();
      return { ok: true, text: `Removed ${id}` };
    });
  }

  /** The set-up form's fields (D12): dev's config schema's required fields (market-map.mjs setupFieldsOf), each with the
   *  form's key for it (`name`), the one target it is saved with (`group`) and that target in words (`where`). */
  async function setupFields(id) {
    const a = await send('get-config', { id });
    if (!a.ok) return { ...refused('set up', id, a.error), fields: [] };
    configs[id] = a.data;
    const f = setupFieldsOf(a.data).map((x) => ({ ...x, name: fieldKey(x), group: setupGroupOf(x), where: setupWhereOf(x) }));
    fields.set(id, f);
    return { ok: true, text: '', fields: f };
  }
  /** Save (D12): one target per press (its source, channel or the model secrets; `group`, default the first), so a
   *  refusal changes nothing. A multi-profile source with no profile gets its first profile in the same Save; a refused
   *  PUT deletes it again. While dev still reads Needs set-up the answer says so (`more`), never "is set up". */
  function saveSetup(id, values = {}, group) {
    return once(id, 'setup', async () => {
      const list = fields.get(id) || (await setupFields(id)).fields;
      const key = group ?? (list[0] ? setupGroupOf(list[0]) : '');
      const mine = list.filter((f) => setupGroupOf(f) === key);
      const p = find(id), title = p?.name || id;
      const typed = {};
      for (const f of mine) {
        const v = f.key ? values[fieldKey(f)] : undefined;
        if (typeof v === 'string' && v.trim()) typed[f.key] = f.secret ? v : v.trim();
      }
      const f0 = mine[0], firstProfile = f0?.target === 'source' && f0.profile === null;
      if (!f0 || (!Object.keys(typed).length && !mine.some((f) => f.profileOnly))) return { ok: false, text: `Nothing to save for ${title}: type a value first` };
      let made = null;
      if (firstProfile) {
        const m = await send('add-profile', { id, sourceId: f0.sourceId });
        if (!m.ok) return refused('set up', id, m.error);
        made = m.data?.profile?.id || FIRST_PROFILE.id;
      }
      if (Object.keys(typed).length) {
        const body = f0.target === 'source' ? { sourceId: f0.sourceId, ...(made ? { profile: made } : f0.profile !== undefined ? { profile: f0.profile } : {}), values: typed }
          : f0.target === 'channel' ? { channelId: f0.channelId, values: typed } : { target: 'modelSecrets', values: typed };
        const a = await send('save-config', { id, body });
        if (!a.ok) {
          if (!made) return refused('set up', id, a.error);
          const d = await send('remove-profile', { id, sourceId: f0.sourceId, profile: made });
          if (d.ok) return refused('set up', id, a.error);
          await reread();
          return refused('set up', id, `${a.error} (its new profile ${made} was kept: ${d.error})`);
        }
      }
      fields.delete(id);
      await reread();
      if (find(id)?.needsSetup) return { ok: true, more: true, text: `Saved ${setupWhereOf(f0)}: ${title} still needs set-up` };
      return { ok: true, text: `${title} is set up` };
    });
  }

  /** Sync (D14): dev answers 200 even when the sync fails; a lastError that was not there before is the failure. */
  function sync(marketId) {
    return once(`source:${marketId}`, 'sync', async () => {
      const before = marketsOf(lists.markets).find((m) => m.id === marketId), name = marketNamed(marketId)?.name || marketId;
      const a = await send('sync', { id: marketId });
      if (!a.ok) return refused('sync', name, a.error);
      const err = a.data?.marketplace?.lastError;
      await reread();
      if (err?.at && err.at !== before?.lastError?.at) return refused('sync', name, err.message || 'it did not answer');
      const n = (a.data?.marketplace?.plugins || []).length;
      return { ok: true, text: `Synced ${name}: ${plural(n, 'plugin')}` };
    });
  }
  /** Add a source (D14): a market goes to its way, a linked plugin folder to that plugin. */
  function addSource(url) {
    return once('source:add', 'add', async () => {
      const a = await send('add-source', { url });
      if (!a.ok) return refused('add', url, a.error);
      await reread();
      if (a.data?.linked) { const name = a.data.plugin?.name || url; return { ok: true, text: `Linked ${name}`, to: `marketplace/${name}` }; }
      const m = a.data?.marketplace || {}, n = (m.plugins || []).length;
      return { ok: true, text: `Added ${m.name || url}: ${n ? plural(n, 'plugin') : 'no plugins from it yet'}`, to: `marketplace/~src-${m.id}` };
    });
  }
  /** Remove a source after the undo window (D14): hidden at once; the DELETE goes only when the window closes; undo
   *  sends nothing and brings it back (true), or answers false once the DELETE has started. */
  function deferRemoveSource(marketId, ms) {
    if (hidden.has(marketId)) return hidden.get(marketId).handle;
    const name = marketNamed(marketId)?.name || marketId;
    const t = later(async () => {
      const h = hidden.get(marketId); if (h?.handle === handle) h.fired = true;
      const a = await send('remove-source', { id: marketId });
      if (!a.ok) toast(`Could not remove ${name}: ${a.error}`);
      hidden.delete(marketId);
      if (!(await reread())) { rebuild(); on(); }
    }, ms);
    const handle = { undo: () => { const h = hidden.get(marketId); if (h?.handle !== handle || h.fired) return false; cancel(t); hidden.delete(marketId); rebuild(); on(); return true; } };
    hidden.set(marketId, { handle });
    rebuild(); on();
    return handle;
  }

  /** View its source (D15): an installed plugin's pinned commit, else the market snapshot's; on GitHub in a new tab. */
  async function openSource(id) {
    const p = find(id);
    let url = p?.source?.webUrl || null;
    if (p?.installed) { const a = await send('get-plugin', { id }); if (a.ok) url = a.data?.webUrl || null; }
    if (!url) return { ok: false, text: p?.source?.repoUrl ? `${id} comes from ${p.source.repoUrl}, which is not on GitHub` : '' };
    open(url);
    return { ok: true, text: '' };
  }
  function openMarket(marketId) {
    const url = marketNamed(marketId)?.webUrl;
    if (!url) return { ok: false, text: '' };
    open(url);
    return { ok: true, text: '' };
  }

  return {
    load, refresh: (...n) => (started ? refresh(...(n.length ? n : Object.keys(LISTS))) : Promise.resolve(false)),
    data: () => { begin(); return records; },
    status: () => { begin(); return state; },
    pending: (id) => busy.get(id) || '', firstSyncing,
    install, update, updateAll, remove, setupFields, saveSetup, sync, addSource, deferRemoveSource, openSource, openMarket,
  };
}
