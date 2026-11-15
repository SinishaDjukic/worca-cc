// Requirements on Rail (Wave 3, 3.3): dev's feature interview and spec, Rail's design. The list in the one bar (features
// by state, one line each); a feature's page as a PlaceHead with its one next step, then the spec as rows by part, the
// assumptions each with Confirm and Reject, and the six checks that make it ready. Answering its questions happens in
// its chat (Chat leads), so the page sends you there rather than drawing a second form.
(function () {
  const R = window.RailUI;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const say = (t, undo) => window.RailPulse?.say(t, undo);
  const STATE = {
    turn: { word: 'Your turn', tone: 'ask', act: 'Answer in its chat', why: (f) => `Round ${f.round} of 6 · ${f.questions} ${f.questions === 1 ? 'question' : 'questions'} for you` },
    decide: { word: 'Decide', tone: 'act', act: 'Open to decide', why: (f) => { const n = f.assumptions.filter((a) => !a.v).length; return `${n} ${n === 1 ? 'assumption' : 'assumptions'} to decide`; } },
    ready: { word: 'Ready', tone: 'ok', act: 'Start building', why: () => 'Every check passes' },
    started: { word: 'Started', tone: 'run', act: 'Open its task', why: (f) => f.run },
    archived: { word: 'Archived', tone: 'idle', act: 'Restore', why: () => 'Kept, out of the way' },
  };
  const data = { features: [
    { id: 'FEAT-1', title: 'Cancel an order before it ships', project: 'billing-api', state: 'turn', round: 2, questions: 3, cost: '$0.12', chat: '',
      goal: 'A buyer cancels an unshipped order in two clicks; support tickets about it halve', actors: 'Buyer, support agent', criteria: ['Cancel is offered until the label prints', 'The refund starts at once'], assumptions: [{ t: 'Partial shipments cannot be cancelled', v: '' }] },
    { id: 'FEAT-2', title: 'Export invoices as CSV', project: 'billing-api', state: 'decide', round: 6, questions: 0, cost: '$0.31', chat: 'c1',
      goal: 'Finance exports a month of invoices in one file', actors: 'Finance', criteria: ['One row per invoice line', 'Dates in ISO 8601', 'Totals match the ledger'], assumptions: [{ t: 'Amounts are in the invoice currency', v: '' }, { t: 'Credit notes are their own rows', v: '' }, { t: 'Up to 50k rows per export', v: 'ok' }] },
    { id: 'FEAT-3', title: 'Guest checkout', project: 'web-app', state: 'ready', round: 5, questions: 0, cost: '$0.44', chat: '',
      goal: 'A first-time buyer pays without an account; conversion on mobile up 5%', actors: 'Guest buyer', criteria: ['Email is the only required field', 'An account can be made after paying'], assumptions: [{ t: 'Guests can track orders by email link', v: 'ok' }] },
    { id: 'FEAT-4', title: 'Saved payment methods', project: 'web-app', state: 'started', round: 6, questions: 0, cost: '$2.80', run: 'Build · writing the change', chat: '',
      goal: 'A returning buyer pays with a saved card', actors: 'Buyer', criteria: ['Cards are stored by the payment provider only'], assumptions: [] },
    { id: 'FEAT-5', title: 'Legacy coupon codes', project: 'billing-api', state: 'archived', was: 'turn', round: 1, questions: 2, cost: '$0.04', chat: '', goal: '', actors: '', criteria: [], assumptions: [] },
  ] };
  const SHOWS = [{ id: 'open', text: 'open', test: (f) => f.state !== 'archived' }, { id: 'needs', text: 'needs you', test: (f) => ['turn', 'decide'].includes(f.state) }, { id: 'ready', text: 'ready', test: (f) => f.state === 'ready' }, { id: 'started', text: 'started', test: (f) => f.state === 'started' }, { id: 'archived', text: 'archived', test: (f) => f.state === 'archived' }];
  const view = { show: 'open' };
  let current = '', menu = '', ctl = null, home = null, bar = null, page = null;
  const st = (f) => STATE[f.state];
  const checks = (f) => [['A goal with a success measure', !!f.goal], ['At least one acceptance criterion', f.criteria.length > 0], ['The interview finished', f.state !== 'turn'], ['No open questions', !f.questions], ['Every assumption decided', f.assumptions.every((a) => a.v)], ['Its project exists', !!f.project]];
  const mark = (f, size, breathe = false) => R.kindMark({ kind: 'requirement', tone: st(f).tone, size, breathe, title: `${st(f).word} · ${st(f).why(f)}` });
  const rowOf = (f) => ({ key: `feat:${f.id}`, _f: f, title: f.title, mark: mark(f, 20, f.id !== current), end: st(f).word, current: f.id === current, tip: `${f.id} · ${f.title}\n${f.project} · ${f.cost} so far\n${st(f).why(f)}`,
    menu: [...(f.state === 'archived' ? [] : [{ id: 'next', text: st(f).act, help: st(f).why(f) }]), { id: 'copy', text: 'Copy as Markdown', help: 'The spec, ready to paste' }, { sep: true }, { id: 'archive', text: f.state === 'archived' ? 'Restore' : 'Archive', help: 'Out of the way; nothing is deleted' }] });

  const handOver = (f, ph, text = '') => window.RailConversation?.handOver({ about: { kind: 'Page', name: f.title }, project: f.project, ph, text });   // rail.hand-to-chat, on its project (kind Page: the chip is the page, the project only sets the sentence)
  function act(id, f) {
    if (id === 'copy') { say(window.RailWould(`copy ${f.id} as Markdown`)); return; }
    if (id === 'archive' || (id === 'next' && f.state === 'archived')) { f.was = f.state === 'archived' ? f.was : f.state; f.state = f.state === 'archived' ? f.was || 'ready' : 'archived'; draw(); say(f.state === 'archived' ? `Archived ${f.id}` : `Restored ${f.id}`); return; }
    if (id === 'next') {
      if (f.state === 'turn') { if (f.chat) window.RailShell.go(`chat/${f.chat}`); else handOver(f, `Answer what Worca asked about ${f.title}`); return; }
      if (f.state === 'decide') { window.RailShell.go(`requirements/${f.id}`); return; }   // the row's way in; on its page the assumptions are the step
      if (f.state === 'ready') { Object.assign(f, { state: 'started', run: 'Plan · writing the plan' }); window.RailWorld?.add({ id: `feat-${f.id}`, case: 'working', title: f.title, project: f.project, detail: 'Plan · writing the plan', time: 'now', day: 'today' }); draw(); say(`Started ${f.id}: a task builds it from the spec`); return; }
      if (f.state === 'started') {   // its card in its chat, on its project: the seeded ones are told to the world here
        if (!window.RailWorld?.find(`feat-${f.id}`)) window.RailWorld?.add({ id: `feat-${f.id}`, case: 'working', title: f.title, project: f.project, detail: f.run, time: 'now', day: 'today' });
        const run = `feat-${f.id}`;   // its chat exists before you open it: a card opens, not a notice about a new chat
        if (!window.RailConversation?.chatOfTask({ run, title: f.title })) { window.RailChats?.newChat(f.title, f.project, { fromTask: true, tasks: [{ id: `t-${run}`, run, title: f.title, case: 'working', stage: 1, detail: f.run, branch: '' }] }); window.RailChats?.refresh(); }
        window.RailShell.openRun('run/working', f.title, run);
      }
    }
  }
  function pageHtml(f) {
    const done = checks(f).filter(([, ok]) => ok).length;
    const head = R.placeHead({ center: { label: 'Requirements', to: 'requirements' }, title: f.title, facts: esc(`${f.id} · ${f.project} · ${f.cost} so far`), mark: mark(f, 20, true), word: st(f).word, why: st(f).why(f),
      action: f.state === 'decide' ? '' : R.button({ label: st(f).act, kind: ['turn', 'ready'].includes(f.state) ? 'primary' : '', attrs: { 'data-rq-next': '' } }),   // Decide: the step is the assumptions' own Confirm, below
      menu: R.moreMenu({ id: 'rq-more', label: `More for ${f.id}`, icon: R.icon('more', 16), open: menu === 'rq-more', items: [{ id: 'specs', text: 'Save to specs/', help: `As specs/${f.id.toLowerCase()}.md in ${f.project}` }, { id: 'copy', text: 'Copy as Markdown', help: 'The spec, ready to paste' }, ...(f.state === 'archived' ? [] : [{ sep: true }, { id: 'archive', text: 'Archive', help: 'Out of the way; nothing is deleted' }])] }) });
    const spec = R.settingsSection({ title: 'The spec', meta: 'What a task builds from; change any part by saying so in its chat.', rows: [R.settingsRow({ name: 'Goal', sentence: esc(f.goal || 'Not yet') }), R.settingsRow({ name: 'Who', sentence: esc(f.actors || 'Not yet') }),
      R.settingsRow({ name: 'Done when', sentence: f.criteria.length ? f.criteria.map(esc).join('; ') : 'Not yet' })].join('') });
    const assume = f.assumptions.length ? R.settingsSection({ title: 'Assumptions', meta: f.assumptions.some((a) => !a.v) ? 'A rejected one comes back as a question' : 'All decided', attrs: { 'data-rq-sec': 'assume' },
      rows: f.assumptions.map((a, i) => R.settingsRow({ name: a.v === 'ok' ? 'Confirmed' : a.v === 'no' ? 'Rejected' : 'To decide', sentence: esc(a.t), end: a.v ? R.button({ label: 'Undo', kind: 'quiet', attrs: { 'data-rq-undo': i } }) : R.button({ label: 'Confirm', attrs: { 'data-rq-yes': i } }) + R.button({ label: 'Reject', kind: 'quiet', attrs: { 'data-rq-no': i } }) })).join('') }) : '';
    const ready = R.settingsSection({ title: `Ready to start · ${done} of 6`, rows: checks(f).map(([t, ok]) => R.settingsRow({ name: ok ? 'Done' : 'Not yet', sentence: esc(t) })).join('') });
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${head}${spec}${assume}${ready}</div></div><div class="convo-dock" id="rq-dock"></div></div>`;
  }
  const here = () => (location.hash.slice(1) || '').split('/')[0] === 'requirements';   // the page area is shared by every place: draw only while this one is open
  function draw() {
    if (!bar || !page || !here()) return;
    ctl?.paint();
    const f = data.features.find((x) => x.id === current);
    if (!f) { home ||= window.RailConversation?.mount(page, { mode: 'ask', where: '#route-place', title: 'Shape a feature', note: 'Describe it in a few sentences; Worca interviews you, then writes the spec a task builds from.' }); home?.show(''); return; }
    home = null; page.innerHTML = pageHtml(f);
    const dock = document.getElementById('rq-dock');
    if (f.chat) window.RailConversation?.dock(dock, { kind: 'feature', title: f.title, chat: f.chat });
    else dock.innerHTML = R.composer({ placeholder: 'Ask about this feature, or change it · in a new chat', sentence: '', tools: '', send: R.button({ label: 'Send', kind: 'primary', iconOnly: true, icon: R.icon('up', 14), attrs: { 'data-rq-send': '', title: 'Takes it to a new chat, on its project' } }), attrs: { 'data-dock': '' } });   // no chat yet: what you write is handed over, with its project
  }
  function wire(b, pg) {
    bar = b; page = pg;
    const CAUTION = ['turn', 'decide'];
    const shownIn = (proj) => data.features.filter((f) => f.project === proj && SHOWS.find((x) => x.id === view.show).test(f));
    ctl = R.listController({ root: bar, spec: { noun: 'features', label: 'Selected features', view: () => ({ state: 'ready',
      parts: [{ word: 'Showing', id: 'show', text: SHOWS.find((x) => x.id === view.show).text, tip: 'Which features the list shows', items: SHOWS.map((x) => ({ id: x.id, text: x.text, checked: view.show === x.id, hint: String(data.features.filter(x.test).length) })) }],
      sections: [{ id: 'needs', title: R.runState('question').word, rows: data.features.filter((f) => CAUTION.includes(f.state) && SHOWS.find((x) => x.id === view.show).test(f)).map(rowOf) }, ...[...new Set(data.features.map((f) => f.project))].map((p) => ({ id: p, title: p, rows: shownIn(p).filter((f) => !CAUTION.includes(f.state)).map(rowOf) }))].filter((s) => s.rows.length).map((s) => (s.id === 'needs' ? { ...s, count: s.rows.length } : s)),   // Caution is counted (look.alert-ladder)
      empty: { text: 'No features here.', action: 'Shape a feature' } }),
      can: () => ['menu'], bulk: () => [], act: (id, rows) => rows[0] && act(id, rows[0]._f), open: (r) => window.RailShell.go(`requirements/${r._f.id}`), word: (id, v) => { view[id] = v; return false; }, say,
      active: () => /^#requirements/.test(location.hash), emptyAct: () => window.RailConversation?.starter('pin:Shaper') } });
    const sendDock = (f) => { const t = page.querySelector('#rq-dock [data-composer-t]'), text = t.value.trim(); if (!text) { t.focus(); say('Say what to ask first'); return; } handOver(f, '', text); };
    page.addEventListener('submit', (e) => { const f = data.features.find((x) => x.id === current); if (here() && f && !f.chat && e.target.closest('#rq-dock')) { e.preventDefault(); sendDock(f); } });
    page.addEventListener('click', (e) => {
      if (!here()) return;   /* another place's page is showing */
      const on = (q) => e.target.closest(q); let hit; const f = data.features.find((x) => x.id === current); if (!f || !page.querySelector('#rq-dock')) return;
      if (on('[data-rq-next]')) { if (e.detail <= 1) act('next', f); return; }   // the second click of a double click never lands on the step that just appeared
      if (on('[data-rq-send]')) { e.preventDefault(); sendDock(f); return; }
      if ((hit = on('[data-rq-yes], [data-rq-no], [data-rq-undo]'))) {
        const i = +(hit.dataset.rqYes ?? hit.dataset.rqNo ?? hit.dataset.rqUndo), a = f.assumptions[i];
        a.v = hit.dataset.rqYes !== undefined ? 'ok' : hit.dataset.rqNo !== undefined ? 'no' : '';
        f.asked ??= f.state === 'turn' ? f.questions - f.assumptions.filter((y, n) => n !== i && y.v === 'no').length : 0;   // what it asked before any rejection
        f.questions = f.asked + f.assumptions.filter((y) => y.v === 'no').length;   // a rejected one is one more question; Undo takes it back
        const before = f.state; if (f.state !== 'started') f.state = f.questions ? 'turn' : f.assumptions.some((y) => !y.v) ? 'decide' : 'ready';
        say(a.v === 'no' ? 'Rejected: it comes back as one short question in its chat' : f.state === 'ready' && before !== 'ready' ? `${f.id} is ready to build` : a.v ? 'Confirmed' : 'Back to decide');
        draw(); return;
      }
      if ((hit = on('[data-menu-pick]'))) { const [id, v] = hit.dataset.menuPick.split('|'); menu = ''; if (id === 'rq-more') { if (v === 'specs') { say(window.RailWould(`save specs/${f.id.toLowerCase()}.md in ${f.project}`)); draw(); } else act(v, f); } return; }
      if ((hit = on('[data-menu]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); }
    });
    R.dismissOnOutside(document, { open: () => here() && !!menu, inside: '#route-place .rc-pop', back: () => null, close: () => { menu = ''; }, paint: draw });
  }
  if (window.RailFirstRun) data.features = [];   // the first run: nothing added yet
  window.RailPlaces = window.RailPlaces || {};
  window.RailPlaces.requirements = { search: (q) => data.features.filter((f) => `${f.id} ${f.title}`.toLowerCase().includes(q)).map((f) => ({ label: f.title, where: `Feature · ${f.project}`, hash: `requirements/${f.id}` })), has: (a) => data.features.some((f) => f.id === a), sample: 'FEAT-2', newLabel: 'Shape a feature', newAct: () => window.RailConversation?.starter('pin:Shaper'),
    show: ({ bar: b, page: pg, arg }) => { if (b !== bar) wire(b, pg); if (current !== arg) menu = ''; current = arg || ''; draw(); } };
})();
