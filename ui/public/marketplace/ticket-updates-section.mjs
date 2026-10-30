// ui/public/marketplace/ticket-updates-section.mjs — Ticket updates in the manage sheet (plans/ticket-updates-design.md §8 boards
// 1–6, §10, §11; D2, D4, D12). Host-drawn: every tracker read goes through the server's /api/plugins/:name/ticket-updates
// routes (D8). The sheet owns Save: this module says when it is dirty, hands over the PUT body and takes the saved state
// back. Removing a project from Projects you work on keeps its rule (D2). Pure DOM; `doc` and `api` are injected.
import { icon } from '../icons.mjs';
import { createMoveSelect, FALLBACK_ERROR } from './move-select.mjs';
import { openProjectsPopover } from './projects-popover.mjs';

/** How many projects' statuses load at once when the section opens, to find a status that is gone (§8, board 5 E). */
export const STATUS_LOADS = 4;
export const TU_COPY = Object.freeze({
  title: 'Ticket updates',
  sub: "What Worca does to a ticket when a run that writes back finishes. A project's own rule wins over All projects.",
  projects: 'Projects you work on',
  addProjects: 'Add projects…',
  projectsHint: 'New run, Requirements export and import list only these. None picked = all projects.',
  rules: 'When a run finishes successfully',
  all: 'All projects',
  allSub: 'Unless a project below says otherwise',
  addRule: 'Add a project rule',
  allHaveRules: 'Every project you work on has a rule.',
  newRowHint: "A project rule lists that project's own statuses. The project list is the projects you work on (all projects when none are picked).",
  hint: "Any Done status: one the ticket can reach, never Won't Do, Rejected or Duplicate. When a move asks for a Resolution, Worca fills in Done, Fixed or Complete. Every update is the last line of Worca's comment on the ticket.",
  newRuleLabel: 'New rule: move to',
  project: 'Project',
});
export const notSavedLine = (tracker) => `Save this connection first. Ticket updates read ${tracker}'s projects and statuses through it.`;
export const goneLine = (key, name) => `${key} has no status named ${name} any more. Pick another; until then a run leaves ${key} tickets where they are and says so in its comment.`;

const list = (v) => (Array.isArray(v) ? v : []);
const fromLegacy = (t) => (t && t.category === 'done' ? { kind: 'category', value: 'done' }
  : t && typeof t.typed === 'string' && t.typed ? { kind: 'typed', value: t.typed } : null);
let instances = 0;   // two sections on one page (the same source twice) never share an element id

/**
 * @param {{doc:Document, api:(m:string,u:string,b?:object)=>Promise<{ok:boolean,status:number,data:any}>, plugin:string, sourceId:string,
 *   profile?:string|null, tracker?:string, popHost?:Element|null}} o
 */
