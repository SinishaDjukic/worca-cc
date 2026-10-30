import { renderInheritField, readDirtyFields, inheritedOf } from './inherit-field.mjs';
import { renderEngineSection, utilityId } from './engine-settings-view.mjs';
import { notify, cardAlert } from './feedback.mjs';
import { mountExecEnvPanel } from './exec-env-project-view.mjs';
import { ENGINE_NAMES, HELPER_ENGINE_NAMES } from '../../src/shared/engine-switch.mjs';

// A USD field's inherited value as the placeholder shows it: "$5.00", or "no cap" when unset.
const usd = (value) => (value == null ? 'no cap' : `$${Number(value).toFixed(2)}`);
// "fix, feat chore" → ['fix', 'feat', 'chore'] (the server validates each word).
const typesOf = (text) => String(text).toLowerCase().split(/[\s,]+/).filter(Boolean);
export const PROJECT_CARDS = Object.freeze([
  { key: 'cost', title: 'Cost', fields: [{ id: 'pipelineCostLimitUsd', label: 'Per-pipeline cap (USD)', kind: 'number', min: .01, step: .01, format: usd }, { id: 'humanRateUsdPerHour', label: 'Developer rate (USD/h)', kind: 'number', min: .01, step: .01, format: usd }] },
  { key: 'ask', title: 'Chat', fields: [{ id: 'askMaxTurns', label: 'Turn limit', kind: 'number', min: 1, step: 1 }, { id: 'askMaxBudgetUsd', label: 'Per-turn cost cap (USD)', kind: 'number', min: .1, step: .1, format: usd }] },
  { key: 'context', title: 'Context and memory', fields: [{ id: 'contextMaxBytesPerFile', label: 'Run context: bytes per file', kind: 'number', min: 1 }, { id: 'contextMaxBytesTotal', label: 'Run context: bytes in total', kind: 'number', min: 1 }, { id: 'skillMount', label: 'Skill delivery', kind: 'select', options: [{ value: 'copy', label: 'Copy' }, { value: 'symlink', label: 'Symlink' }] },
    { id: 'memory.team', label: 'Team memory', kind: 'select', options: [{ value: 'team', label: 'Team: team notes only' }, { value: 'both', label: 'Both: my notes and the team\'s' }],
      // Project layer only (no user layer): inherit = Local (off). Off is stored as null, like the CLI and the Team view do.
      fromValue: (v) => (v === true ? 'both' : v === 'only' ? 'team' : ''), toValue: (v) => (v === 'team' ? 'only' : v === 'both' ? true : null),
      format: (v) => (v === true ? 'Both' : v === 'only' ? 'Team' : 'Local'),
      hint: 'Which memory runs and chats load. Local (off): this machine\'s notes. Team and Both share this project\'s notes with the team on its worca-memory branch, after a secret check (needs an origin remote); Team loads only the team\'s notes, Both yours too. Notes that exist stay on this machine until you share them from the Memory tab\'s Team view. Switching back to Local drops changes still waiting to be pushed from this machine.' }] },
  { key: 'exec', title: 'Execution environment', fields: [{ id: 'run.execEnv', label: 'Where runs execute', kind: 'select', options: [{ value: 'local', label: 'Local' }, { value: 'e2b', label: 'E2B sandbox' }] }] },
  { key: 'pr', title: 'Pull requests', fields: [{ id: 'watchNewPrs', label: 'Watch new pull requests', kind: 'select',
    options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
    toValue: (value) => value === 'on', fromValue: (value) => (value ? 'on' : 'off'), format: (value) => (value ? 'On' : 'Off'),
    hint: 'Create PR opens with Watch PR on for this project. A workspace run needs it on in every repository.' }] },
]);
// A project's helper slots, on every engine with helper slots of its own (the catalog's HELPER_ENGINE_NAMES); the
// other engines' helper jobs run on their default model or on Claude, as their tab says.
const JOBS = ['title', 'classifier', 'overview', 'prDescription', 'memoryDefrag'];
function makeCard(doc, key, title) { const card = doc.createElement('section'); card.className = 'card pd-settings-card'; card.dataset.card = key; const heading = doc.createElement('h3'); heading.textContent = title; const body = doc.createElement('div'); body.className = 'pd-settings-body drows'; const save = doc.createElement('button'); save.type = 'button'; save.className = 'btn btn-primary btn-sm pd-settings-save'; save.textContent = 'Save'; const msg = doc.createElement('small'); msg.className = 'hint pd-settings-msg'; const actions = doc.createElement('div'); actions.className = 'add-project-actions engine-save-row'; actions.append(msg, save); card.append(heading, body, actions); return { card, body, save, msg }; }
export function mountProjectSettings(host, { projectKey, projectDir, fetchFn = (url, options) => fetch(url, options), onTest = null }) {
  const doc = host.ownerDocument; const url = `/api/projects/${encodeURIComponent(projectKey)}/settings`; let catalog = []; let current = { own: {} };
  // The registered backends for "Where runs execute" (GET /api/exec-envs; null = the static options), and the sandbox
  // environment panel inside the exec card (exec-env-project-view.mjs), stopped before every re-render.
  let execEnvOptions = null; let execEnvPanel = null;
  const render = (data) => {
    execEnvPanel?.stop(); execEnvPanel = null;
    current = data; host.replaceChildren(); const field = (id) => ({ own: data.own[id], inherited: inheritedOf(data.layers[id]) }); const roles = data.roles || [];
    const models = makeCard(doc, 'models', 'Engine and models'); const ids = ['run.engine']; for (const engine of ENGINE_NAMES) { for (const role of roles) ids.push(`models.${engine}.steps.${role.key}`); if (HELPER_ENGINE_NAMES.includes(engine)) for (const job of JOBS) ids.push(utilityId(engine, job)); }
    renderEngineSection(models.body, { level: 'project', roles, catalog, fields: Object.fromEntries(ids.map((id) => [id, field(id)])), jobs: Object.fromEntries(HELPER_ENGINE_NAMES.map((e) => [e, JOBS])), status: models.msg, onTest, notes: { claude: 'Claude step models set here apply to the Default workflow; other workflows keep their own node picks.' } }); host.append(models.card);
    for (const spec of PROJECT_CARDS) {
      const item = makeCard(doc, spec.key, spec.title);
      for (const row of spec.fields) item.body.append(renderInheritField(doc, { ...row, ...(row.id === 'run.execEnv' && execEnvOptions ? { options: execEnvOptions } : {}), level: 'project', ...field(row.id) }));
      if (spec.key === 'exec') { const panel = doc.createElement('div'); panel.className = 'exec-env-panel'; item.body.append(panel); execEnvPanel = mountExecEnvPanel(panel, { projectKey, fetchFn }); }
      host.append(item.card); item.save.addEventListener('click', () => void save(item));
    }
    models.save.addEventListener('click', () => void save(models));
    const naming = namingCard(data); host.append(naming.card); naming.save.addEventListener('click', () => void save(naming));
  };
  // Smart run naming (Labs): one stored block per project ({pattern, types}), edited as two inherit fields.
  const namingCard = (data) => {
    const item = makeCard(doc, 'smartNaming', 'Smart run naming');
    const own = data.own.smartNaming || {}; const layers = data.layers.smartNaming || {};
    const spec = (k, label, extra) => ({ id: `smartNaming.${k}`, label, level: 'project', kind: 'text', own: k === 'types' && own.types ? own.types.join(', ') : own[k],
      inherited: inheritedOf({ user: layers.user?.[k] ?? layers.default?.[k], team: layers.team?.[k], default: layers.default?.[k] }), toValue: k === 'types' ? typesOf : undefined, ...extra });
    const fmt = (v) => (Array.isArray(v) ? v.join(', ') : v == null ? null : String(v));
    item.body.append(
      renderInheritField(doc, spec('pattern', 'Branch pattern', { mono: true, format: fmt, hint: 'Placeholders: type, slug, ticket, id, each in braces. Needs the slug placeholder.' })),
      renderInheritField(doc, spec('types', 'Types the model may pick', { mono: true, format: fmt, hint: 'Short lowercase words separated by commas. The first is the fallback.' })));
    return item;
  };
  // #555: a result is a card alert (failure) or a toast (saved); the line under Save only says "Nothing changed.".
  const save = async (item) => {
    cardAlert(item.card, null);
    const patch = readDirtyFields(item.body);
    if ('smartNaming.pattern' in patch || 'smartNaming.types' in patch) {
      const next = { ...(current.own.smartNaming || {}) };
      for (const k of ['pattern', 'types']) { const v = patch[`smartNaming.${k}`]; if (v === null) delete next[k]; else if (v !== undefined) next[k] = v; delete patch[`smartNaming.${k}`]; }
      patch.smartNaming = Object.keys(next).length ? next : null;
    }
    item.msg.textContent = Object.keys(patch).length ? '' : 'Nothing changed.';
    if (!Object.keys(patch).length) return;
    let response; let data;
    try { response = await fetchFn(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }); data = await response.json(); }
    catch (error) { cardAlert(item.card, { title: 'Not saved', detail: error?.message || 'Worca did not answer.' }); return; }
    if (!response.ok) { cardAlert(item.card, { title: 'Not saved', detail: data?.error || `The server answered ${response.status}.` }); return; }
    render(data);
    notify({ tone: 'ok', title: 'Saved', detail: 'New runs of this project use it.' }, { doc });
  };
  const reload = async () => {
    // Apart from the settings Promise.all: its one catch would turn a failed list into "could not be read".
    const execEnvsP = fetchFn('/api/exec-envs').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    try { const [settings, config] = await Promise.all([fetchFn(url), fetchFn(`/api/config?projectDir=${encodeURIComponent(projectDir)}`)]); const data = await settings.json(); const cfg = await config.json(); catalog = cfg.models || []; if (!settings.ok) throw new Error(data.error);
      const d = await execEnvsP;
      execEnvOptions = Array.isArray(d?.execEnvs) ? d.execEnvs.map(({ name, label }) => ({ value: name, label })) : null;
      render(data); } catch (error) { const box = doc.createElement('section'); box.className = 'card pd-settings-error'; cardAlert(box, { title: 'Project settings could not be read', detail: error?.message || '' }); host.replaceChildren(box); } };
  void reload(); return { reload };
}
