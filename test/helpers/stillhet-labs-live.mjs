// test/helpers/stillhet-labs-live.mjs — the fake flags server and page helpers shared by Stillhet Settings › Labs' live
// tests (S12.1): test/stillhet-settings-labs-live.test.mjs (switches) and test/stillhet-settings-labs-reset.test.mjs
// (set.flags, Reset all, the prototype). The server answers GET and PATCH from one table, as
// ui/routes/feature-flags/flags.mjs does.
import { liveHost, settle } from './stillhet-live-counts-host.mjs';

export const F = (key, title, stage, on, o = {}) => ({ key, title, description: `${title} does a thing.`, stage, on, source: 'default', locked: false, requires: [], ...o });
export const FIXTURE = () => [F('stillhet', 'Stillhet', 'experimental', true, { source: 'settings' }), F('design', 'Design pass', 'experimental', false),
  F('runLabels', 'Run labels', 'experimental', false), F('runTelemetry', 'Run telemetry', 'experimental', false),
  F('commandSummaries', 'Command summaries', 'beta', true), F('gitAutomations', 'Git event automations', 'experimental', false, { requires: ['runLabels'] })];

// The server: GET answers its table; PATCH applies `{key: bool|null}` (with requires), or answers `patch(body)` when the test
// gives one ([status, data] or a promise of it; a throw rejects the fetch). `apply` is the table's own write, for a patch
// that answers its own way.
export function server({ flags = FIXTURE(), patch } = {}) {
  const s = { flags };
  s.read = (u) => (u === '/api/flags' ? [200, { flags: s.flags }] : null);
  s.apply = (body) => {
    for (const [k, v] of Object.entries(body)) {
      const set = (key, on, src) => { s.flags = s.flags.map((f) => (f.key === key ? { ...f, on, source: src } : f)); };
      if (v === null) { set(k, k === 'commandSummaries', 'default'); continue; }
      set(k, v, 'settings');
      if (v) for (const r of s.flags.find((f) => f.key === k).requires) set(r, true, 'settings');
    }
  };
  s.post = async (url, body) => {
    if (url !== '/api/flags') return [200, {}];
    if (patch) { const own = await patch(body); if (own) return own; }
    s.apply(body);
    return [200, { flags: s.flags }];
  };
  return s;
}
export async function live(srv = server(), { hash = '#settings/experimental', stillhetHost } = {}) {
  const h = await liveHost({ read: (u) => srv.read(u), post: (u, b) => srv.post(u, b) });
  const calls = [];
  h.w.StillhetHost.setStillhet = (on) => { calls.push(on); return Promise.resolve(stillhetHost ? stillhetHost(on) : { ok: true }); };
  await h.hello();
  await go(h.w, hash);
  return { ...h, srv, calls };
}
export const page = (d) => d.querySelector('#route-settings');
export async function go(w, hash, ms = 120) { w.location.hash = hash; await settle(ms); }
export const rowOf = (d, name) => [...page(d).querySelectorAll('.set-row')].find((r) => r.querySelector('.set-name')?.textContent.trim() === name);
export const secOf = (d, title) => [...page(d).querySelectorAll('.set-sec')].find((s) => s.querySelector('.set-sec-h')?.textContent.trim() === title);
export const switchOf = (d, name) => rowOf(d, name)?.querySelector('[role=switch]');
export const textOf = (d, name) => rowOf(d, name).querySelector('.set-text').textContent.trim();
export const buttonOf = (s, label) => [...s.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
export const patches = (posts) => posts.filter((p) => p.url === '/api/flags').map((p) => p.body);
export const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
// every toast the page said: the app host's own (StillhetHost.toastEl) is the last `.rc-toast`, the prototype's the first
export const toastText = (d) => [...d.querySelectorAll('body > .rc-toast')].map((x) => x.textContent).filter(Boolean).join(' | ');
export const stripText = (d) => d.querySelector('.rc-confirm-t')?.textContent.trim() || '';
export const answer = async (w, d, yes) => { click(w, d.querySelector(`[data-confirm="${yes ? 'yes' : 'no'}"]`)); await settle(60); };
export const held = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };

