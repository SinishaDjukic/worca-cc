import { renderInheritField, readDirtyFields, inheritedOf } from './inherit-field.mjs';
import { renderEngineSection, utilityId } from './engine-settings-view.mjs';
import { notify, cardAlert } from './feedback.mjs';
import { ENGINE_NAMES } from '../../src/shared/engine-switch.mjs';

// A USD field's inherited value as the placeholder shows it: "$5.00", or "no cap" when unset.
const usd = (value) => (value == null ? 'no cap' : `$${Number(value).toFixed(2)}`);
export const PROJECT_CARDS = Object.freeze([
  { key: 'cost', title: 'Cost', fields: [{ id: 'pipelineCostLimitUsd', label: 'Per-pipeline cap (USD)', kind: 'number', min: .01, step: .01, format: usd }, { id: 'humanRateUsdPerHour', label: 'Developer rate (USD/h)', kind: 'number', min: .01, step: .01, format: usd }] },
  { key: 'ask', title: 'Ask Worca', fields: [{ id: 'askMaxTurns', label: 'Turn limit', kind: 'number', min: 1, step: 1 }, { id: 'askMaxBudgetUsd', label: 'Per-turn cost cap (USD)', kind: 'number', min: .1, step: .1, format: usd }] },
  { key: 'context', title: 'Context and memory', fields: [{ id: 'contextMaxBytesPerFile', label: 'Run context: bytes per file', kind: 'number', min: 1 }, { id: 'contextMaxBytesTotal', label: 'Run context: bytes in total', kind: 'number', min: 1 }, { id: 'skillMount', label: 'Skill delivery', kind: 'select', options: [{ value: 'copy', label: 'Copy' }, { value: 'symlink', label: 'Symlink' }] }] },
]);
const JOBS = ['title', 'classifier', 'overview', 'prDescription', 'memoryDefrag'];
// src/core/model-env.mjs HELPER_ENGINES (the browser cannot load /src/core): Cursor's helper jobs run on Claude.
const HELPER_ENGINES = ['claude', 'codex'];
function makeCard(doc, key, title) { const card = doc.createElement('section'); card.className = 'card pd-settings-card'; card.dataset.card = key; const heading = doc.createElement('h3'); heading.textContent = title; const body = doc.createElement('div'); body.className = 'pd-settings-body'; const save = doc.createElement('button'); save.type = 'button'; save.className = 'btn btn-primary btn-mini pd-settings-save'; save.textContent = 'Save'; const msg = doc.createElement('small'); msg.className = 'hint pd-settings-msg'; card.append(heading, body, save, msg); return { card, body, save, msg }; }
export function mountProjectSettings(host, { projectKey, projectDir, fetchFn = (url, options) => fetch(url, options) }) {
  const doc = host.ownerDocument; const url = `/api/projects/${encodeURIComponent(projectKey)}/settings`; let catalog = [];
  const render = (data) => {
    host.replaceChildren(); const field = (id) => ({ own: data.own[id], inherited: inheritedOf(data.layers[id]) }); const roles = data.roles || [];
    const models = makeCard(doc, 'models', 'Engine and models'); const ids = ['run.engine']; for (const engine of ENGINE_NAMES) { for (const role of roles) ids.push(`models.${engine}.steps.${role.key}`); if (HELPER_ENGINES.includes(engine)) for (const job of JOBS) ids.push(utilityId(engine, job)); }
    renderEngineSection(models.body, { level: 'project', roles, catalog, fields: Object.fromEntries(ids.map((id) => [id, field(id)])), jobs: { claude: JOBS, codex: JOBS, cursor: [] }, notes: { claude: 'Claude step models set here apply to the Default workflow; other workflows keep their own node picks.' } }); host.append(models.card);
    for (const spec of PROJECT_CARDS) { const item = makeCard(doc, spec.key, spec.title); for (const row of spec.fields) item.body.append(renderInheritField(doc, { ...row, level: 'project', ...field(row.id) })); host.append(item.card); item.save.addEventListener('click', () => void save(item)); }
    models.save.addEventListener('click', () => void save(models));
  };
  // #555: a result is a card alert (failure) or a toast (saved); the line under Save only says "Nothing changed.".
  const save = async (item) => {
    cardAlert(item.card, null);
    const patch = readDirtyFields(item.body);
    item.msg.textContent = Object.keys(patch).length ? '' : 'Nothing changed.';
    if (!Object.keys(patch).length) return;
    let response; let data;
    try { response = await fetchFn(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }); data = await response.json(); }
    catch (error) { cardAlert(item.card, { title: 'Not saved', detail: error?.message || 'Worca did not answer.' }); return; }
    if (!response.ok) { cardAlert(item.card, { title: 'Not saved', detail: data?.error || `The server answered ${response.status}.` }); return; }
    render(data);
    notify({ tone: 'ok', title: 'Saved', detail: 'New runs of this project use it.' }, { doc });
  };
  const reload = async () => { try { const [settings, config] = await Promise.all([fetchFn(url), fetchFn(`/api/config?projectDir=${encodeURIComponent(projectDir)}`)]); const data = await settings.json(); const cfg = await config.json(); catalog = cfg.models || []; if (!settings.ok) throw new Error(data.error); render(data); } catch (error) { const box = doc.createElement('section'); box.className = 'card pd-settings-error'; cardAlert(box, { title: 'Project settings could not be read', detail: error?.message || '' }); host.replaceChildren(box); } };
  void reload(); return { reload };
}
