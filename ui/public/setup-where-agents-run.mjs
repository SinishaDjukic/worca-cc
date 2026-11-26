// ui/public/setup-where-agents-run.mjs — the setup assistant's "Where agents run" section (How you work step,
// docs/choose-a-setup.md). On a native install it picks the default execution environment (the user setting
// execEnv): Local (not sandboxed) always, Local sandbox (Docker) when the Check step found Docker running, E2B sandbox
// when an E2B key is set. A choice saved before stays offered even when its check fails now. No pick keeps the saved
// value; nothing here starts Docker. In a container, the hardened box or a hosted Worca it shows the posture
// (GET /api/security/posture) instead: there agents already run inside the box.
import { docsLink } from './docs-links.mjs';

export const WHERE_TITLE = 'Where agents run';
export const EXEC_ENV_CHOICES = Object.freeze([
  Object.freeze({ name: 'local', label: 'Local', line: 'Agents run on this machine as you. Not sandboxed: they can reach what you can.' }),
  Object.freeze({ name: 'docker', label: 'Local sandbox (Docker)', line: 'Each run gets its own container on this machine: no mounts, network only through Worca. The first run builds the image (a few minutes).' }),
  Object.freeze({ name: 'e2b', label: 'E2B sandbox', line: 'Each run gets its own E2B sandbox. Commits, pushes and PRs stay here.' }),
]);
const STATUS_BADGE = Object.freeze({ on: ['green', 'On'], off: ['grey', 'Off'], unknown: ['amber', 'Unknown'] });

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
  guide.append('Which setup fits you: ', docsLink(doc, 'choose-a-setup', 'Choose a setup', { className: 'link' }), '.');
  if (inABox(posture)) {
    const list = el('ul', 'sa-rows sa-where-posture');
    for (const r of posture.rows || []) {
      const li = el('li', 'sa-row'); li.dataset.posture = r.id;
      const [tone, text] = STATUS_BADGE[r.status] || STATUS_BADGE.unknown;
      const main = el('div', 'sa-row-main'); main.append(el('div', null, r.label), el('div', 'sa-row-line', r.detail));
      li.append(el('span', `badge ${tone}`, text), main);
      list.append(li);
    }
    const where = posture.where === 'hosted' ? 'on a hosted server' : posture.where === 'hardened' ? 'in the hardened box' : 'in a container';
    return section(WHERE_TITLE, `Worca runs ${where}, so its agents already run inside it. This is how it is set up:`, list, guide);
  }
  const current = value || 'local';
  const choices = execEnvChoices(detect, current);
  const pick = choices.find((c) => c.name === current) || choices[0];
  const line = el('p', 'hint sa-where-line', pick.line);
  const extra = [];
  if (choices.length === 1) extra.push(el('p', 'hint sa-where-none', 'No sandbox found here: start Docker for the Local sandbox, or set E2B_API_KEY for E2B, then open the setup again.'));
  const control = seg(choices.map((c) => [c.name, c.label]), current, (v) => onPick(v === 'local' ? null : v), { label: WHERE_TITLE });
  control.classList.add('sa-where-pick');
  return section(WHERE_TITLE, 'The default for new runs. You can pick another one per run.', control, line, ...extra, guide);
}
