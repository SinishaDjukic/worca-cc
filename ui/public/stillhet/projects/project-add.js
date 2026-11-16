// Projects' Add a project by hand (form.add-project, COV-1): every way classic adds a project, in the one card form.
// One folder (a path or a repository address, Choose folder… and the probe line), New folder (a name, Use git, where it
// is made) and Several folders… (the FolderBrowser, then the review list). Live, every request goes through
// RailProjectsLive; the demo answers from a small folder tree and adds to the demo's list. projects.js calls make(ctx).
(function () {
  const NOT_ANSWERING = 'Worca is not answering';
  const WAIT_MS = 150;   // the probe and the dry run wait this long after the last keystroke (classic PROBE_DEBOUNCE_MS)
  const NAME_MAX = 80;
  const REPO = /^(https?:\/\/|ssh:\/\/|git@)\S+$/;
  // the demo's folders (the prototype only): a small tree under ~/src
  const DEMO_ROOT = '~/src', DEMO_NEW = '~/worca/projects';
  const DEMO_DIRS = { '~': ['src', 'Projects'], '~/src': ['billing-api', 'web-app', 'new-service', 'shared-ui', 'scripts'], '~/Projects': ['docs-site', 'notes'], '~/src/shared-ui': ['tokens'] };
  const parentOf = (p) => (p === '~' ? null : p.replace(/\/[^/]+$/, '') || '~');
  const demoFolders = (path) => {
    const at = path || DEMO_ROOT;
    if (!DEMO_DIRS[at] && !Object.values(DEMO_DIRS).some((l, i) => l.some((n) => `${Object.keys(DEMO_DIRS)[i]}/${n}` === at))) return { ok: false, text: `Could not open ${at}: no such directory` };
    return { ok: true, path: at, parent: parentOf(at), home: '~', dirs: (DEMO_DIRS[at] || []).map((name) => ({ name, path: `${at}/${name}` })), limited: false, roots: [] };
  };
  // a refused probe's reason, in the probe line's own words
  const probeWhy = (p) => (!p || typeof p.exists !== 'boolean' ? '' : !p.exists ? 'Not found' : !p.isDir ? 'Not a folder' : p.insideRepo ? (p.partOf ? `Part of ${p.partOf}` : 'Inside a git repository') : '');

  function make(ctx) {
    const { R } = ctx;
    // typed/newName follow the field; shown/newShown are what the page draws into it, changed only when the page sets the value,
    // so a redraw while typing draws the same value and the field stays the same element (comp.keep-open, B2.7)
    const fresh = () => ({ way: 'folder', typed: '', shown: '', newShown: '', err: '', probe: null, probeFor: '', probeErr: '', gitOk: true, useGit: false, newName: '', newGit: true, where: '', newErr: '', newRefused: false, browser: null, review: null, reviewErr: '' });
    let s = fresh(), probeSeq = 0, newSeq = 0, dirSeq = 0, probeT = 0, newT = 0;
    const live = () => ctx.live();
    // live but the module is not up yet: nothing fake, every action says so (D8)
    const down = () => ctx.onLive() && !live();
    const busy = () => (ctx.onLive() ? live()?.pending('add') || '' : '');
    const val = (id) => document.getElementById(id)?.value.trim() ?? '';
    const focus = (q) => setTimeout(() => document.querySelector(q)?.focus(), 0);
    const nameOfPath = (v) => (v.split(/[/:]/).filter(Boolean).pop() || '').replace(/\.git$/, '');

    // ---- the probe line (One folder) ----
    async function probeNow(v) {
      const n = ++probeSeq;
      clearTimeout(probeT);
      if (!v || REPO.test(v) || ctx.pathWrong(v, true)) { s.probe = null; s.probeFor = v; s.probeErr = ''; return null; }
      const a = ctx.onLive() ? (live() ? await live().probe(v) : { ok: false }) : { ok: true, probe: { path: v, exists: true, isDir: true, vcs: 'git' } };
      if (n !== probeSeq) return undefined;   // a newer path was typed: this answer is stale
      s.probe = a.ok ? a.probe : null; s.probeFor = v;
      s.probeErr = !a.ok && a.field ? a.field : '';   // a refused probe: its words are the field's error, and Add stays off
      if (s.probeErr) s.err = s.probeErr;
      ctx.draw();
      return s.probe;
    }
    const probeSoon = (v) => { clearTimeout(probeT); probeT = setTimeout(() => probeNow(v), WAIT_MS); };
    const model = () => (s.probe && s.probeFor === s.typed ? R.folderProbe(s.probe, { git: s.gitOk }) : { html: '', refused: false, useGit: false });

    // ---- the dry run (New folder) ----
    async function checkNow() {
      const n = ++newSeq, name = s.newName;
      clearTimeout(newT);
      let a;
      if (!ctx.onLive()) a = !name ? { ok: true, where: DEMO_NEW } : ctx.projects().some((p) => ctx.nameOf(p) === name) ? { ok: false, field: `A folder called ${name} already exists`, where: DEMO_NEW } : { ok: true, where: `${DEMO_NEW}/${name}` };
      else if (!live()) return;
      else a = await live().checkNew({ name, useGit: s.gitOk && s.newGit });
      if (n !== newSeq) return;   // stale
      if (a.text) return;   // not answering: the line stays as it was
      s.where = a.where || ''; s.newErr = a.ok ? '' : a.field || ''; s.newRefused = !a.ok;
      ctx.draw();
    }
    const checkSoon = () => { clearTimeout(newT); newT = setTimeout(checkNow, WAIT_MS); };

    // ---- the folder browser ----
    async function load(path, fallback) {
      const b = s.browser; if (!b) return;
      const n = ++dirSeq;
      const a = ctx.onLive() ? (live() ? await live().folders(path) : { ok: false, text: NOT_ANSWERING }) : demoFolders(path);
      if (n !== dirSeq || s.browser !== b) return;
      if (!a.ok && fallback && path) { load('', false); return; }   // a seed that fails opens at the top (classic)
      if (a.ok) Object.assign(b, { path: a.path, parent: a.parent, dirs: a.dirs, home: a.home, roots: a.roots, note: a.limited ? 'Worca may open only these folders here.' : '', state: 'ready', error: '' });
      else Object.assign(b, { state: 'ready', error: a.text });   // the last listing stays
      ctx.draw();
      // the row that took the focus went with the old listing: the focus stays in the dialog, so Escape asks first (F-cov1-02)
      if (!document.activeElement || document.activeElement === document.body) document.querySelector('.fb .fb-list [data-fb-go], .fb [data-dialog="cancel"]')?.focus();
    }
    function browse(multiple, seed = '') {
      if (down()) { ctx.say(NOT_ANSWERING); return; }
      s.browser = { multiple, path: '', parent: null, dirs: [], picked: new Map(), state: 'loading', error: '', note: '', roots: [], home: '', ask: false };
      ctx.draw();
      load(seed, true);
      focus('.fb [data-dialog="cancel"]');
    }
    const shut = () => { s.browser = null; ctx.draw(); };
    function picked() {
      const b = s.browser, paths = b.multiple ? [...b.picked.keys()] : [b.path];
      s.browser = null;
      if (paths.length === 1) { s.way = 'folder'; s.typed = s.shown = paths[0]; s.err = ''; ctx.draw(); probeNow(paths[0]); focus('#pj-hand-v'); return; }
      const abs = (q) => (q && b.home && /^~(\/|$)/.test(q) ? b.home + q.slice(1) : q);   // a ~/ path the store keeps, as the folder browser gives it (absolute)
      const known = (p) => ctx.projects().find((x) => [x.path, x.devPath].some((q) => q === p || abs(q) === p));
      s.review = paths.map((path) => { const k = known(path); const name = R.folderName(path); return { path, name, shown: name, include: !k, status: '', reason: k ? `already registered as “${ctx.nameOf(k)}”` : '' }; });
      s.reviewErr = '';
      ctx.draw();
    }

    // ---- what the yes does, per way ----
    const finish = (text, key, from) => { s = fresh(); ctx.end(); ctx.say(text); if (key && location.hash === from) ctx.go(`projects/${key}`); else ctx.draw(); };
    async function addOne() {
      const v = val('pj-hand-v'), id = nameOfPath(v);
      s.typed = s.shown = v;
      const wrong = !v || !id ? 'It needs a folder or a repository' : ctx.pathWrong(v, true) || (id.length > NAME_MAX ? `A project's name holds ${NAME_MAX} characters; this folder's has ${id.length}` : ctx.projects().some((x) => ctx.nameOf(x) === id) ? `${id} is already a project` : '');
      if (wrong) { s.err = wrong; ctx.draw(); focus('#pj-hand-v'); return; }
      if (down()) { ctx.say(NOT_ANSWERING); return; }
      s.err = '';
      if (!REPO.test(v)) {
        const p = s.probeFor === v && s.probe ? s.probe : await probeNow(v);
        if (p === undefined) return;   // a newer probe (a second press) carries on
        const why = s.probeErr || probeWhy(p);
        if (why) { s.err = why; ctx.draw(); focus('#pj-hand-v'); return; }
      }
      const from = location.hash;
      if (ctx.onLive()) {
        const a = live().addProject(v, { useGit: s.useGit && model().useGit });
        ctx.draw();
        const r = await a;
        if (!r.ok) { if (r.field) { s.err = r.field; ctx.draw(); focus('#pj-hand-v'); } else ctx.said(r); return; }
        finish(r.text, r.key, from);
        return;
      }
      ctx.addDemo({ id, path: v, kind: s.useGit || s.probe?.vcs === 'git' ? 'Git' : 'Folder', origin: s.probe?.vcs === 'git' || s.useGit ? 'local' : 'folder', branch: 'main' });
      finish(`Added ${id}`, id, from);
    }
    async function createOne() {
      const name = val('pj-new-name');
      s.newName = s.newShown = name;
      const wrong = !name ? 'It needs a name' : name.length > NAME_MAX ? `A name holds ${NAME_MAX} characters; this one has ${name.length}` : '';
      if (wrong) { s.newErr = wrong; ctx.draw(); focus('#pj-new-name'); return; }
      if (s.newRefused) return;
      if (down()) { ctx.say(NOT_ANSWERING); return; }
      const from = location.hash, useGit = s.gitOk && s.newGit;
      if (ctx.onLive()) {
        const a = live().createProject({ name, useGit });
        ctx.draw();
        const r = await a;
        if (!r.ok) { if (r.field) { s.newErr = r.field; s.newRefused = true; ctx.draw(); focus('#pj-new-name'); } else ctx.said(r); return; }
        finish(r.text, r.key, from);
        return;
      }
      if (ctx.projects().some((p) => ctx.nameOf(p) === name)) { s.newErr = `A folder called ${name} already exists`; ctx.draw(); return; }
      ctx.addDemo({ id: name, path: `${DEMO_NEW}/${name}`, kind: useGit ? 'Git' : 'Folder', origin: useGit ? 'local' : 'folder', branch: 'main', ownedFolder: true });
      finish(`Created ${name}`, name, from);
    }
    async function addSeveral() {
      const rows = s.review;
      rows.forEach((r, i) => { const el = document.querySelector(`[data-fr-name="${i}"]`); if (el && r.status !== 'added') r.name = r.shown = el.value.trim(); });
      const sent = rows.filter((r) => r.include && r.status !== 'added');
      if (!sent.length) { s.reviewErr = R.REVIEW_EMPTY; ctx.draw(); return; }
      if (down()) { ctx.say(NOT_ANSWERING); return; }
      s.reviewErr = '';
      const from = location.hash, body = sent.map((r) => ({ name: r.name || R.folderName(r.path), path: r.path }));
      let a;
      if (ctx.onLive()) { const p = live().addMany(body); ctx.draw(); a = await p; }
      else {
        const results = body.map((r, index) => (ctx.projects().some((p) => ctx.nameOf(p) === r.name) ? { index, status: 'skipped', name: r.name, path: r.path, reason: 'a project with this name already exists' } : (ctx.addDemo({ id: r.name, path: r.path, kind: 'Git', origin: 'local', branch: 'main' }), { index, status: 'added', key: r.name, name: r.name, path: r.path })));
        const added = results.filter((x) => x.status === 'added'), skipped = results.filter((x) => x.status === 'skipped');
        a = { ok: true, results, added, skipped, text: R.reviewSummary({ added: added.map((x) => x.name), skipped }), ...(added.length === 1 && !skipped.length ? { key: added[0].key } : {}) };
      }
      if (!a.ok) { if (a.text) { s.reviewErr = a.text; ctx.draw(); } return; }
      for (const x of a.results) { const r = sent[x.index]; if (!r) continue; Object.assign(r, x.status === 'added' ? { status: 'added', reason: '' } : { status: 'skipped', reason: x.reason || '' }); }
      if (a.skipped.length) { ctx.draw(); ctx.say(a.text); return; }   // the list stays with the reasons, to rename and retry
      finish(a.text, a.key, from);
    }

    // ---- the form ----
    const WAYS = [['folder', 'One folder'], ['new', 'New folder'], ['many', 'Several folders…']];
    function body() {
      const b = busy();
      if (s.way === 'new') {
        return R.field({ id: 'pj-new-name', label: 'Its name', placeholder: 'my-project', value: s.newShown, error: s.newErr, hint: s.where ? `Makes ${s.where}` : '', attrs: { maxlength: NAME_MAX, 'data-keep': 'pj-hand:new:' } })
          + (s.gitOk ? R.folderWay({ git: { on: s.newGit, hook: 'data-pa-newgit', why: 'Runs git init in the new folder' } }) : '')
          + R.confirmActions({ yes: b || 'Create', busy: !!b || s.newRefused });
      }
      if (s.way === 'many') {
        if (!s.review) return R.confirmActions({ yes: 'Browse folders…' });   // one Browse folders…: the form's yes (F-cov1-03)
        return R.folderReview({ rows: s.review.map((r) => ({ ...r, name: r.shown })), saving: !!b, error: s.reviewErr });
      }
      const m = model();
      return R.field({ id: 'pj-hand-v', label: 'Folder or repository', placeholder: '~/src/your-project', value: s.shown, error: s.err, attrs: { maxlength: 200, 'data-keep': 'pj-hand:project:' } })
        + R.folderWay({ pick: { label: 'Choose folder…', hook: 'data-pa-choose', title: 'Pick a folder on this computer' } })
        + m.html
        + (m.useGit ? R.folderWay({ git: { on: s.useGit, hook: 'data-pa-git', why: 'Runs git init in it when it is added' } }) : '')
        + R.confirmActions({ yes: b || 'Add', busy: !!b || m.refused || !!(s.probeErr && s.probeFor === s.typed) });
    }
    function browserHtml() {
      const b = s.browser; if (!b) return '';
      return R.folderBrowser({ multiple: b.multiple, path: b.path, parent: b.parent, dirs: b.dirs, picked: [...b.picked.keys()], state: b.state, error: b.error, note: b.note, roots: b.roots, ask: b.ask, id: 'fb-t' });
    }
    const html = () => `<div class="card-form">${R.confirmForm({ form: 'hand', id: 'pj-hand-t', text: 'Add a project by hand', body: R.segmented({ label: 'How to add it', hook: 'pa-way', items: WAYS.map(([id, label]) => ({ id, label, pressed: s.way === id })) }) + body() })}${browserHtml()}</div>`;

    function setWay(w) {
      s.way = w; s.reviewErr = ''; s.shown = s.typed; s.newShown = s.newName;   // the way's field comes back with what was typed
      ctx.draw();
      if (w === 'new') { checkNow(); focus('#pj-new-name'); } else if (w === 'folder') focus('#pj-hand-v');
    }
    function click(t) {
      let hit;
      const on = (q) => (hit = t.closest(q));
      if (!t.closest('.card-form')) return false;
      const b = s.browser;
      if (b && t.closest('.viewer-modal')) {
        if (on('[data-confirm]')) { if (hit.dataset.confirm === 'yes') shut(); else { b.ask = false; ctx.draw(); } return true; }
        if (on('[data-fb-pick]')) { const p = hit.dataset.fbPick; if (b.picked.has(p)) b.picked.delete(p); else b.picked.set(p, true); ctx.draw(); return true; }
        if (on('[data-fb-go]')) { b.state = 'loading'; ctx.draw(); load(hit.dataset.fbGo); return true; }
        if (on('[data-fb-home]')) { b.state = 'loading'; ctx.draw(); load(b.home || ''); return true; }
        if (on('[data-dialog]')) { if (hit.dataset.dialog === 'yes') { if (!hit.disabled) picked(); } else shut(); return true; }
        return true;
      }
      if (on('[data-pa-way]')) { setWay(hit.dataset.paWay); return true; }
      if (on('[data-pa-choose]')) { browse(false, val('pj-hand-v')); return true; }
      if (on('[data-pa-git]')) { s.useGit = !s.useGit; ctx.draw(); return true; }
      if (on('[data-pa-newgit]')) { s.newGit = !s.newGit; ctx.draw(); checkNow(); return true; }
      if (on('[data-fb-root]')) {
        const a = model().action;
        if (a?.kind === 'open') { const p = ctx.projects().find((x) => ctx.nameOf(x) === a.name); s = fresh(); ctx.end(); ctx.go(`projects/${p ? p.id : a.name}`); return true; }
        if (a?.kind === 'add') { const el = document.getElementById('pj-hand-v'); if (el) el.value = a.path; s.typed = s.shown = a.path; s.probe = null; addOne(); }
        return true;
      }
      if (on('[data-fr-pick]')) { const r = s.review?.[Number(hit.dataset.frPick)]; if (r && r.status !== 'added') { r.include = !r.include; s.reviewErr = ''; ctx.draw(); } return true; }
      if (on('[data-confirm]')) {
        if (hit.dataset.confirm !== 'yes') { close(); return 'close'; }
        if (busy()) return true;
        if (s.way === 'new') createOne(); else if (s.way === 'many') { if (s.review) addSeveral(); else browse(true, ''); } else addOne();
        return true;
      }
      return t.closest('.card-form [data-form="hand"]') ? true : false;
    }
    function key(e) {
      const t = e.target, b = s.browser;
      const stop = () => { e.preventDefault(); e.stopPropagation(); };
      if (b && e.key === 'Escape') {
        stop();
        if (b.ask) b.ask = false;
        else if (b.multiple && b.picked.size) b.ask = true;
        else s.browser = null;
        ctx.draw();
        return true;
      }
      if (e.key !== 'Enter' && e.key !== 'Escape') return false;
      const inForm = t.id === 'pj-hand-v' || t.id === 'pj-new-name' || t.dataset?.frName !== undefined;
      if (!inForm) return false;
      stop();
      if (e.key === 'Escape') return 'close';
      document.querySelector('.card-form [data-form="hand"] [data-confirm="yes"]')?.click();
      return true;
    }
    // typing: the probe and the dry run follow the field, after a short wait
    document.addEventListener('input', (e) => {
      const t = e.target;
      if (t.id === 'pj-hand-v') { s.typed = t.value.trim(); s.err = ''; s.probeErr = ''; probeSoon(s.typed); }
      else if (t.id === 'pj-new-name') { s.newName = t.value.trim(); s.newErr = ''; s.newRefused = false; checkSoon(); }
      else if (t.dataset?.frName !== undefined) { const r = s.review?.[Number(t.dataset.frName)]; if (r && r.status !== 'added') r.name = t.value.trim(); }
    });
    function open(way = 'folder') {
      s = fresh(); s.way = way;
      if (ctx.onLive() && live()) live().gitAvailable().then((ok) => { s.gitOk = ok; ctx.draw(); });
      if (way === 'new') checkNow();
    }
    function close() { clearTimeout(probeT); clearTimeout(newT); probeSeq += 1; newSeq += 1; dirSeq += 1; s = fresh(); }
    return { html, click, key, open, close, busy: () => !!busy() };
  }
  window.RailProjectAdd = { make };
})();
