// ui/public/exec-envs.mjs — the registered execution environments (GET /api/exec-envs) for every "Runs in"
// picker and run chip. Until the list arrives (or when the server is older), Local + E2B, as the static HTML.
export const FALLBACK_EXEC_ENVS = Object.freeze([
  Object.freeze({ name: 'local', label: 'Local', title: 'Local' }),
  Object.freeze({ name: 'e2b', label: 'E2B sandbox', title: 'E2B' }),
]);
let list = FALLBACK_EXEC_ENVS;
const valid = (e) => e && typeof e.name === 'string' && typeof e.label === 'string';
export const execEnvList = () => list;
/** Tests only: null restores the fallback (the module keeps one list per page). */
export function setExecEnvListForTests(items) { list = items === null ? FALLBACK_EXEC_ENVS : setExecEnvList(items); }
export function setExecEnvList(items) {
  if (Array.isArray(items) && items.some((e) => e?.name === 'local') && items.every(valid)) list = Object.freeze(items.map((e) => ({ title: e.label, ...e })));
  return list;
}
export const execEnvKnown = (name) => list.some((e) => e.name === name);
export const execEnvLabel = (name) => list.find((e) => e.name === name)?.label || String(name);
export const execEnvTitle = (name) => list.find((e) => e.name === name)?.title || String(name);
/** Rebuild a <select>'s options from the list. Keeps the value a painter ASKED for (`select.dataset.want`, set by
 *  setExecEnvSelectValue even when the option did not exist yet), else the current value, when still listed. */
export function fillExecEnvSelect(select) {
  if (!select) return;
  const doc = select.ownerDocument; const keep = select.dataset.want || select.value;
  select.replaceChildren(...list.map((e) => { const o = doc.createElement('option'); o.value = e.name; o.textContent = e.label; return o; }));
  select.value = execEnvKnown(keep) ? keep : 'local';
}
/** Paint a saved value into an exec-env <select>, remembering it for a later fill: a saved third backend the
 *  static HTML does not list yet must not read as '' and be saved back as "clear". */
export function setExecEnvSelectValue(select, value) {
  if (!select) return;
  const v = typeof value === 'string' && value ? value : 'local';
  select.dataset.want = v;
  if (![...select.options].some((o) => o.value === v)) fillExecEnvSelect(select); else select.value = v;
}
export async function loadExecEnvs(fetchFn = (u) => fetch(u)) {
  try { const r = await fetchFn('/api/exec-envs'); if (r.ok) setExecEnvList((await r.json())?.execEnvs); } catch { /* keep the fallback */ }
  return list;
}
