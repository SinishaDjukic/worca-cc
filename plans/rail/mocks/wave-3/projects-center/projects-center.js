// The Projects center mock (Rail, Wave 3): a center of cards, by workspace. Bar and top bar captured from the prototype; the main column calls the library. Not product code.
// Sums. 13 projects = Web shop 5 + Legacy billing 2 + IoT 5 + on their own 2, less billing-api's second listing (14 - 1).
// 6 need you = web-app, legacy-billing, billing-api, ingest-gateway, worca-cc, docs-site. 2 out of sync = web-app, ingest-gateway; 2 older copies = billing-api, device-registry. 4 running = web-app 2, worca-cc 2. 2 questions = Web shop 1, IoT 1.
window.projectsCenter = (function () {
  const R = window.RailUI, S = window.PROJECTS_SHELL, chev = R.icon('chevron', 10);
  const pick = (t, tip) => R.sentencePicker({ id: t, text: t, tip, items: [], chevron: chev });
  const links = (s) => s.replace(/\[([^\]]+)\]/g, (_, l) => R.textLink({ label: l, attrs: { href: '#' } }));
  // what wants you, from the seed: [name, kind, tone, word, what, facts, action, kind of button]
  const P = {
    'web-app': ['web-app', 'task', 'fail', 'Failed', '[Update Node to 24] failed at Build; its branch is also out of sync', ['2 running'], 'Retry', 'primary', '2 ahead, 3 behind origin/develop'],
    'legacy-billing': ['legacy-billing', 'project', 'fail', 'Folder missing', '~/old/legacy-billing is gone; nothing can start here until it is back', [], 'Locate folder…', 'primary', 'Last seen 3 days ago'],
    'billing-api': ['billing-api', 'task', 'ask', 'Question', '[Add CSV export to billing]: Review asks which date format', [], 'Answer', '', 'Your copy is older: 3 behind origin/main'],
    'worca-cc': ['worca-cc', 'task', 'act', 'Needs approval', '[Migrate cron parser] waits for your OK; [Add pager to the audit log] is ready to merge', ['2 running', '2 waiting'], ['Approve cron parser', 'Merge audit pager'], '', ''],
    'ingest-gateway': ['ingest-gateway', 'project', 'ask', 'Out of sync', 'Your branch and origin have both moved; the next task asks how to bring them together', [], 'Bring together…', '', '1 ahead, 2 behind origin/main'],
    'docs-site': ['docs-site', 'schedule', 'act', 'Schedule missed', '[Docs sync] missed Nov 10 while Worca was off', [], 'Run now', '', 'No git · 214 files'],
    'device-registry': ['device-registry', 'project', 'idle', 'Your copy is older', 'New tasks start from origin; syncing touches nothing of yours', [], 'Sync', 'quiet', '1 behind origin/main'],
  };
  const WS_OF = { 'web-app': 'Web shop', 'legacy-billing': 'Legacy billing', 'billing-api': 'Web shop, Legacy billing', 'ingest-gateway': 'IoT SP Platform', 'device-registry': 'IoT SP Platform' };
  const lit = (tone) => ['fail', 'ask', 'act'].includes(tone);
  function card(id, { flat = false, simple = false, also = '' } = {}) {
    let [title, kind, tone, word, what, facts, action, button, tip] = P[id];
    facts = [...facts, ...(also ? [also] : []), ...(flat && !simple && WS_OF[id] ? [WS_OF[id]] : [])];
    const act = [].concat(action).map((label) => R.button({ label, kind: button })).join('');
    return R.pluginCard({ mark: R.kindMark({ kind, tone, breathe: lit(tone) }), word, tone, title, whatHtml: links(what), factsHtml: facts.length ? facts.join(' · ') : '', action: act, attrs: { title: tip || null } });
  }
  const question = (title, sentence, tip) => R.pluginCard({ mark: R.kindMark({ kind: 'workspace', tone: 'ask', breathe: true }), word: 'Question', tone: 'ask', title, whatHtml: links(sentence), action: R.button({ label: 'Answer' }), attrs: { title: tip } });
  const running = (title, what, facts) => R.pluginCard({ mark: R.kindMark({ kind: 'task', tone: 'run' }), word: 'Running', tone: 'run', title, whatHtml: links(what), factsHtml: facts, action: R.button({ label: 'Open', kind: 'quiet' }) });
  const quiet = (n, noun, names) => `<div class="center-quiet">${R.list({ groups: [{ title: '', rows: [R.listRow({ title: `${n} quiet ${noun}${n === 1 ? '' : 's'}`, meta: names, mark: R.kindMark({ kind: noun === 'workspace' ? 'workspace' : 'project' }), open: { 'data-x': noun } })] }] })}</div>`;
  // a shelf's counts come with Figures (look.figures-on-demand); its state word stays
  const shelf = ({ figs, title, count, word, tone, facts, map, cards, rest }) => `<section class="pg-shelf pc-sec"><h3 class="pg-shelf-h">${title}${figs ? `<span class="n">${count}</span>` : ''}${map ? `<span class="pc-map">${R.textLink({ label: 'Workspace map', attrs: { href: '#', title: `Opens ${title} and how its projects connect` } })}</span>` : ''}</h3><p class="pg-shelf-m">${word ? `<span class="pc-w${tone ? ` is-${tone}` : ''}">${word}</span>${figs && facts ? ' · ' : ''}` : ''}${figs ? facts : ''}</p>${cards ? `<div class="pg-grid">${cards}</div>` : ''}${rest || ''}</section>`;
  const alsoLine = `<p class="pc-also">${R.kindMark({ kind: 'task', tone: 'ask' })}<span><b>billing-api</b> · Also in Web shop · ${R.textLink({ label: 'Answer there', attrs: { href: '#', title: 'Goes to its card in Web shop' } })}</span></p>`;
  const NOTE = '<p class="note">Mock. marketing-site is on Tasks only: seed tasks name it, but it is not one of your 13 added projects, so this page does not list it.</p>';
  const WEB = ['Web shop', 'Does [payments-api] send receipts through a queue to [email-service]? Worca is fairly sure', 'payments/receipts.ts:41'];
  const IOT = ['IoT SP Platform', 'Does [ingest-gateway] write readings to [telemetry-db]? Worca is guessing', 'gateway/store.go:88'];
  const head = (by, { say = '', figures = '', simple = false } = {}) => `${R.placeHead({ title: 'Your projects', say })}<div class="center-sent">Showing ${pick('most urgent', 'How the cards are ordered')}${simple ? '' : ` by ${pick(by, 'What a card is')}`} ${R.figuresToggle({ open: !!figures })}</div>${figures ? R.figuresLine(figures) : ''}`;
  const FIG = '13 projects · 3 workspaces · 2 on their own · 6 need you · 2 questions · 2 out of sync · 2 older copies · 4 running';
  const byWorkspace = () => head('workspace')
    + shelf({ title: 'Web shop', word: 'Failed', tone: 'fail', map: 1, cards: card('web-app') + card('billing-api', { also: 'Also in Legacy billing' }) + question(...WEB), rest: quiet(3, 'project', 'payments-api, design-kit, email-service') })
    + shelf({ title: 'Legacy billing', word: 'Folder missing', tone: 'fail', map: 1, cards: card('legacy-billing'), rest: alsoLine })
    + shelf({ title: 'IoT SP Platform', word: 'Out of sync', tone: 'ask', map: 1, cards: card('ingest-gateway') + question(...IOT) + card('device-registry'), rest: quiet(3, 'project', 'telemetry-db, ops-dashboard, firmware-sdk') })
    + shelf({ title: 'On their own', word: 'Needs approval', tone: 'ask', cards: card('worca-cc') + card('docs-site') }) + NOTE;
  const ORDER = ['web-app', 'legacy-billing', 'billing-api', 'worca-cc', 'ingest-gateway', 'docs-site'];
  const QUIET = 'payments-api, design-kit, email-service, telemetry-db, ops-dashboard, firmware-sdk';
  const byProject = () => `${head('project', { figures: FIG })}<div class="pg-grid pc-grid-flat">${ORDER.map((id) => card(id, { flat: true })).join('')}${question(...WEB)}${question(...IOT)}${card('device-registry', { flat: true })}</div>${quiet(6, 'project', QUIET)}${NOTE}`;
  const simple = () => `${head('', { simple: true })}<p class="center-way">New work starts in Chat. ${R.textLink({ label: 'Go to Chat', attrs: { href: '#' } })}</p><div class="pg-grid pc-grid-flat">${[...ORDER, 'device-registry'].map((id) => card(id, { simple: true })).join('')}</div>${quiet(6, 'project', QUIET)}${NOTE}`;
  const calm = () => head('workspace', { say: 'Nothing needs you', figures: '13 projects · 3 workspaces · 2 on their own · 4 running' })
    + shelf({ figs: 1, title: 'Web shop', count: '5 projects', facts: '2 running', map: 1, cards: running('web-app', '[Retry on 502] and [Fix flaky login test] are running', ''), rest: quiet(4, 'project', 'billing-api, payments-api, design-kit, email-service') })
    + shelf({ figs: 1, title: 'On their own', count: '2 projects', facts: '2 running', cards: running('worca-cc', '[Tidy the migrations] and [Pager between runs] are running', '2 waiting'), rest: quiet(1, 'project', 'docs-site') })
    + `<div class="pc-sec">${quiet(2, 'workspace', 'IoT SP Platform, Legacy billing')}</div>${NOTE}`;
  // the bar agrees with the cards: same marks, docs-site's missed schedule in Needs you, a workspace at its worst child, highest level first
  const MARK = { 'web-app': ['task', 'fail'], 'legacy-billing': ['project', 'fail'], 'billing-api': ['task', 'ask'], 'worca-cc': ['task', 'act'], 'ingest-gateway': ['project', 'ask'], 'docs-site': ['schedule', 'act'], 'Web shop': ['workspace', 'fail', 'Failed'], 'Legacy billing': ['workspace', 'fail', 'Folder missing'], 'IoT SP Platform': ['workspace', 'ask', 'Out of sync'] };
  const RANK = ['Web shop', 'web-app', 'Legacy billing', 'legacy-billing', 'billing-api', 'IoT SP Platform', 'worca-cc', 'ingest-gateway', 'docs-site'];
  const titled = (t) => [...document.querySelectorAll('#side-rail .bar-list:not([hidden]) .list-row')].find((r) => r.querySelector('.lr-t')?.textContent === t);
  function ownTerm() { document.querySelectorAll('#side-rail .bar-list:not([hidden]) .list-h, #side-rail .bar-list:not([hidden]) .list-h *').forEach((h) => h.childNodes.forEach((n) => { if (n.nodeType === 3 && n.textContent.trim() === 'Not in a workspace') n.textContent = 'On their own'; })); }
  function barPatch() {
    const doc = titled('docs-site'), wc = titled('worca-cc'), g = doc.closest('.list-group'), copy = wc.cloneNode(true);
    copy.querySelector('.lr-t').textContent = 'docs-site'; const f = copy.querySelector('.lr-fig'); if (f) f.textContent = 'Schedule missed';
    wc.after(copy); const needs = wc.closest('.list-group'), n1 = needs.querySelector('.list-h .n'); if (n1) n1.textContent = '6';
    if (doc !== copy) { doc.remove(); if (!g.querySelector('.list-row')) g.remove(); else { const n = g.querySelector('.list-h .n'); if (n) n.textContent = String(+n.textContent - 1); } }
    Object.entries(MARK).forEach(([t, [kind, tone, word]]) => { const r = titled(t); if (!r) return; r.querySelector('.kind-mark').outerHTML = R.kindMark({ kind, tone, breathe: true, size: 20 }); if (word) { const f2 = r.querySelector(':scope > .lr-end .lr-fig'); if (f2) f2.textContent = word; } });
    const list = needs.querySelector('.list-rows'), top = [...list.children];
    RANK.forEach((t) => { const r = top.find((x) => x.querySelector(':scope > .lr-main .lr-t')?.textContent === t); if (r) list.append(r); });
  }
  function paint({ shell, cap, main, patch = true, plus = true }) {
    document.getElementById('m').innerHTML = `<div class="strip">${cap}</div><div class="app" id="worca">${S[shell].side}<div class="main-col">${S[shell].top}<main class="main"><div class="convo-col center is-center">${main}</div></main></div></div>`;
    document.querySelectorAll('#side-rail .is-arrived').forEach((x) => x.classList.remove('is-arrived'));   // a still picture: no entrance caught half way
    ownTerm();
    if (patch) barPatch();
    if (!plus) document.querySelector('.bar-head .rc-pop')?.remove();
    const badge = document.querySelector('#topnav .topnav-badge'); if (badge) { if (shell === 'calm') badge.remove(); else badge.textContent = '6'; }   // the bell equals Needs you
  }
  return { paint, byWorkspace, byProject, simple, calm };
})();
