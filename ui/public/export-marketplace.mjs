// ui/public/export-marketplace.mjs
// Export… → Worca plugin → Marketplace (#717): the pure pieces of the Export dialog — the
// marketplace <select>, the request body, the Preview extras and the done view. DOM through the
// passed `doc`, so tests drive them under jsdom without booting app.js. app.js owns the wiring.

const VERB = { opened: 'created', updated: 'updated' };

/** Fill the marketplace <select>; keeps `keep` selected when still offered. → number of targets.
 *  `emptyText` replaces the "add one" option when the list is empty for another reason (it could not be loaded). */
export function fillMarketplaceSelect(select, targets, { doc = document, keep = '', emptyText = '' } = {}) {
  select.replaceChildren();
  if (!targets.length) {
    const o = doc.createElement('option');
    o.value = ''; o.disabled = true; o.selected = true;
    o.textContent = emptyText || 'No GitHub or Azure DevOps marketplace. Add one on the Marketplace page';
    select.appendChild(o);
    return 0;
  }
  for (const t of targets) {
    const o = doc.createElement('option');
    o.value = t.id;
    o.textContent = `${t.name}: ${t.repo}${t.ref ? ` (${t.ref})` : ''}`;
    select.appendChild(o);
  }
  select.value = targets.some((t) => t.id === keep) ? keep : targets[0].id;
  return targets.length;
}

/** The hint under the select when no marketplace can take a pull request: each registered one the server left out
 *  (GET /api/marketplaces/publish-targets `skipped`: {id, name, reason} — a local folder, a GitHub Enterprise host,
 *  outside WORCA_CLONE_ALLOW), with why. "Add one" alone would send the user to re-add a marketplace that is already
 *  there. Hidden when there is nothing to explain. → number of rows. */
export function renderMarketplaceSkipped(el, skipped, { doc = document } = {}) {
  el.replaceChildren();
  el.classList.toggle('hidden', !skipped.length);
  if (!skipped.length) return 0;
  el.appendChild(doc.createTextNode('Registered but cannot take a pull request: '));
  skipped.forEach((s, i) => {
    if (i) el.appendChild(doc.createTextNode('; '));
    const b = doc.createElement('b');
    b.textContent = s.name || s.id;
    el.append(b, ` (${s.reason})`);
  });
  return skipped.length;
}

/** The dialog's error line when the marketplace list could not be read — never "add a marketplace". */
export function marketplaceLoadError(detail) {
  return `Could not load marketplaces${detail ? `: ${detail}` : ''}`;
}

/** Preview and Create PR: both off while a marketplace request is in flight (a publish takes about a minute;
 *  a second click would start a second export that ends in a lease refusal overwriting the first one's message), and
 *  afterwards back to the dialog's rule — both stay off when there is no marketplace to send to. */
export function syncMarketplaceButtons({ plan, apply }, { busy = false, targets = 0 } = {}) {
  const off = busy || targets === 0;
  plan.disabled = off;
  apply.disabled = off;
}

/** The POST /api/workflows/:id/export body. Draft only when ticked (the server's default is not a draft). */
export function marketplaceExportBody({ marketplaceId, pluginName, draft }) {
  return { destination: 'marketplace', marketplaceId, ...(pluginName ? { pluginName } : {}), ...(draft ? { draft: true } : {}) };
}

/** Staleness guard for an answer (a Preview) that lands after the dialog may have moved on. `requestTicket(seq, body)`
 *  right before the request; `ticketIsCurrent(ticket, seq, body)` when the answer lands, with the dialog's CURRENT
 *  invalidation count and the body it would send now. The answer is shown only when nothing invalidated the plan
 *  meanwhile (every input change, a close and a reopen bump `seq`) AND the inputs still build the body that was sent —
 *  a typed name, another marketplace, a ticked draft or a switched destination all make the answer somebody else's. */
export function requestTicket(seq, body) {
  return { seq, body: JSON.stringify(body) };
}
export function ticketIsCurrent(ticket, seq, body) {
  return ticket.seq === seq && ticket.body === JSON.stringify(body);
}

