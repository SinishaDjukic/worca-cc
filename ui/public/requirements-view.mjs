// ui/public/requirements-view.mjs
// The Requirements page (plans/requirements-design.md §6): the feature specs, and one feature's interview
// and spec. app.js owns routing and the WebSocket; this module owns the host it is given and routes
// through `deps.route(param)` (#requirements/<param>).
//
//   const view = createRequirementsView({ host, subEl, msgEl, deps });
//   view.show(param)    '' the list · 'new' a new feature · 'feature/<n>' one feature (the route's param)
//   view.changed(seq)   a `requirements-changed` frame: refetch what is on screen
//   view.destroy()

const STATUS = Object.freeze({
  looking: { label: 'Looking at the code', cls: 'running' },
  thinking: { label: 'Thinking', cls: 'running' },
  your_turn: { label: 'Your turn', cls: 'amber' },
  done: { label: 'Interview done', cls: 'green' },
  archived: { label: 'Archived', cls: '' },
});
const SECTIONS = [['goal', 'Goal'], ['actors', 'Actors'], ['flow', 'Main flow'], ['edgeCases', 'Edge cases'],
  ['rules', 'Business rules'], ['outOfScope', 'Out of scope'], ['openQuestions', 'Open questions']];
const KEYS = ['A', 'B', 'C', 'D'];
const MAX_ROUNDS = 6;

function h(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'hidden') node.hidden = !!v;
    else if (k === 'disabled') node.disabled = !!v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid);
  return node;
}

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) { const err = new Error(data.error || `HTTP ${res.status}`); err.status = res.status; err.data = data; throw err; }
  return data;
}

const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;

