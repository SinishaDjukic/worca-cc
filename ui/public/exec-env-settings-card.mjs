// ui/public/exec-env-settings-card.mjs — Settings › Runs › Execution environment (#e2b-settings-card): the copy, the
// docs links and the limit rows follow the backend the select shows. Rows carry data-exec-backend; only the selected
// backend's are shown, and readExecEnvCard sends every backend's fields, so switching the select loses nothing.
// Pure DOM in, pure DOM out: app.js owns the fetches and the status chip.
import { docsLink } from './docs-links.mjs';

export const EXEC_ENV_CARD_COPY = Object.freeze({
  local: "Local: a run's agents and scripts execute on this machine, as your user. They are not sandboxed.",
  docker: "Local sandbox (Docker): each run's agents and scripts execute in their own disposable container on this machine's Docker. Commits, pushes and PRs stay here.",
  e2b: 'E2B: each run executes in its own sandbox on your self-hosted E2B server. Commits, pushes and PRs stay here.',
});
const OTHER_COPY = (label) => `${label}: each run's agents and scripts execute in their own sandbox. Commits, pushes and PRs stay here.`;
/** The backend's own guide, beside Choose a setup and the security overview. */
export const EXEC_ENV_DOCS = Object.freeze({ docker: ['local-sandbox', 'Local sandbox guide'], e2b: ['e2b', 'E2B guide'] });

const num = (card, id) => { const v = String(card.querySelector(`#${id}`)?.value ?? '').trim(); return v === '' ? null : Number(v); };
const text = (card, id) => { const v = String(card.querySelector(`#${id}`)?.value ?? '').trim(); return v === '' ? null : v; };

/** Show the rows, the copy and the links of backend `name` ('local' shows only the select). */
export function paintExecEnvCardBackend(card, name, { label = null } = {}) {
  if (!card) return;
  const doc = card.ownerDocument;
  const pick = typeof name === 'string' && name ? name : 'local';
  for (const row of card.querySelectorAll('[data-exec-backend]')) row.hidden = row.dataset.execBackend !== pick;
  const hint = card.querySelector('#exec-env-card-hint');
  if (hint) hint.textContent = EXEC_ENV_CARD_COPY[pick] || OTHER_COPY(label || pick);
  const links = card.querySelector('#exec-env-card-links');
  if (links) {
    const items = [docsLink(doc, 'choose-a-setup', 'Choose a setup'), docsLink(doc, 'security-overview', 'Security overview')];
    if (EXEC_ENV_DOCS[pick]) items.push(docsLink(doc, EXEC_ENV_DOCS[pick][0], EXEC_ENV_DOCS[pick][1]));
    links.replaceChildren();
    items.forEach((a, i) => { if (i) links.append(doc.createTextNode(' · ')); links.append(a); });
  }
  card.dataset.execBackend = pick;
}

/** Write the stored values (GET /api/settings) into the limit rows. The select is painted by app.js. */
export function paintExecEnvCardValues(card, data = {}) {
  if (!card) return;
  const set = (id, v) => { const n = card.querySelector(`#${id}`); if (n) n.value = v ?? ''; };
  set('e2b-max-sandboxes', data?.e2bMaxSandboxes);
  set('e2b-max-wait', data?.e2bMaxWaitMin);
  set('docker-max-sandboxes', data?.dockerMaxSandboxes);
  set('docker-max-wait', data?.dockerMaxWaitMin);
  const ds = data?.dockerSandbox && typeof data.dockerSandbox === 'object' ? data.dockerSandbox : {};
  set('docker-memory', ds.memory);
  set('docker-cpus', ds.cpus);
  set('docker-pids', ds.pids);
  set('docker-runtime', ds.runtime);
}

/** The POST /api/settings body: null clears a field (no team layer here). */
export function readExecEnvCard(card) {
  const sel = card?.querySelector('#e2b-exec-env')?.value;
  const sandbox = { memory: text(card, 'docker-memory'), cpus: num(card, 'docker-cpus'), pids: num(card, 'docker-pids'), runtime: text(card, 'docker-runtime') };
  return {
    execEnv: sel && sel !== 'local' ? sel : null,
    e2bMaxSandboxes: num(card, 'e2b-max-sandboxes'), e2bMaxWaitMin: num(card, 'e2b-max-wait'),
    dockerMaxSandboxes: num(card, 'docker-max-sandboxes'), dockerMaxWaitMin: num(card, 'docker-max-wait'),
    dockerSandbox: Object.values(sandbox).some((v) => v !== null) ? sandbox : null,
  };
}