export function createTicketUpdates({ doc, api, plugin, sourceId, profile = null, tracker = 'the tracker', popHost = null }) {
  const mk = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const enc = encodeURIComponent;
  const base = `/api/plugins/${enc(plugin)}/ticket-updates`;
  const query = `sourceId=${enc(sourceId)}${profile ? `&profile=${enc(profile)}` : ''}`;
  const sid = `${String(sourceId).replace(/[^A-Za-z0-9_-]/g, '-')}-${++instances}`;
  const el = mk('section', 'mk-tu');
  el.hidden = true;
  el.dataset.sourceId = sourceId;
  let info = null;           // the GET answer
  let projects = [];         // [{ value, label }] picked, in pick order
  let rules = [];            // [{ uid, project, label, target }]: All projects (project '') first; project null = a new row
  let baseline = '';
  let destroyed = false;
  let popover = null;
  let seq = 0;
  const selects = new Map(); // rule uid → its move select
  const statusCache = new Map();
  let projectsPromise = null;
  const refs = {};
  const uid = () => `mk-tu-${sid}-r${++seq}`;
  const profileLabel = () => (info && info.profile ? info.profile.label : tracker);
  const legacyField = () => (info && info.legacy && info.legacy.field) || null;

  // ---- reads, once per sheet opening; a failed one is asked again next time (§10 D) ----
  function statuses(key) {
    if (!key) return Promise.resolve([]);
    if (!statusCache.has(key)) {
      const p = api('GET', `${base}/statuses?${query}&project=${enc(key)}`).then((r) => {
        if (r?.ok) return list(r.data?.statuses);
        throw new Error(r?.data?.error || FALLBACK_ERROR);
      });
      p.catch(() => { if (statusCache.get(key) === p) statusCache.delete(key); });
      statusCache.set(key, p);
    }
    return statusCache.get(key);
  }
  function projectList() {
    if (!projectsPromise) {
      const p = api('GET', `${base}/projects?${query}`).then((r) => {
        if (r?.ok) return list(r.data?.projects);
        throw new Error(r?.data?.error || FALLBACK_ERROR);
      });
      p.catch(() => { if (projectsPromise === p) projectsPromise = null; });
      projectsPromise = p;
    }
    return projectsPromise;
  }

  // ---- what Save sends (D12) ----
  function collect() {
    return {
      projects: projects.map(({ value, label }) => ({ value, label })),
      rules: rules.filter((r) => r.project !== null).map((r) => (r.project
        ? { project: r.project, label: r.label, moment: 'finished', target: r.target }
        : { project: '', moment: 'finished', target: r.target })),
    };
  }

  // ---- projects you work on ----
  function renderChips() {
    refs.chips.replaceChildren(...projects.map((p) => {
      const c = mk('span', 'chip mk-tu-chip');
      c.setAttribute('role', 'listitem');
      c.dataset.value = p.value;
      c.append(mk('span', 'mk-mono mk-tu-key', p.value));
      if (p.label && p.label !== p.value) c.append(mk('span', 'mk-tu-cname', p.label));
      const x = mk('button', 'mk-tu-x');
      x.type = 'button';
      x.setAttribute('aria-label', `Remove ${p.value}`);
      x.append(icon(doc, 'x', 12));
      x.addEventListener('click', () => {
        projects = projects.filter((y) => y.value !== p.value);   // its rule stays (D2)
        renderChips();
        refreshRules();
        refs.addProjects.focus();
      });
      c.append(x);
      return c;
    }));
  }
  function openPopover() {
    popover = openProjectsPopover({ doc, anchor: refs.addProjects, host: popHost || doc.body, profileLabel: profileLabel(), tracker,
      isPicked: (v) => projects.some((p) => p.value === v), pickedCount: () => projects.length, loadProjects: projectList,
      onToggle: (p, on) => {
        const v = String(p.value);
        if (on && !projects.some((x) => x.value === v)) projects.push({ value: v, label: String(p.name || p.label || v) });
        if (!on) projects = projects.filter((x) => x.value !== v);
        renderChips();
        refreshRules();
      },
      onClose: () => { popover = null; } });
  }
  function projectsBlock() {
    const b = mk('div', 'mk-tu-block mk-tu-projects');
    const hid = `mk-tu-ph-${sid}`;
    const h = mk('h5', 'mk-tu-h', TU_COPY.projects);
    h.id = hid;
    refs.chips = mk('div', 'mk-tu-chips');
    refs.chips.setAttribute('role', 'list');
    refs.chips.setAttribute('aria-labelledby', hid);
    refs.addProjects = mk('button', 'btn btn-sm mk-tu-add-projects', TU_COPY.addProjects);
    refs.addProjects.type = 'button';
    refs.addProjects.setAttribute('aria-haspopup', 'dialog');
    refs.addProjects.setAttribute('aria-expanded', 'false');   // the popover sets it while open
    // its own press toggles: a second one while open closes it (the popover ignores presses on its anchor)
    refs.addProjects.addEventListener('click', () => (popover ? popover.close() : openPopover()));
    const row = mk('div', 'mk-tu-chiprow');
    row.append(refs.chips, refs.addProjects);
    b.append(h, row, mk('p', 'hint', TU_COPY.projectsHint));
    renderChips();
    return b;
  }

  // ---- the rules (Task 14b adds Add a project rule, the new row and remove) ----
  function ruleRow(r) {
    const row = mk('div', 'mk-tu-rule');
    row.setAttribute('role', 'listitem');
    row.dataset.uid = r.uid;
    const name = mk('div', 'mk-tu-name');
    if (r.project === '') {
      row.classList.add('mk-tu-all');
      name.append(mk('span', 'mk-tu-rname', TU_COPY.all), mk('span', 'hint mk-tu-rsub', TU_COPY.allSub));
    } else {
      row.dataset.project = r.project;
      name.append(mk('span', 'mk-mono mk-tu-key', r.project));
      if (r.label && r.label !== r.project) name.append(mk('span', 'mk-tu-rname', r.label));
    }
    const ms = createMoveSelect({ doc, project: r.project || '', value: r.target, general: !r.project, host: popHost || doc.body,
      loadStatuses: () => statuses(r.project),
      onChange: (t) => { r.target = t; } });
    selects.set(r.uid, ms);
    row.append(name, ms.el);
    return row;
  }
  /** After the projects you work on change. Task 14b gives it Add a project rule's state and the new row's picker. */
  function refreshRules() {}
  function rulesBlock() {
    const b = mk('div', 'mk-tu-block mk-tu-rulesblock');
    const hid = `mk-tu-rh-${sid}`;
    const h = mk('h5', 'mk-tu-h', TU_COPY.rules);
    h.id = hid;
    refs.listEl = mk('div', 'mk-tu-rules');
    refs.listEl.setAttribute('role', 'list');
    refs.listEl.setAttribute('aria-labelledby', hid);
    for (const r of rules) refs.listEl.append(ruleRow(r));
    b.append(h, refs.listEl, mk('p', 'hint mk-tu-hint', TU_COPY.hint));
    return b;
  }

  // ---- the section ----
  /** Close whatever is open (each widget drops its document listeners); the focus is left where it is. */
  function closeWidgets() {
    for (const s of selects.values()) s.destroy();
    selects.clear();
    popover?.close(false);
    popover = null;
  }
  function carriedNote() {
    const t = info.legacy && info.legacy.target;
    if (info.saved || !t) return [];
    const p = mk('p', 'hint mk-tu-carried');
    p.append(doc.createTextNode('Filled in from the old '), mk('strong', '', info.legacy.label),
      doc.createTextNode(' setting. Nothing changes until you save; after that, the old setting is no longer used.'));
    return [p];
  }
  function paint() {
    closeWidgets();
    const headId = `mk-tu-h-${sid}`;
    el.setAttribute('aria-labelledby', headId);
    const head = mk('div', 'mk-sec-head mk-tu-head');
    const h = mk('h4', 'subsection-title', TU_COPY.title);
    h.id = headId;
    head.append(h);
    if (info.profile) head.append(mk('span', 'mk-meta', info.profile.id === 'default' ? info.profile.label : `${info.profile.label} (${info.profile.id})`));
    if (info.connection !== 'saved') { el.replaceChildren(head, mk('p', 'hint mk-tu-new', notSavedLine(tracker))); return; }
    el.replaceChildren(head, mk('p', 'hint mk-tu-sub', TU_COPY.sub), projectsBlock(), ...carriedNote(), rulesBlock());
  }

  async function load() {
    const r = await api('GET', `${base}?${query}`);
    if (destroyed) return { available: false };
    if (!r?.ok || !r.data?.available) { el.hidden = true; return { available: false }; }
    info = r.data;
    projects = list(info.projects).filter((p) => p && p.value).map((p) => ({ value: String(p.value), label: String(p.label || p.value) }));
    const all = list(info.rules).find((x) => x && x.project === '');
    const carried = info.saved ? null : fromLegacy(info.legacy && info.legacy.target);
    rules = [{ uid: uid(), project: '', label: '', target: all ? all.target : (carried || { kind: 'none' }) },
      ...list(info.rules).filter((x) => x && x.project).map((x) => ({ uid: uid(), project: String(x.project), label: String(x.label || x.project), target: x.target }))];
    baseline = JSON.stringify(collect());   // a carried-over All projects row is not a change (§10 B)
    el.hidden = false;
    paint();
    return { available: true, saved: !!info.saved, connection: info.connection, legacyField: legacyField() };
  }

  return {
    el,
    load,
    dirty: () => !!info && info.connection === 'saved' && JSON.stringify(collect()) !== baseline,
    body: () => ({ sourceId, ...(profile ? { profile } : {}), ...collect() }),
    markSaved(sent) {
      baseline = JSON.stringify({ projects: sent.projects, rules: sent.rules });
      if (info) info = { ...info, saved: true };
      el.querySelector('.mk-tu-carried')?.remove();
    },
    legacyField,
    destroy() {
      destroyed = true;
      closeWidgets();
    },
  };
}
