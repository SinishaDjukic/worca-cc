// ui/public/setup-where-agents-run.mjs — the setup assistant's "Where agents run" section (How you work step,
// docs/choose-a-setup.md). On a native install it picks the default execution environment (the user setting
// execEnv): Local (not sandboxed) always, Local sandbox (Docker) when the Check step found Docker running, E2B sandbox
// when an E2B key is set. A choice saved before stays offered even when its check fails now. No pick keeps the saved
// value; nothing here starts Docker. In a container, the hardened box or a hosted Worca it shows the posture
// (GET /api/security/posture) instead: there agents already run inside the box.
import { docsLink } from './docs-links.mjs';
import { postureBadge } from './security-status-view.mjs';

export const WHERE_TITLE = 'Where agents run';
export const EXEC_ENV_CHOICES = Object.freeze([
  Object.freeze({ name: 'local', label: 'Local', line: 'Agents run on this machine as you. They are not sandboxed and can reach what you can.' }),
  Object.freeze({ name: 'docker', label: 'Local sandbox (Docker)', line: 'Each run gets its own container on this machine: no mounts, network only through Worca. The first run builds the image (a few minutes).' }),
  Object.freeze({ name: 'e2b', label: 'E2B sandbox', line: 'Each run gets its own E2B sandbox. Commits, pushes and PRs stay here.' }),
]);

const checkState = (detect, id) => (detect?.checks || []).find((c) => c.id === id)?.state;

/** The choices to offer: Local, plus each sandbox its check found ready, plus the saved one. */
export function execEnvChoices(detect, saved = null) {
  const ready = { local: true, docker: checkState(detect, 'docker') === 'ok', e2b: checkState(detect, 'e2b') === 'ok' };
  return EXEC_ENV_CHOICES.filter((c) => ready[c.name] || c.name === saved);
}

/** True when the posture says Worca does not run natively (a box or a hosted server): no choice, the summary instead. */
export const inABox = (posture) => !!posture && typeof posture.where === 'string' && posture.where !== 'native';

/**
 * The section. `value`: the answer (null = Local); `onPick(name|null)`; `seg` and `section` are the assistant's own
 * builders, so it looks like every other section.
 */
export function whereAgentsRunSection({ doc, detect, posture, value, onPick, seg, section }) {
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const guide = el('p', 'hint sa-where-guide');
  guide.append('Which setup fits you? ', docsLink(doc, 'choose-a-setup', 'Choose a setup'));
  if (inABox(posture)) {
    // The Check step's table (badge, name, line), with the Security card's chips (same words, same colours).
    const list = el('table', 'sa-check sa-where-posture');
    const tbody = el('tbody');
    for (const r of posture.rows || []) {
      const tr = el('tr'); tr.dataset.posture = r.id;
      if (r.title) tr.title = r.title;
      const m = el('td', 'sa-check-mark'); m.append(postureBadge(doc, { value: r.value || r.status, tone: r.tone }));
      tr.append(m, el('td', 'sa-check-name', r.label), el('td', 'sa-check-line', r.detail));
      tbody.append(tr);
    }
    list.append(tbody);
    const where = posture.where === 'hosted' ? 'on a hosted server' : posture.where === 'hardened' ? 'in the hardened box' : 'in a container';
    return section(WHERE_TITLE, `Worca runs ${where}, so its agents already run inside it. This is how it is set up.`, list, guide);
  }
  const current = value || 'local';
  const choices = execEnvChoices(detect, current);
  const pick = choices.find((c) => c.name === current) || choices[0];
  const line = el('p', 'hint sa-where-line', pick.line);
  const extra = [];
  if (choices.length === 1) extra.push(el('p', 'hint sa-where-none', 'No sandbox found here. Start Docker for the Local sandbox, or set an E2B key, then open the setup again.'));
  // One choice is no choice: a plain line, not a one-button segmented control.
  if (choices.length === 1) {
    line.textContent = `${pick.label} · ${pick.line}`;
    return section(WHERE_TITLE, 'The default for new runs. You can pick another one per run.', line, ...extra, guide);
  }
  const control = seg(choices.map((c) => [c.name, c.label]), current, (v) => onPick(v === 'local' ? null : v), { label: WHERE_TITLE });
  control.classList.add('sa-where-pick');
  return section(WHERE_TITLE, 'The default for new runs. You can pick another one per run.', control, line, ...extra, guide);
}