/** Why the plugin name cannot be exported, '' when it can. `{raw, name}` is app.js's exportPluginName(): a name that
 *  normalises to nothing must stop the export — sending no name would publish under the pipeline's name instead.
 *  The server's name pattern also starts with a letter, so "2fa" is refused here rather than as a 400 after the click. */
export function marketplaceNameProblem({ raw, name }) {
  if (raw && !name) return 'Plugin name needs at least one letter or digit.';
  return name && !/^[a-z]/.test(name) ? 'Plugin name must start with a letter.' : '';
}

/** The pull request URL as the done view shows it. It comes from gh / Azure output, so only an http(s) URL becomes a
 *  link (a `javascript:` or `data:` URL would run in the dialog); anything else is plain text, still readable. */
function link(doc, url) {
  const text = url == null ? '' : String(url);
  if (!/^https?:\/\//i.test(text)) return text;
  const a = doc.createElement('a');
  a.href = text; a.textContent = text; a.target = '_blank'; a.rel = 'noopener';
  return a;
}

/** Preview extras under the file rows: the index change and the pull request that would open. */
export function marketplacePlanExtras(r, { doc = document } = {}) {
  const frag = doc.createDocumentFragment();
  if (r.index && r.index.added) {
    const row = doc.createElement('div');
    row.className = 'export-row';
    const tag = doc.createElement('span');
    tag.className = 'export-tag export-update';
    tag.textContent = 'index';
    const code = doc.createElement('code');
    code.textContent = `worca-cc-marketplace.json + "${r.subdir}"`;
    row.append(tag, ' ', code);
    frag.appendChild(row);
  }
  if (r.status === 'dry-run' && r.body) {
    const det = doc.createElement('details');
    det.className = 'export-pr-preview';
    const sum = doc.createElement('summary');
    sum.textContent = `Pull request: ${r.title}${r.pushTo === 'fork' ? ' (from your fork)' : ''}`;
    const pre = doc.createElement('pre');
    pre.textContent = r.body;
    det.append(sum, pre);
    frag.appendChild(det);
  }
  return frag;
}

/** exportShowDone's {title, lines, next} for a marketplace result. The server's warnings (a lint warning, an Azure
 *  pull request whose description was not refreshed) are lines of their own: Preview is optional, so this is the
 *  only place a user who exports straight away sees them. */
export function marketplaceDoneView(r, { doc = document } = {}) {
  const lines = [['Marketplace', `${r.marketplace.name} (${r.marketplace.repo})`]];
  const warnings = (r.warnings || []).map((w) => ['Warning', w]);
  const v = r.newVersion ? ` v${r.newVersion}` : '';      // D18: never "vnull"
  if (r.status === 'unchanged') {
    lines.push(['Plugin', `${r.name} (${r.versionText})`], ['Branch', r.base], ...warnings);
    return { title: 'No changes', lines, next: `${r.marketplace.name} already has this export of "${r.name}". No PR was created.` };
  }
  const from = r.pushTo === 'fork' && r.fork ? ` (from ${r.fork.repo})` : '';
  lines.push(['Pull request', link(doc, r.prUrl)]);
  if (r.status === 'up-to-date') {                          // nothing was pushed: no version or file-count claim
    lines.push(['Branch', `${r.branch} → ${r.base}${from}`], ...warnings);
    return { title: `No changes: the open pull request already has "${r.name}"${v}`, lines, next: 'The open pull request is unchanged. After it merges, Refresh on the Marketplace page lists the plugin and Install works.' };
  }
  lines.push(['Version', r.versionText], ['Branch', `${r.branch} → ${r.base}${from}`]);
  const n = r.files.created.length + r.files.updated.length;
  lines.push(['Files', `${n} changed${r.index.added ? ', listed in worca-cc-marketplace.json' : ''}`]);
  if (r.draft) lines.push(['Draft', 'yes']);
  lines.push(...warnings);
  return { title: `PR ${VERB[r.status] || r.status} for plugin "${r.name}"${v}`, lines, next: 'After it merges, Refresh on the Marketplace page lists the plugin and Install works.' };
}
