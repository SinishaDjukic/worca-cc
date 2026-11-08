// Requirements on Rail (Wave 3, 3.3): dev's feature interview and spec, Rail's design. The list in the one bar (features
// by state, one line each); a feature's page as a PlaceHead with its one next step, then the spec as rows by part, the
// assumptions each with Confirm and Reject, and the six checks that make it ready. Answering its questions happens in
// its chat (Chat leads), so the page sends you there rather than drawing a second form.
(function () {
  const R = window.RailUI;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const say = (t, undo) => window.RailPulse?.say(t, undo);
  const STATE = {
    turn: { word: 'Your turn', tone: 'ask', act: 'Answer in its chat', why: (f) => `Round ${f.round} of 6 · ${f.questions} questions for you` },
    decide: { word: 'Decide', tone: 'act', act: 'Decide below', why: (f) => `${f.assumptions.filter((a) => !a.v).length} assumptions to decide` },
    ready: { word: 'Ready', tone: 'ok', act: 'Start building', why: () => 'Every check passes' },
    started: { word: 'Started', tone: 'run', act: 'Open its task', why: (f) => f.run },
    archived: { word: 'Archived', tone: 'idle', act: 'Restore', why: () => 'Kept, out of the way' },
  };
  const data = { features: [
    { id: 'FEAT-1', title: 'Cancel an order before it ships', project: 'billing-api', state: 'turn', round: 2, questions: 3, cost: '$0.12', chat: 'c5',
      goal: 'A buyer cancels an unshipped order in two clicks; support tickets about it halve', actors: 'Buyer, support agent', criteria: ['Cancel is offered until the label prints', 'The refund starts at once'], assumptions: [{ t: 'Partial shipments cannot be cancelled', v: '' }] },
    { id: 'FEAT-2', title: 'Export invoices as CSV', project: 'billing-api', state: 'decide', round: 6, questions: 0, cost: '$0.31', chat: 'c1',
      goal: 'Finance exports a month of invoices in one file', actors: 'Finance', criteria: ['One row per invoice line', 'Dates in ISO 8601', 'Totals match the ledger'], assumptions: [{ t: 'Amounts are in the invoice currency', v: '' }, { t: 'Credit notes are their own rows', v: '' }, { t: 'Up to 50k rows per export', v: 'ok' }] },
    { id: 'FEAT-3', title: 'Guest checkout', project: 'web-app', state: 'ready', round: 5, questions: 0, cost: '$0.44', chat: '',
      goal: 'A first-time buyer pays without an account; conversion on mobile up 5%', actors: 'Guest buyer', criteria: ['Email is the only required field', 'An account can be made after paying'], assumptions: [{ t: 'Guests can track orders by email link', v: 'ok' }] },
    { id: 'FEAT-4', title: 'Saved payment methods', project: 'web-app', state: 'started', round: 6, questions: 0, cost: '$2.80', run: 'Build · writing the change', chat: '',
      goal: 'A returning buyer pays with a saved card', actors: 'Buyer', criteria: ['Cards are stored by the payment provider only'], assumptions: [] },
    { id: 'FEAT-5', title: 'Legacy coupon codes', project: 'billing-api', state: 'archived', round: 1, questions: 0, cost: '$0.04', chat: '', goal: '', actors: '', criteria: [], assumptions: [] },
  ] };
  const SHOWS = [{ id: 'open', text: 'open', test: (f) => f.state !== 'archived' }, { id: 'needs', text: 'needs you', test: (f) => ['turn', 'decide'].includes(f.state) }, { id: 'ready', text: 'ready', test: (f) => f.state === 'ready' }, { id: 'started', text: 'started', test: (f) => f.state === 'started' }, { id: 'archived', text: 'archived', test: (f) => f.state === 'archived' }];
  const view = { show: 'open' };
  let current = '', menu = '', ctl = null, home = null, bar = null, page = null, seen = new Set();
  const st = (f) => STATE[f.state];
  const checks = (f) => [['A goal with a success measure', !!f.goal], ['At least one acceptance criterion', f.criteria.length > 0], ['The interview finished', f.state !== 'turn'], ['No open questions', !f.questions], ['Every assumption decided', f.assumptions.every((a) => a.v)], ['Its project exists', !!f.project]];
  const mark = (f, size, breathe = false) => R.kindMark({ kind: 'requirement', tone: st(f).tone, size, breathe, title: `${st(f).word} · ${st(f).why(f)}` });
  const rowOf = (f) => ({ key: `feat:${f.id}`, _f: f, title: f.title, mark: mark(f, 20, !seen.has(`${f.id}:${f.state}`)), end: st(f).word, current: f.id === current, tip: `${f.id} · ${f.title}\n${f.project} · ${f.cost} so far\n${st(f).why(f)}`,
    menu: [{ id: 'next', text: st(f).act, help: st(f).why(f) }, { id: 'copy', text: 'Copy as Markdown', help: 'The spec, ready to paste' }, { sep: true }, { id: 'archive', text: f.state === 'archived' ? 'Restore' : 'Archive', help: 'Out of the way; nothing is deleted' }] });

  function act(id, f) {
    if (id === 'copy') { say(`Copied ${f.id} as Markdown`); return; }
    if (id === 'archive' || (id === 'next' && f.state === 'archived')) { f.was = f.state === 'archived' ? f.was : f.state; f.state = f.state === 'archived' ? f.was || 'ready' : 'archived'; draw(); say(f.state === 'archived' ? `Archived ${f.id}` : `Restored ${f.id}`); return; }
    if (id === 'next') {
      if (f.state === 'turn') { window.RailShell.go(f.chat ? `chat/${f.chat}` : 'chat'); return; }
      if (f.state === 'decide') { page.querySelector('[data-rq-sec="assume"]')?.scrollIntoView({ block: 'center' }); return; }
      if (f.state === 'ready') { Object.assign(f, { state: 'started', run: 'Plan · writing the plan' }); draw(); say(`Started ${f.id}: a task builds it from the spec`); return; }
      if (f.state === 'started') window.RailShell.go('runs');
    }
  }
  function pageHtml(f) {
    const done = checks(f).filter(([, ok]) => ok).length;
    const head = R.placeHead({ title: f.title, facts: esc(`${f.id} · ${f.project} · ${f.cost} so far`), mark: mark(f, 20, true), word: st(f).word, why: st(f).why(f),
      action: f.state === 'archived' ? '' : R.button({ label: st(f).act, kind: ['turn', 'decide', 'ready'].includes(f.state) ? 'primary' : '', attrs: { 'data-rq-next': '' } }),
      menu: R.moreMenu({ id: 'rq-more', label: `More for ${f.id}`, icon: R.icon('more', 16), open: menu === 'rq-more', items: [{ id: 'specs', text: 'Save to specs/', help: `As specs/${f.id.toLowerCase()}.md in ${f.project}` }, { id: 'copy', text: 'Copy as Markdown', help: 'The spec, ready to paste' }, { sep: true }, { id: 'archive', text: f.state === 'archived' ? 'Restore' : 'Archive', help: 'Out of the way; nothing is deleted' }] }) });
    const spec = R.settingsSection({ title: 'The spec', meta: 'What a task builds from; change any part by saying so in its chat.', rows: [R.settingsRow({ name: 'Goal', sentence: esc(f.goal || 'Not yet') }), R.settingsRow({ name: 'Who', sentence: esc(f.actors || 'Not yet') }),
      R.settingsRow({ name: 'Done when', sentence: f.criteria.length ? f.criteria.map(esc).join('; ') : 'Not yet' })].join('') });
    const assume = f.assumptions.length ? R.settingsSection({ title: 'Assumptions', meta: f.assumptions.some((a) => !a.v) ? `${f.assumptions.filter((a) => !a.v).length} of ${f.assumptions.length} to decide: a rejected one comes back as a question` : 'All decided', attrs: { 'data-rq-sec': 'assume' },
      rows: f.assumptions.map((a, i) => R.settingsRow({ name: a.v === 'ok' ? 'Confirmed' : a.v === 'no' ? 'Rejected' : 'To decide', sentence: esc(a.t), end: a.v ? R.button({ label: 'Undo', kind: 'quiet', attrs: { 'data-rq-undo': i } }) : R.button({ label: 'Confirm', attrs: { 'data-rq-yes': i } }) + R.button({ label: 'Reject', kind: 'quiet', attrs: { 'data-rq-no': i } }) })).join('') }) : '';
    const ready = R.settingsSection({ title: `Ready to start · ${done} of 6`, rows: checks(f).map(([t, ok]) => R.settingsRow({ name: ok ? 'Done' : 'Not yet', sentence: esc(t) })).join('') });
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${head}${spec}${assume}${ready}</div></div><div class="convo-dock" id="rq-dock"></div></div>`;
  }
  function draw() {
    if (!bar || !page) return;
    ctl?.paint();
    const f = data.features.find((x) => x.id === current);
    if (!f) { home ||= window.RailConversation?.mount(page, { mode: 'ask', where: '#route-place', title: 'Shape a feature', note: 'Describe it in a few sentences; Worca interviews you, then writes the spec a task builds from.' }); home?.show(''); return; }
    home = null; page.innerHTML = pageHtml(f);
    window.RailConversation?.dock(document.getElementById('rq-dock'), { kind: 'feature', title: f.title, chat: f.chat });
  }
  function wire(b, pg) {
    bar = b; page = pg;
    const shownIn = (proj) => data.features.filter((f) => f.project === proj && SHOWS.find((x) => x.id === view.show).test(f));
    ctl = R.listController({ root: bar, spec: { noun: 'features', label: 'Selected features', view: () => ({ state: 'ready',
      parts: [{ word: 'Showing', id: 'show', text: SHOWS.find((x) => x.id === view.show).text, tip: 'Which features the list shows', items: SHOWS.map((x) => ({ id: x.id, text: x.text, checked: view.show === x.id, hint: String(data.features.filter(x.test).length) })) }],
      sections: [...new Set(data.features.map((f) => f.project))].map((p) => ({ id: p, title: p, rows: shownIn(p).map(rowOf) })),
      empty: { text: 'No features here.', action: 'Shape a feature' } }),
      can: () => ['menu'], bulk: () => [], act: (id, rows) => rows[0] && act(id, rows[0]._f), open: (r) => window.RailShell.go(`requirements/${r._f.id}`), word: (id, v) => { view[id] = v; return false; }, say,
      active: () => /^#requirements/.test(location.hash), emptyAct: () => window.RailConversation?.starter('pin:Shaper') } });
    page.addEventListener('click', (e) => {
      const on = (q) => e.target.closest(q); let hit; const f = data.features.find((x) => x.id === current); if (!f || !page.querySelector('#rq-dock')) return;
      if (on('[data-rq-next]')) { act('next', f); return; }
      if ((hit = on('[data-rq-yes], [data-rq-no], [data-rq-undo]'))) {
        const i = +(hit.dataset.rqYes ?? hit.dataset.rqNo ?? hit.dataset.rqUndo), a = f.assumptions[i];
        a.v = hit.dataset.rqYes !== undefined ? 'ok' : hit.dataset.rqNo !== undefined ? 'no' : '';
        if (a.v === 'no') { f.state = 'turn'; f.questions = 1; say('Rejected: it comes back as one short question in its chat'); } else if (f.state === 'decide' && f.assumptions.every((y) => y.v)) { f.state = 'ready'; say(`${f.id} is ready to build`); } else say(a.v ? 'Confirmed' : 'Back to decide');
        draw(); return;
      }
      if ((hit = on('[data-menu-pick]'))) { const [id, v] = hit.dataset.menuPick.split('|'); menu = ''; if (id === 'rq-more') { if (v === 'specs') { say(`Saved specs/${f.id.toLowerCase()}.md in ${f.project}`); draw(); } else act(v, f); } return; }
      if ((hit = on('[data-menu]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); }
    });
    R.dismissOnOutside(document, { open: () => !!menu, inside: '#route-place .rc-pop', back: () => null, close: () => { menu = ''; }, paint: draw });
  }
  window.RailPlaces = window.RailPlaces || {};
  window.RailPlaces.requirements = { sample: 'FEAT-2', newLabel: 'Shape a feature', newAct: () => window.RailConversation?.starter('pin:Shaper'),
    show: ({ bar: b, page: pg, arg }) => { if (b !== bar) wire(b, pg); if (current !== arg) menu = ''; current = arg || ''; const f = data.features.find((x) => x.id === current); if (f) seen.add(`${f.id}:${f.state}`); draw(); } };
})();
