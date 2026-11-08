// Workflows on Rail (Wave 3, 3.2): dev's Library and editors, Rail's design. One list in the one bar, its sentence
// choosing workflows, agents or scripts and whose; a workflow's page reads its steps as rows on the cards' rail (each step
// a sentence with its model and effort, a loop a sentence of its own), never a canvas of boxes; an agent's and a script's
// page are their settings as sentences. Building and changing one is a conversation (Chat's Build workflow), as it is now.
(function () {
  const R = window.RailUI;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const say = (t, undo) => window.RailPulse?.say(t, undo);
  const MODELS = ['Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5', 'Codex high', 'Gemini Pro'], EFFORTS = ['low', 'medium', 'high'];
  const data = {
    workflow: [
      { id: 'default', title: 'Default', own: false, domain: 'coding', used: 'Used by 14 tasks this week', pinned: true, steps: [['Plan', 'planner', 'Opus 5.5', 'high'], ['Build', 'implementer', 'Sonnet 5.5', 'high'], ['Review', 'reviewer', 'Opus 5.5', 'medium']], loops: [['Review', 'Build', 3]] },
      { id: 'full', title: 'Full', own: false, domain: 'coding', used: 'Used by 3 tasks this week', steps: [['Clarify', 'clarify', 'Opus 5.5', 'high'], ['Plan', 'planner', 'Opus 5.5', 'high'], ['Build', 'implementer', 'Sonnet 5.5', 'high'], ['Review', 'reviewer', 'Opus 5.5', 'high'], ['Run tests', 'run-tests', '', '']], loops: [['Review', 'Build', 3], ['Run tests', 'Build', 2]] },
      { id: 'quick-fix', title: 'Quick Fix', own: false, domain: 'coding', used: 'Used by 6 tasks this week', steps: [['Build', 'implementer', 'Sonnet 5.5', 'medium'], ['Run tests', 'run-tests', '', '']], loops: [] },
      { id: 'api-rewrite', title: 'API rewrite', own: true, domain: 'coding', used: 'Saved from a chat yesterday', steps: [['Plan', 'planner', 'Opus 5.5', 'high'], ['Build', 'implementer', 'Opus 5.5', 'high'], ['Diff gate', 'diff-gate', '', ''], ['Review', 'reviewer', 'Opus 5.5', 'high']], loops: [['Review', 'Build', 2]] },
      { id: 'presentation', title: 'Presentation', own: false, domain: 'presentation', used: 'Not used yet', steps: [['Outline', 'planner', 'Opus 5.5', 'medium'], ['Slides', 'implementer', 'Sonnet 5.5', 'medium']], loops: [] },
    ],
    agent: [
      { id: 'planner', title: 'Plan', own: false, domain: 'coding', type: 'producer', ins: 'the task, your answers', outs: 'the plan', model: 'Opus 5.5', effort: 'high', asks: true, fan: true },
      { id: 'implementer', title: 'Implementation', own: false, domain: 'coding', type: 'producer', ins: 'the plan, a fix to make', outs: 'the change', model: 'Sonnet 5.5', effort: 'high', asks: false, fan: true },
      { id: 'reviewer', title: 'Review', own: false, domain: 'coding', type: 'verifier', ins: 'the change', outs: 'a review when it blocks, a pass when clean', model: 'Opus 5.5', effort: 'medium', asks: false, fan: false },
      { id: 'clarify', title: 'Clarify', own: false, domain: 'coding', type: 'clarifier', ins: 'the task', outs: 'your answers', model: 'Opus 5.5', effort: 'high', asks: true, fan: false },
      { id: 'security', title: 'Security review', own: true, domain: 'coding', type: 'verifier', ins: 'the change', outs: 'findings when it blocks', model: 'Opus 5.5', effort: 'high', asks: false, fan: false },
    ],
    script: [
      { id: 'diff-gate', title: 'Diff gate', own: false, domain: 'coding', runtime: 'Node.js', what: 'Blocks the review when the diff touches more files than allowed', param: ['Most files', '40'], timeout: '600 s', cases: 2 },
      { id: 'todo-gate', title: 'TODO gate', own: false, domain: 'coding', runtime: 'Python', what: 'Blocks when the change adds more TODOs than allowed', param: ['Most TODOs', '5'], timeout: '600 s', cases: 1 },
      { id: 'run-tests', title: 'Run tests', own: true, domain: 'coding', runtime: 'Shell', what: 'Runs the test suite: exit 0 passes, exit 1 blocks', param: ['Command', 'npm test'], timeout: '900 s', cases: 3 },
    ],
  };
  const NOUN = { workflow: 'workflows', agent: 'agents', script: 'scripts' };
  const view = { what: 'workflow', whose: 'all' };
  let current = '', menu = '', confirm = null, ctl = null, home = null, bar = null, page = null;
  const find = (k) => { const [kind, id] = k.split(':'); return { kind, x: data[kind]?.find((y) => y.id === id) }; };
  const titleOf = (id) => data.agent.find((a) => a.id === id)?.title || data.script.find((s) => s.id === id)?.title || id;
  const usedIn = (id) => data.workflow.filter((w) => w.steps.some((s) => s[1] === id)).map((w) => w.title);
  const meta = (kind, x) => (kind === 'workflow' ? `${x.steps.length} steps${x.loops.length ? ` · ${x.loops.length} ${x.loops.length === 1 ? 'loop' : 'loops'}` : ''}` : kind === 'agent' ? x.type : x.runtime);
  const markOf = (kind, size) => R.kindMark({ kind, size });
  const rowOf = (kind) => (x) => ({ key: `${kind}:${x.id}`, _k: kind, _x: x, title: x.title, mark: markOf(kind), end: meta(kind, x), current: `${kind}:${x.id}` === current, tip: `${x.title}\n${x.own ? 'Yours' : 'Built-in'} · ${x.domain}\n${kind === 'workflow' ? x.used : kind === 'agent' ? `Takes ${x.ins}; gives ${x.outs}` : x.what}`,
    menu: [{ id: x.own ? 'chat' : 'copy', text: x.own ? 'Change it in a chat' : 'Use as a template', help: x.own ? 'Worca changes it with you' : 'A copy of yours, to change' }, ...(kind === 'workflow' ? [{ id: 'pin', text: x.pinned ? 'Unpin from Chat' : 'Pin to Chat', help: 'Its starter on Chat\'s home' }, { id: 'export', text: 'Export…', help: 'As a file, a Claude Code skill or a Worca plugin' }] : []), ...(x.own ? [{ sep: true }, { id: 'delete', text: 'Delete…', danger: true, help: 'Asks first' }] : [])] });

  function act(id, rows) {
    const r = rows[0]; if (!r) return; const kind = r._k, x = r._x;
    if (id === 'chat') { window.RailConversation?.start('ask', `Change ${x.title}: `); return; }
    if (id === 'copy') { const c = { ...structuredClone(x), id: `${x.id}-copy`, title: `${x.title} copy`, own: true, pinned: false }; data[kind].push(c); current = `${kind}:${c.id}`; window.RailShell.go(`workflows/${current}`); say(`${c.title}: yours to change`); return; }
    if (id === 'pin') { x.pinned = !x.pinned; draw(); say(x.pinned ? `${x.title} is a starter on Chat` : `${x.title} left Chat's starters`); return; }
    if (id === 'export') { current = `${kind}:${x.id}`; menu = 'wf-export'; window.RailShell.go(`workflows/${current}`); return; }
    if (id === 'delete') { current = `${kind}:${x.id}`; confirm = { kind, x }; window.RailShell.go(`workflows/${current}`); }
  }

  function pageHtml(kind, x) {
    const pick = (id, text, items, tip) => R.sentencePicker({ id, text, tip, items: items.map((v) => ({ id: v, text: v, checked: v === text })), open: menu === id, chevron: R.icon('chevron', 10) });
    const used = kind === 'workflow' ? x.used : usedIn(x.id).length ? `In ${usedIn(x.id).join(', ')}` : 'In no workflow yet';
    const more = R.moreMenu({ id: 'wf-more', label: `More for ${x.title}`, icon: R.icon('more', 16), open: menu === 'wf-more', items: rowOf(kind)(x).menu.filter((m) => m.id !== (x.own ? 'chat' : 'copy')) });
    const head = R.placeHead({ title: x.title, facts: esc(`${x.own ? 'Yours' : 'Built-in'} · ${x.domain} · ${meta(kind, x)}`), mark: markOf(kind), word: x.own ? 'Yours' : 'Built-in', why: used,
      action: R.button({ label: x.own ? 'Change it in a chat' : 'Use as a template', attrs: { 'data-wf-act': x.own ? 'chat' : 'copy', title: x.own ? 'Worca changes it with you, step by step' : 'Makes a copy of yours; a built-in stays as it is' } }), menu: more });
    const strip = confirm?.x === x ? R.confirmStrip({ text: `Delete ${x.title}? ${kind === 'workflow' ? 'Tasks it ran keep their history; schedules that use it stop.' : `Workflows that use it: ${usedIn(x.id).join(', ') || 'none'}.`}`, yes: 'Delete', danger: true }) : '';
    const exp = menu === 'wf-export' ? `<div class="card-form">${R.confirmForm({ form: 'export', id: 'wf-export-t', text: `Export ${x.title}`, body: `<span class="tp-sentence">As ${pick('wf-as', x.as || 'a JSON file', ['a JSON file', 'a Claude Code skill', 'a Worca plugin'], 'What it becomes')}, with the agents it uses</span>` + R.confirmActions({ yes: 'Export' }) })}</div>` : '';
    const ro = !x.own;   // a built-in reads; its copy is yours to change
    let body = '';
    if (kind === 'workflow') {
      const steps = x.steps.map(([name, ref, model, effort], i) => R.settingsRow({ name: `${i + 1}. ${name}`, sentence: `${esc(titleOf(ref))}${model ? ` on ${ro ? `<b>${esc(model)}</b>` : pick(`wfm-${i}`, model, MODELS, 'Its model')} ${ro ? esc(effort) : pick(`wfe-${i}`, effort, EFFORTS, 'How hard it thinks')}` : ' (a script)'}` }));
      const loops = x.loops.map(([from, to, n], i) => R.settingsRow({ name: 'Loop', sentence: `${esc(from)} sends it back to ${esc(to)}, up to ${ro ? `<b>${n}</b>` : pick(`wfl-${i}`, String(n), ['1', '2', '3', '5'], 'How many rounds')} times` }));
      body = R.settingsSection({ title: 'Its steps', meta: ro ? 'A built-in reads as it is; Use as a template to change it.' : 'Change a step here, or say what to change in a chat.', rows: steps.join('') + loops.join('') });
    } else if (kind === 'agent') {
      body = R.settingsSection({ title: 'What it does', rows: [R.settingsRow({ name: 'Takes', sentence: esc(x.ins) }), R.settingsRow({ name: 'Gives', sentence: esc(x.outs) }), R.settingsRow({ name: 'Kind', sentence: esc({ producer: 'Makes something', verifier: 'Checks, and blocks when something is wrong', clarifier: 'Asks you, then passes your answers on' }[x.type]) })].join('') })
        + R.settingsSection({ title: 'How it runs', rows: [R.settingsRow({ name: 'Model', sentence: `Runs on ${ro ? `<b>${esc(x.model)}</b> ${esc(x.effort)}` : `${pick('ag-model', x.model, MODELS, 'Its model')} ${pick('ag-effort', x.effort, EFFORTS, 'How hard it thinks')}`}` }),
          R.settingsRow({ name: 'Questions', sentence: x.asks ? 'Asks you when something is unclear' : 'Never asks; it decides', end: ro ? '' : R.switchButton({ on: x.asks, label: 'Asks questions', attrs: { 'data-wf-sw': 'asks' } }) }),
          R.settingsRow({ name: 'Research', sentence: x.fan ? 'Sends helpers to read the code first' : 'Reads the code itself', end: ro ? '' : R.switchButton({ on: x.fan, label: 'Research fan-out', attrs: { 'data-wf-sw': 'fan' } }) })].join('') });
    } else {
      body = R.settingsSection({ title: 'What it does', rows: [R.settingsRow({ name: 'Does', sentence: esc(x.what) }), R.settingsRow({ name: 'Runs', sentence: `${esc(x.runtime)}, stopped after ${esc(x.timeout)}` }), R.settingsRow({ name: esc(x.param[0]), sentence: `<b>${esc(x.param[1])}</b> unless a workflow says otherwise` })].join('') })
        + R.settingsSection({ title: 'Its tests', rows: R.settingsRow({ name: 'Cases', sentence: `${x.cases} saved ${x.cases === 1 ? 'case' : 'cases'}`, end: R.button({ label: 'Run all', kind: 'quiet', attrs: { 'data-wf-run': x.id } }) }) });
    }
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${head}${strip}${exp}${body}</div></div><div class="convo-dock" id="wf-dock"></div></div>`;
  }

  function draw() {
    if (!bar || !page) return;
    ctl?.paint();
    const { kind, x } = current ? find(current) : {};
    if (!x) { home ||= window.RailConversation?.mount(page, { mode: 'ask', where: '#route-place', title: 'Build a workflow', note: 'Say what it should do; Worca proposes its steps, and you save it.' }); home?.show(''); return; }
    home = null; page.innerHTML = pageHtml(kind, x);
    window.RailConversation?.dock(document.getElementById('wf-dock'), { kind, title: x.title, chat: '' });
  }
  function wire(b, pg) {
    bar = b; page = pg;
    const shown = (k) => data[k].filter((x) => view.whose === 'all' || (view.whose === 'yours') === x.own);
    ctl = R.listController({ root: bar, spec: { noun: NOUN[view.what], label: 'Selected', view: () => ({ state: 'ready',
      parts: [{ word: 'Showing', id: 'what', text: NOUN[view.what], tip: 'Workflows, the agents they run, or the scripts they call', items: Object.keys(NOUN).map((k) => ({ id: k, text: NOUN[k], checked: view.what === k, hint: String(data[k].length) })) },
        { word: 'from', id: 'whose', text: view.whose === 'all' ? 'everyone' : view.whose === 'yours' ? 'you' : 'Worca', tip: 'Yours, or built in', items: [['all', 'everyone'], ['yours', 'you'], ['built', 'Worca']].map(([id, text]) => ({ id, text, checked: view.whose === id })) }],
      sections: [{ id: 'yours', title: 'Yours', rows: shown(view.what).filter((x) => x.own).map(rowOf(view.what)) }, { id: 'built', title: 'Built-in', rows: shown(view.what).filter((x) => !x.own).map(rowOf(view.what)) }],
      empty: { text: `No ${NOUN[view.what]} here.`, action: 'Build workflow' } }),
      can: () => ['menu'], bulk: () => [], act, open: (r) => window.RailShell.go(`workflows/${r._k}:${r._x.id}`), word: (id, v) => { view[id] = v; return false; }, say,
      active: () => /^#workflows/.test(location.hash), emptyAct: () => window.RailConversation?.starter('workflow') } });
    page.addEventListener('click', (e) => {
      const on = (q) => e.target.closest(q); let hit; const { kind, x } = current ? find(current) : {}; if (!x || !page.querySelector('#wf-dock')) return;
      if ((hit = on('[data-wf-act]'))) { act(hit.dataset.wfAct, [{ _k: kind, _x: x }]); return; }
      if ((hit = on('[data-wf-sw]'))) { x[hit.dataset.wfSw] = !x[hit.dataset.wfSw]; draw(); say(`${x.title}: ${hit.dataset.wfSw === 'asks' ? (x.asks ? 'asks questions' : 'never asks') : (x.fan ? 'sends helpers to read first' : 'reads the code itself')}`); return; }
      if ((hit = on('[data-wf-run]'))) { say(`${x.title}: ${x.cases} of ${x.cases} cases pass`); return; }
      if ((hit = on('[data-confirm]'))) {
        if (menu === 'wf-export') { menu = ''; draw(); if (hit.dataset.confirm === 'yes') say(`Exported ${x.title} as ${x.as || 'a JSON file'}`); return; }
        if (hit.dataset.confirm === 'yes') { const l = data[kind], i = l.indexOf(x); l.splice(i, 1); confirm = null; current = ''; say(`Deleted ${x.title}`, () => { l.splice(i, 0, x); draw(); }); window.RailShell.go('workflows'); } else { confirm = null; draw(); }
        return;
      }
      if ((hit = on('[data-menu-pick]'))) {
        const [id, v] = hit.dataset.menuPick.split('|'); menu = id === 'wf-as' ? 'wf-export' : '';
        if (id === 'wf-more') { act(v, [{ _k: kind, _x: x }]); return; }
        if (id === 'wf-as') { x.as = v; draw(); return; }
        const n = +id.slice(4);
        if (id.startsWith('wfm-')) x.steps[n][2] = v; else if (id.startsWith('wfe-')) x.steps[n][3] = v; else if (id.startsWith('wfl-')) x.loops[n][2] = +v; else if (id === 'ag-model') x.model = v; else if (id === 'ag-effort') x.effort = v;
        draw(); say(`${x.title}: saved`); return;
      }
      if ((hit = on('[data-menu]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); }
    });
    R.dismissOnOutside(document, { open: () => !!menu && menu !== 'wf-export', inside: '#route-place .spick, #route-place .rc-pop', back: () => null, close: () => { menu = ''; }, paint: draw });
  }
  window.RailPlaces = window.RailPlaces || {};
  window.RailPlaces.workflows = { sample: 'workflow:default', newLabel: 'Build workflow', newAct: () => window.RailConversation?.starter('workflow'),
    show: ({ bar: b, page: pg, arg }) => { if (b !== bar) wire(b, pg); if (current !== arg) { if (menu !== 'wf-export') menu = ''; if (confirm && `${confirm.kind}:${confirm.x.id}` !== arg) confirm = null; } current = arg || ''; draw(); } };
})();