export function createRequirementsView({ host, subEl, msgEl, deps = {} }) {
  const route = deps.route || ((p) => { location.hash = p ? `#requirements/${p}` : '#requirements'; });
  let param = '';
  let seqShown = null;
  let paintNo = 0;
  let draft = null;          // { roundTurnId, picks: {id: option}, texts: {id: text} } — the open card's unsent answers
  let editing = null;        // the section open in its editor
  let targets = { projects: [], workspaces: [] };

  if (subEl) subEl.textContent = 'Turn an idea into a clear, testable feature spec before anything is built';
  const say = (text, kind = '') => { if (msgEl) { msgEl.textContent = text || ''; msgEl.className = `form-msg${kind ? ` ${kind}` : ''}`; } };
  const fail = (err) => say(err && err.status === 404
    ? 'Requirements are turned off, or this feature no longer exists.'
    : (err && err.message) || String(err), 'err');
  const act = async (fn) => { say(''); try { await fn(); } catch (err) { fail(err); } };

  async function loadTargets() {
    const [p, w] = await Promise.all([api('GET', '/api/projects').catch(() => ({})), api('GET', '/api/workspaces').catch(() => ({}))]);
    targets = { projects: p.projects || [], workspaces: w.workspaces || [] };
  }
  const targetName = (f) => (f.scopeType === 'workspace'
    ? targets.workspaces.find((w) => w.id === f.scopeKey)?.name
    : targets.projects.find((p) => p.key === f.scopeKey)?.name) || f.scopeKey;
  const targetLabel = (f) => `${f.scopeType === 'workspace' ? 'Workspace' : 'Project'} · ${targetName(f)}`;
  const badge = (status) => h('span', { class: `badge ${STATUS[status]?.cls || ''}`.trim(), text: STATUS[status]?.label || status });

  async function show(p = '') {
    param = String(p || '');
    const m = /^feature\/(?:FEAT-)?(\d+)$/.exec(param);
    const next = m ? Number(m[1]) : null;
    if (next !== seqShown) { draft = null; editing = null; }
    seqShown = next;
    say('');
    await paint();
  }
  async function changed(seq) { if (seqShown == null || Number(seq) === seqShown) await paint(); }

  async function paint() {
    const mine = ++paintNo;
    try {
      await loadTargets();
      if (param === 'new') { if (mine === paintNo) paintNew(); return; }
      if (seqShown != null) {
        const data = await api('GET', `/api/requirements/${seqShown}`);
        if (mine === paintNo) paintFeature(data.feature);
        return;
      }
      const data = await api('GET', '/api/requirements');
      if (mine === paintNo) paintList(data.features || []);
    } catch (err) {
      if (mine === paintNo) { host.replaceChildren(); fail(err); }
    }
  }

  function paintList(features) {
    const groups = new Map();
    for (const f of features) {
      const k = `${f.scopeType}:${f.scopeKey}`;
      if (!groups.has(k)) groups.set(k, { label: targetLabel(f), items: [] });
      groups.get(k).items.push(f);
    }
    host.replaceChildren(
      h('div', { class: 'req-actions' }, h('button', { type: 'button', class: 'btn-go', onclick: () => route('new') }, 'New feature')),
      features.length ? null : h('p', { class: 'hint', text: 'No features yet. Describe one in a few sentences and Worca interviews you about it.' }),
      ...[...groups.values()].map((g) => h('section', { class: 'req-group' },
        h('h3', { text: g.label }),
        ...g.items.map((f) => h('button', { type: 'button', class: 'req-row', onclick: () => route(`feature/${f.seq}`) },
          h('span', { class: 'req-id', text: f.id }),
          h('span', { class: 'req-title', text: f.title }),
          badge(f.status),
          h('span', { class: 'req-cost', text: usd(f.costUsd) }))))),
    );
  }

  function paintNew() {
    const select = h('select', { id: 'req-new-target', 'aria-label': 'Project or workspace' },
      targets.projects.length ? h('optgroup', { label: 'Projects' }, ...targets.projects.map((p) => h('option', { value: `project:${p.key}`, text: p.name }))) : null,
      targets.workspaces.length ? h('optgroup', { label: 'Workspaces' }, ...targets.workspaces.map((w) => h('option', { value: `workspace:${w.id}`, text: w.name }))) : null);
    const title = h('input', { id: 'req-new-title', type: 'text', maxlength: '200', placeholder: 'Cancel an order before it ships' });
    const desc = h('textarea', { id: 'req-new-desc', rows: '5', placeholder: 'A few sentences: who needs it, what they want to do, and why.' });
    const create = () => act(async () => {
      const [scopeType, ...rest] = select.value.split(':');
      const data = await api('POST', '/api/requirements', { scopeType, scopeKey: rest.join(':'), title: title.value, description: desc.value });
      route(`feature/${data.feature.seq}`);
    });
    host.replaceChildren(h('div', { class: 'card req-new' },
      h('label', { for: 'req-new-target', text: 'For' }), select,
      h('label', { for: 'req-new-title', text: 'Title' }), title,
      h('label', { for: 'req-new-desc', text: 'Describe it' }), desc,
      h('div', { class: 'req-actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => route('') }, 'Cancel'),
        h('button', { type: 'button', class: 'btn-go', onclick: create }, 'Start the interview'))));
  }

  function questionCard(f, pending) {
    if (!draft || draft.roundTurnId !== pending.turnId) {
      draft = { roundTurnId: pending.turnId, picks: {}, texts: {} };
      for (const q of pending.questions) if (q.recommended) draft.picks[q.id] = q.recommended;
    }
    const count = h('span', { class: 'qanswered' });
    const recount = () => {
      const n = pending.questions.filter((q) => draft.picks[q.id] || draft.texts[q.id]).length;
      count.textContent = `${n} of ${pending.questions.length} answered`;
    };
    const answers = () => pending.questions.map((q) => (draft.texts[q.id] ? { id: q.id, text: draft.texts[q.id] }
      : draft.picks[q.id] ? { id: q.id, option: draft.picks[q.id] } : null)).filter(Boolean);
    const post = (extra) => act(async () => {
      await api('POST', `/api/requirements/${f.seq}/answers`, { roundTurnId: pending.turnId, ...extra, answers: answers() });
      draft = null;
      await paint();
    });
    const panel = h('div', { class: 'qpanel req-q' },
      h('div', { class: 'qpanel-head' }, h('b', { text: 'Your turn' }),
        h('span', { class: 'qcount', text: `${pending.questions.length} question${pending.questions.length === 1 ? '' : 's'}` })),
      pending.note ? h('p', { class: 'hint', text: pending.note }) : null,
      ...pending.questions.map((q, i) => {
        const buttons = q.options.map((o, k) => h('button', { type: 'button', class: 'qopt', 'data-key': KEYS[k], 'aria-pressed': draft.picks[q.id] === o && !draft.texts[q.id] ? 'true' : 'false' },
          h('span', { class: 'qopt-txt', text: o }), o === q.recommended ? h('span', { class: 'qrec', text: 'Recommended' }) : null));
        const free = h('input', { class: 'qfree', type: 'text', value: draft.texts[q.id] || '', placeholder: 'Or type your own answer…', 'aria-label': `Your own answer to: ${q.question}` });
        const sync = () => {
          buttons.forEach((b, k) => { const on = !draft.texts[q.id] && draft.picks[q.id] === q.options[k]; b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('sel', on); });
          free.classList.toggle('has', !!draft.texts[q.id]);
          recount();
        };
        buttons.forEach((b, k) => b.addEventListener('click', () => { draft.picks[q.id] = q.options[k]; delete draft.texts[q.id]; free.value = ''; sync(); }));
        free.addEventListener('input', () => { const v = free.value.trim(); if (v) { draft.texts[q.id] = v; delete draft.picks[q.id]; } else delete draft.texts[q.id]; sync(); });
        queueMicrotask(sync);
        return h('div', { class: 'qblock' },
          h('div', { class: 'qtext' }, h('span', { class: 'qn', text: String(i + 1) }), q.question),
          q.why ? h('div', { class: 'hint req-why', text: q.why }) : null,
          h('div', { class: 'qopts' }, ...buttons), free);
      }),
      h('div', { class: 'qpanel-foot' }, count,
        h('button', { type: 'button', class: 'btn req-finish', onclick: () => act(async () => { await api('POST', `/api/requirements/${f.seq}/finish`, {}); await paint(); }) }, 'Finish now'),
        h('button', { type: 'button', class: 'btn req-skip', onclick: () => post({ useRecommended: true }) }, 'Skip, use recommended'),
        h('button', { type: 'button', class: 'btn-go', onclick: () => post({}) }, 'Submit')));
    recount();
    return panel;
  }

  function conversation(f) {
    const working = f.busy || f.status === 'looking' || f.status === 'thinking';
    return h('div', { class: 'req-left' },
      working ? h('p', { class: 'hint', text: f.status === 'looking' ? 'Worca is looking at the code…' : 'Worca is thinking…' }) : null,
      !working && f.lastError ? h('div', { class: 'req-error form-msg err' }, f.lastError, ' ',
        h('button', { type: 'button', class: 'btn btn-mini req-retry', onclick: () => act(async () => { await api('POST', `/api/requirements/${f.seq}/retry`, {}); await paint(); }) }, 'Try again')) : null,
      !working && f.pending ? questionCard(f, f.pending) : null,
      !working && f.status === 'done' ? h('p', { class: 'hint', text: 'The interview is done. Edit the spec on the right; every change is kept.' }) : null);
  }

  function sectionBlock(f, key, title) {
    const s = f.spec;
    const edited = !!s.edited?.[key];
    const working = f.busy || f.status === 'looking' || f.status === 'thinking' || f.status === 'archived';
    let body;
    if (editing === key) {
      const isGoal = key === 'goal';
      const a = isGoal ? h('input', { type: 'text', value: s.goal.text, 'aria-label': 'Goal' }) : h('textarea', { rows: '5', 'aria-label': title }, (s[key] || []).join('\n'));
      const b = isGoal ? h('input', { type: 'text', value: s.goal.measure, placeholder: 'Success measure', 'aria-label': 'Success measure' }) : null;
      body = h('div', { class: 'req-edit' }, a, b,
        h('div', { class: 'req-actions' },
          h('button', { type: 'button', class: 'btn', onclick: () => { editing = null; void paint(); } }, 'Cancel'),
          h('button', { type: 'button', class: 'btn-go', onclick: () => act(async () => {
            await api('PUT', `/api/requirements/${f.seq}/spec/${key}`, { value: isGoal ? { text: a.value, measure: b.value } : a.value });
            editing = null; await paint();
          }) }, 'Save')));
    } else if (key === 'goal') {
      body = s.goal.text ? h('div', {}, h('p', { text: s.goal.text }), s.goal.measure ? h('p', { class: 'hint', text: `Success measure: ${s.goal.measure}` }) : null) : h('p', { class: 'hint', text: 'Not yet.' });
    } else {
      const list = s[key] || [];
      body = list.length ? h(key === 'flow' ? 'ol' : 'ul', {}, ...list.map((t) => h('li', { text: t }))) : h('p', { class: 'hint', text: 'Not yet.' });
    }
    return h('section', { class: 'req-sect', 'data-section': key },
      h('div', { class: 'req-sect-head' }, h('h3', { text: title }),
        edited ? h('span', { class: 'req-edited', text: 'edited by you' }) : null,
        h('button', { type: 'button', class: 'btn-ghost btn-mini req-sect-edit', disabled: working, onclick: () => { editing = key; void paint(); } }, 'Edit'),
        edited ? h('button', { type: 'button', class: 'btn-ghost btn-mini req-sect-edit', disabled: working,
          onclick: () => act(async () => { await api('DELETE', `/api/requirements/${f.seq}/spec/${key}/edited`); await paint(); }) }, 'Let Worca rewrite this') : null),
      body);
  }

  function criteriaBlock(f) {
    const working = f.busy || f.status === 'looking' || f.status === 'thinking' || f.status === 'archived';
    const input = h('input', { type: 'text', placeholder: 'Add a criterion: what a tester can check', 'aria-label': 'New acceptance criterion' });
    return h('section', { class: 'req-sect', 'data-section': 'criteria' },
      h('div', { class: 'req-sect-head' }, h('h3', { text: 'Acceptance criteria' })),
      ...f.spec.criteria.map((c) => h('div', { class: 'req-item', 'data-criterion': c.id },
        h('code', { text: c.id }), h('span', { class: 'req-item-text', text: c.text }),
        h('button', { type: 'button', class: 'btn-ghost btn-mini req-sect-edit', disabled: working, 'aria-label': `Remove ${c.id}`,
          onclick: () => act(async () => { await api('DELETE', `/api/requirements/${f.seq}/criteria/${c.id}`); await paint(); }) }, 'Remove'))),
      h('div', { class: 'req-item' }, input,
        h('button', { type: 'button', class: 'btn btn-mini req-sect-edit', disabled: working,
          onclick: () => act(async () => { await api('POST', `/api/requirements/${f.seq}/criteria`, { text: input.value }); await paint(); }) }, 'Add')));
  }

  function assumptionsBlock(f) {
    const working = f.busy || f.status === 'looking' || f.status === 'thinking' || f.status === 'archived';
    const set = (a, status) => act(async () => { await api('POST', `/api/requirements/${f.seq}/assumptions/${a.id}`, { status }); await paint(); });
    return h('section', { class: 'req-sect', 'data-section': 'assumptions' },
      h('div', { class: 'req-sect-head' }, h('h3', { text: 'Assumptions' })),
      f.spec.assumptions.length ? null : h('p', { class: 'hint', text: 'None yet.' }),
      ...f.spec.assumptions.map((a) => h('div', { class: 'req-item', 'data-assumption': a.id },
        h('code', { text: a.id }), h('span', { class: 'req-item-text', text: a.text }),
        h('span', { class: `badge ${a.status === 'confirmed' ? 'green' : a.status === 'rejected' ? 'red' : 'amber'}`, text: a.status }),
        h('button', { type: 'button', class: 'btn btn-mini req-confirm req-sect-edit', disabled: working, 'aria-pressed': a.status === 'confirmed' ? 'true' : 'false',
          onclick: () => set(a, a.status === 'confirmed' ? 'open' : 'confirmed') }, 'Confirm'),
        h('button', { type: 'button', class: 'btn btn-mini req-reject req-sect-edit', disabled: working, 'aria-pressed': a.status === 'rejected' ? 'true' : 'false',
          onclick: () => set(a, a.status === 'rejected' ? 'open' : 'rejected') }, 'Reject'))));
  }

  function contextPanel(f) {
    const area = h('textarea', { rows: '4', 'aria-label': 'Shared context', placeholder: 'Actors, terms and standing rules every feature here should know' });
    const look = h('input', { type: 'checkbox', id: 'req-ctx-look' });
    const panel = h('details', { class: 'req-context' },
      h('summary', { text: f.scopeType === 'workspace' ? 'Workspace context' : 'Project context' }),
      area, h('label', { for: 'req-ctx-look' }, look, ' Let Worca look at the code when a feature starts'),
      h('div', { class: 'req-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => act(async () => {
        await api('PUT', `/api/requirements/context/${f.scopeType}/${encodeURIComponent(f.scopeKey)}`, { body: area.value, lookAtCode: look.checked });
        say('Context saved.', 'ok');
      }) }, 'Save context')));
    panel.addEventListener('toggle', () => {
      if (!panel.open) return;
      void act(async () => {
        const c = await api('GET', `/api/requirements/context/${f.scopeType}/${encodeURIComponent(f.scopeKey)}`);
        area.value = c.body; look.checked = c.lookAtCode;
      });
    });
    return panel;
  }

  function orientationBox(f) {
    const o = f.orientation;
    const text = !o ? 'Not looked yet.'
      : o.skipped === 'off' ? 'Looking at the code is turned off for this one (Project context).'
        : o.skipped === 'no-repo' ? 'There is no repository to look at yet.'
          : o.skipped === 'failed' ? 'Worca could not look at the code this time; the interview runs without it.'
            : o.summary || 'Nothing relevant found.';
    return h('details', { class: 'req-orient' },
      h('summary', { text: 'What Worca found in the code' }),
      h('p', { text }),
      o && o.files && o.files.length ? h('ul', { class: 'hint', 'data-min-level': 'advanced' }, ...o.files.map((p) => h('li', { text: p }))) : null,
      h('button', { type: 'button', class: 'btn btn-mini req-sect-edit', disabled: f.busy || f.status === 'archived',
        onclick: () => act(async () => { await api('POST', `/api/requirements/${f.seq}/look`, {}); await paint(); }) }, 'Look again'));
  }

  function paintFeature(f) {
    const save = () => act(async () => {
      try {
        const r = await api('POST', `/api/requirements/${f.seq}/save`, {});
        say(`Saved to ${r.path} (not committed).`, 'ok');
      } catch (err) {
        if (err.data?.error !== 'exists') throw err;
        if (!window.confirm(`${err.data.path} already exists. Replace it?`)) return;
        const r = await api('POST', `/api/requirements/${f.seq}/save`, { overwrite: true });
        say(`Saved to ${r.path} (not committed).`, 'ok');
      }
    });
    const copy = () => act(async () => {
      const text = await (await fetch(`/api/requirements/${f.seq}/markdown`)).text();
      await navigator.clipboard.writeText(text);
      say('Copied as Markdown.', 'ok');
    });
    host.replaceChildren(
      h('div', { class: 'req-head' }, h('h2', { text: `${f.id} · ${f.title}` }), badge(f.status)),
      h('div', { class: 'req-meta' },
        h('span', { text: targetLabel(f) }),
        h('span', { text: `Round ${Math.min(f.rounds, MAX_ROUNDS)} of ${MAX_ROUNDS}` }),
        h('span', { text: `Cost so far ${usd(f.costUsd)}` }),
        f.savedPath ? h('span', { text: `Saved as ${f.savedPath}` }) : null),
      h('div', { class: 'req-actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => route('') }, 'All features'),
        f.scopeType === 'project' ? h('button', { type: 'button', class: 'btn', onclick: save }, 'Save to specs/') : null,
        h('button', { type: 'button', class: 'btn', onclick: copy }, 'Copy Markdown'),
        h('a', { class: 'btn', href: `/api/requirements/${f.seq}/markdown?download=1`, download: '' }, 'Download .md'),
        h('button', { type: 'button', class: 'btn', disabled: f.busy, onclick: () => act(async () => {
          await api('POST', `/api/requirements/${f.seq}/archive`, f.status === 'archived' ? { restore: true } : {});
          await paint();
        }) }, f.status === 'archived' ? 'Restore' : 'Archive')),
      orientationBox(f),
      contextPanel(f),
      h('div', { class: 'req-cols' },
        conversation(f),
        h('div', { class: 'req-right' },
          ...SECTIONS.slice(0, 6).map(([k, t]) => sectionBlock(f, k, t)),
          criteriaBlock(f), assumptionsBlock(f),
          sectionBlock(f, ...SECTIONS[6]))),
    );
  }

  return { show, changed, destroy: () => { paintNo += 1; host.replaceChildren(); } };
}
