// ui/public/exec-env-project-view.mjs — the project page's sandbox environments, under "Execution environment"
// (docs/e2b.md "Per-project templates"): per backend, its project fields (e2b: template, sandbox network) with the one
// in use, the read-only environment spec, the last build (stale, or made on another server), and Build / Rebuild (the
// server builds; a failed build keeps the previous template). Polls while a build runs.
import { notify, cardAlert } from './feedback.mjs';

const el = (doc, tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const when = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return iso; } };

export function mountExecEnvPanel(host, { projectKey, fetchFn = (u, o) => fetch(u, o), pollMs = 2000,
  schedule = (f, ms) => setTimeout(f, ms), cancel = (t) => clearTimeout(t) }) {
  const doc = host.ownerDocument;
  const base = `/api/projects/${encodeURIComponent(projectKey)}/exec-env`;
  let timer = null; let stopped = false;
  const call = async (url, opts) => { const r = await fetchFn(url, opts); let d = null; try { d = await r.json(); } catch { /* none */ } if (!r.ok) throw new Error(d?.error || `The server answered ${r.status}.`); return d; };

  const render = (view) => {
    host.replaceChildren();
    if (!view || !Array.isArray(view.backends)) return;   // an older server: nothing to show
    const backends = view.backends.filter((b) => b.fields.length || b.canBuild);
    for (const b of backends) {
      const box = el(doc, 'div', 'exec-env-backend'); box.dataset.backend = b.name;
      box.append(el(doc, 'h4', null, b.label));
      for (const f of b.fields) {
        const row = el(doc, 'label', 'field exec-env-field-row'); row.append(el(doc, 'span', null, f.label));
        let input;
        if (Array.isArray(f.options)) {
          // A choice (e2b: Sandbox network): an unset field shows the value it means (`placeholder`).
          input = el(doc, 'select', 'select exec-env-field');
          for (const o of f.options) { const opt = el(doc, 'option', null, o.label); opt.value = o.value; input.append(opt); }
          input.value = f.value ?? f.placeholder ?? f.options[0]?.value ?? '';
        } else {
          input = el(doc, 'input', 'input exec-env-field'); input.value = f.value ?? '';
          input.placeholder = b.effective && b.effective.source !== 'project' ? `${b.effective.name} (${b.effective.from})` : '';
        }
        input.dataset.field = f.key;
        row.append(input); box.append(row);
        if (f.help) box.append(el(doc, 'p', 'hint exec-env-field-help', f.help));
      }
      if (b.fields.length) {
        const save = el(doc, 'button', 'btn btn-sm exec-env-save', 'Save'); save.type = 'button';
        save.addEventListener('click', () => void saveFields(b, box));
        box.append(save);
      }
      if (b.effective) box.append(el(doc, 'p', 'hint exec-env-effective', `In use: ${b.effective.name} (${b.effective.from})`));
      if (b.canBuild) {
        const spec = view.spec;
        if (spec) {
          const det = el(doc, 'details', 'exec-env-spec');
          det.append(el(doc, 'summary', null, `Environment spec: ${spec.tools.length} tools, ${spec.apt.length} apt packages`),
            el(doc, 'pre', null, JSON.stringify({ tools: spec.tools, apt: spec.apt }, null, 2)));
          box.append(det);
        } else {
          box.append(el(doc, 'p', 'hint exec-env-spec-missing', `No environment spec yet. Set one with: worca exec-env spec --project ${projectKey} --set spec.json`));
        }
        const status = el(doc, 'p', 'hint exec-env-build-status', buildText(b)); box.append(status);
        const btn = el(doc, 'button', 'btn btn-sm exec-env-build', b.build ? 'Rebuild environment' : 'Build environment'); btn.type = 'button';
        btn.disabled = !spec || b.job?.state === 'running';
        btn.addEventListener('click', () => void build(b, box));
        box.append(btn);
        if (b.job?.tail?.length) box.append(el(doc, 'pre', 'exec-env-log', b.job.tail.join('\n')));
      }
      host.append(box);
    }
    // Poll while a build runs — but never for a panel that was stopped or replaced (the settings view re-renders
    // after every card Save; app.js swaps .pd-settings on navigation without a teardown).
    if (!stopped && host.isConnected && backends.some((b) => b.job?.state === 'running')) { cancel(timer); timer = schedule(() => void reload(), pollMs); }
  };
  const buildText = (b) => {
    if (b.job?.state === 'running') return `Building ${b.buildName}…`;
    const parts = [];
    if (b.job?.state === 'error') parts.push(`Last build failed: ${b.job.error}. The previous ${b.environmentNoun} stays in use.`);
    if (b.build && b.elsewhere) {
      // The record names an environment on the server the build ran against, not this one (docs/e2b.md).
      parts.push(`Built ${b.build.name} on another ${b.title || b.label} server (${b.elsewhere.builtOn}) — Rebuild for this server (${b.elsewhere.here}). Runs use ${b.effective?.name} until then.`);
      return parts.join(' ');
    }
    if (b.build) parts.push(`Built ${b.build.name} on ${when(b.build.builtAt)}${b.build.buildId ? ` (build ${b.build.buildId})` : ''}.`);
    else parts.push(`Not built yet: runs use ${b.effective?.name}.`);
    if (b.stale?.stale) parts.push(`Out of date: ${b.stale.reasons.join('; ')}.`);
    return parts.join(' ');
  };
  const saveFields = async (b, box) => {
    cardAlert(box, null);
    const values = Object.fromEntries([...box.querySelectorAll('.exec-env-field')].map((i) => [i.dataset.field, i.value.trim() || null]));
    try { render(await call(`${base}/config`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backend: b.name, values }) })); notify({ tone: 'ok', title: 'Saved', detail: 'New runs of this project use it.' }, { doc }); }
    catch (err) { cardAlert(box, { title: 'Not saved', detail: err.message }); }
  };
  const build = async (b, box) => {
    cardAlert(box, null);
    try { await call(`${base}/build`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backend: b.name }) }); await reload(); }
    catch (err) { cardAlert(box, { title: 'Build not started', detail: err.message }); }
  };
  const reload = async () => { if (stopped) return; try { render(await call(base)); } catch { host.replaceChildren(); } };
  void reload();
  return { reload, stop: () => { stopped = true; cancel(timer); timer = null; } };
}
