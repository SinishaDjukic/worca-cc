// Mock only: the pass capture.mjs runs on the real prototype page for the "after" state. Glyphs by state, levels, on-demand facts.
window.cockpit = function (calm) {
  const svg = (inner, size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const G = {
    fail: '<path d="M12 5.5v8.5"/><path d="M12 18.5h.01"/>',
    ask: '<path d="M8.8 9a3.2 3.2 0 1 1 5 2.7c-1.2.8-1.8 1.4-1.8 2.8"/><path d="M12 18.5h.01"/>',
    act: '<path d="M4.5 19.5l4.2-1 10-10-3.2-3.2-10 10z"/>',
    ok: '<path d="M5.5 12.5l4.3 4.3L18.5 8"/>',
    merged: '<circle cx="7" cy="5.5" r="2"/><circle cx="7" cy="18.5" r="2"/><circle cx="17" cy="12" r="2"/><path d="M7 7.5v9"/><path d="M7 8.5c.8 2.6 3.8 3.5 8 3.5"/>',
    wait: '<path d="M7.5 12h.01"/><path d="M12 12h.01"/><path d="M16.5 12h.01"/>',
    run: '<path d="M8 5.5v13l10.5-6.5z"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  };
  const PLAY = 'M8 5.5v13l10.5-6.5z';
  document.querySelectorAll('.kind-mark').forEach((m) => {
    const own = m.querySelector(':scope > svg:not(.km-ring)');
    const isTask = own?.querySelector('path')?.getAttribute('d') === PLAY || m.closest('[data-row^="task:"], .tc-rows');
    const inner = isTask ? own : null;
    if (!inner) return;
    let tone = ['fail', 'ask', 'act', 'ok', 'merged', 'wait', 'run'].find((t) => m.classList.contains(`is-${t}`));
    const row = m.closest('.list-row'), said = `${row?.querySelector('.lr-main')?.title || ''} ${m.title || ''}`;
    if (tone === 'ask' && /approv|your OK/i.test(said)) tone = 'act';
    if (tone) inner.outerHTML = svg(G[tone], tone === 'merged' ? 16 : 13);
  });
  document.querySelectorAll('.is-attn[data-attn="ask"] .kind-mark.is-ask > svg:not(.km-ring)').forEach((g) => { g.outerHTML = svg(G.ask, 13); });
  document.querySelectorAll('.task-card .cmd-s').forEach((c) => { if (c.textContent.startsWith('✗ ')) c.innerHTML = `<span style="display:inline-block;vertical-align:-2px;margin-right:4px">${svg(G.fail, 13)}</span>${c.textContent.slice(2)}`; });
  // facts that come on demand
  document.querySelectorAll('.tc-foot').forEach((f) => { const b = f.querySelector('.btn'); if (!b) return; const c = b.cloneNode(true); for (const n of c.childNodes) if (n.nodeType === 3) n.textContent = 'Figures'; f.appendChild(c); f.style.display = 'flex'; f.style.gap = '6px';
    const facts = f.closest('.task-card').querySelector('.q-facts'); if (facts && !calm) { c.querySelector('svg')?.style.setProperty('transform', 'rotate(90deg)'); f.after(facts); facts.classList.add('ck-open'); } });
  const sent = [...document.querySelectorAll('.center-sent')].find((e) => e.offsetParent);
  if (sent) { const head = sent.parentElement.querySelector('.place-head .convo-head'); sent.insertAdjacentHTML('beforeend', '<span class="spick"><button type="button" class="spick-b ck-fig">Figures</button></span>'); if (head && !calm) sent.insertAdjacentHTML('afterend', `<p class="ck-figs">${head.textContent.trim()}</p>`); }
  document.querySelectorAll('.pg-f').forEach((f) => { f.textContent = f.textContent.replace(/\s*·\s*\$[\d.]+ a run/, ''); });
  document.querySelectorAll('#route-runs .pg-f').forEach((f) => { f.remove(); });
  document.querySelectorAll('.pg-card .pg-up').forEach((u) => u.classList.add('ck-adv'));
  // Quiet projects: a line, no figures
  document.querySelectorAll('#route-runs .pg-grid ~ * *, #route-runs .pg-grid *').forEach((e) => { if (!e.children.length && /\$[\d.]+ this week/.test(e.textContent)) e.textContent = e.textContent.replace(/\s*·\s*\d+ (finished|running|waiting|merged).*$/, ''); });
  document.querySelectorAll('.pg-card').forEach((c) => {
    const word = c.querySelector('.pg-state')?.textContent || '', m = c.querySelector(':scope > .kind-mark'), g = m?.querySelector(':scope > svg:not(.km-ring)');
    if (g && c.closest('#route-runs')) { const k = word === 'Failed' ? 'fail' : word === 'Question' ? 'ask' : /approval/.test(word) ? 'act' : /missed/.test(word) ? 'clock' : ''; if (k) g.outerHTML = svg(G[k], 13); }
    const primary = c.querySelector('.pg-a .btn-primary'); if (primary) primary.classList.remove('btn-primary');
    if (m?.classList.contains('is-fail')) c.querySelector('.pg-a .btn')?.classList.add('btn-primary');
    if (/approval/.test(word) && c.closest('#route-runs')) c.querySelector('.pg-a').innerHTML = '<button type="button" class="btn btn-sm">Approve cron parser</button> <button type="button" class="btn btn-sm">Merge audit pager</button>';
  });
  document.querySelectorAll('.ro-says .dc-link').forEach((l) => { if (/failed/.test(l.textContent)) { l.textContent = 'failed Nov 11'; l.insertAdjacentText('afterend', ' · next run passed'); } });
  // Needs you: ranked, highest level first
  document.querySelectorAll('.list-group').forEach((g) => {
    const h = g.querySelector(':scope > .list-h');
    if (!h || !/^Needs you/.test(h.textContent)) return;
    h.classList.add('ck-needs');
    const box = g.querySelector(':scope > .list-rows'); if (!box) return;
    const level = (row) => (row.querySelector('.kind-mark.is-fail') ? 3 : row.querySelector('.kind-mark.is-ask, .kind-mark.is-act') ? 2 : 1);
    const rows = [...box.children].filter((r) => r.classList.contains('list-row'));
    rows.sort((a, b) => level(b) - level(a)).forEach((r) => box.appendChild(r));
    rows.filter((r) => level(r) === 1).forEach((r) => r.querySelectorAll('.kind-mark.is-ok').forEach((m) => m.classList.add('ck-adv')));
  });
  const badge = document.querySelector('.pz-pulse-b .topnav-badge');
  if (badge) document.body.classList.add('ck-master-l3');

  if (!calm) return;
  // Nothing needs you: the same places with every lit thing settled.
  document.body.classList.add('ck-calm');
  document.querySelectorAll('.list-group').forEach((g) => { const h = g.querySelector(':scope > .list-h'); if (h && /^Needs you/.test(h.textContent)) g.remove(); });
  document.querySelector('.pz-pulse-b .topnav-badge')?.remove();
  document.querySelectorAll('.is-attn').forEach((a) => a.remove());
  document.querySelectorAll('.task-card').forEach((c) => { if (/Workflow/.test(c.querySelector('.tp-kicker')?.textContent || '')) c.remove(); });
  const line = '<p class="ck-calm-line">Nothing needs you</p>';
  document.querySelectorAll('.rail-page .place-head').forEach((h) => { if (!h.closest('[hidden]')) h.insertAdjacentHTML('beforeend', line); });
  const cal = (card, mark, k, t, w, extra) => {
    const m = card.querySelector(':scope > .kind-mark');
    m.className = `kind-mark is-${mark}`;
    const g = m.querySelector(':scope > svg:not(.km-ring)'); if (g) g.outerHTML = svg(G[mark === 'run' ? 'run' : 'clock'], 13);
    card.querySelector('.pg-k').innerHTML = k; if (t) card.querySelector('.pg-t').textContent = t;
    const pw = card.querySelector('.pg-w'); if (pw && w) pw.textContent = w;
    if (extra !== undefined) card.querySelector('.pg-a').innerHTML = extra;
    card.querySelectorAll('.btn-primary').forEach((b) => b.classList.remove('btn-primary'));
  };
  const tasks = document.querySelector('#route-runs:not([hidden]) .pg-grid');
  if (tasks) {
    const c = [...tasks.querySelectorAll('.pg-card')];
    cal(c[0], 'run', 'Running', 'web-app', 'Update Node to 24 is at Build', '');
    cal(c[1], 'run', 'Running', 'billing-api', 'Add CSV export to billing is at Review', '');
    cal(c[2], 'run', 'Running', 'worca-cc', 'Migrate cron parser is at Review', '');
    cal(c[3], 'wait', 'Scheduled', 'docs-site', 'Docs sync runs Nov 17', '');
    tasks.querySelectorAll('.pg-card .pg-line').forEach((l) => l.remove());
  }
  const sch = document.querySelector('#route-schedule:not([hidden]) .pg-grid, #route-place:not([hidden]) .pg-grid, #route-schedules:not([hidden]) .pg-grid') || [...document.querySelectorAll('.pg-grid')].find((g) => g.offsetParent && g.querySelector('.ro-sqs'));
  if (sch && !tasks) {
    const c = sch.querySelector('[data-c-card="s3"]');
    if (c) { cal(c, 'wait', 'Next up Nov 17, 06:00', 'Docs sync', 'Keeps the docs in step with the code.'); c.querySelector('.pg-line')?.remove(); c.querySelector('.pg-a').innerHTML = '<button class="btn btn-sm btn-quiet">Run now</button>'; }
  }
  document.querySelectorAll('.ro-says .dc-link').forEach((l) => { if (/failed/.test(l.textContent)) { const o = l.closest('.run-outs'); o.querySelector('.ro-says').textContent = '7 of 7 runs fine'; o.querySelectorAll('.ro-sq.is-fail').forEach((s) => { s.className = 'ro-sq is-ok'; }); } });
};
