// ui/public/marketplace/install-view.mjs — P4: the install sheet's pure renderers (boards 1.2–1.4): the step indicator,
// the sheet head, Review facts from the snapshot inventory, the Set up step and the Done step. Pure: every function
// takes `doc` and returns detached DOM; no fetch, no state, no listeners.
import { KIND_ORDER, KINDS, kindTile, chip, landing } from './kinds.mjs';
import { icon } from '../icons.mjs';
import { renderNeedsGit, channelBadge } from '../plugins-view.mjs';
import { engineLabel } from '../../../src/shared/engine-switch.mjs';
import { githubWebUrl } from '../../../src/shared/plugin-access.mjs';
import { renderSetupFields } from './setup-fields.mjs';

export const INSTALL_STEPS = ['Review', 'Install', 'Set up', 'Done'];

const list = (v) => (Array.isArray(v) ? v : []);
const sha7 = (sha) => (typeof sha === 'string' && sha ? sha.slice(0, 7) : '');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function make(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** The meta line of one Adds row, per kind; it keeps today's consent facts (renderInstallConsent, LC-P4-4). */
const ROW = {
  taskSources: (s) => ({ title: s.displayName || s.id, mono: false, meta: `Task source · ${s.id}` }),
  chatChannels: (c) => {
    const dirs = [c.inbound && 'inbound', c.outbound && 'outbound'].filter(Boolean).join(' + ');
    return { title: c.displayName || c.id, mono: false, meta: `Chat channel · ${c.id}${dirs ? ` · ${dirs}` : ''}`, worker: true };
  },
  mcpServers: (s) => ({ title: s.name, mono: true, meta: `MCP server · ${s.type} · ${s.command || s.url}` }),
  models: (m) => ({ title: m.label || m.id, mono: false,
    meta: `Model · ${m.id}${m.engine && m.engine !== 'claude' ? ` · ${engineLabel(m.engine)}` : ''}${m.baseUrl ? ` · routes to ${m.baseUrl}` : ''}` }),
  agents: (a) => {
    const forms = list(a.forms);
    const types = list(a.fileTypes);
    let meta = `Agent · tools: ${list(a.tools).join(', ') || 'none declared'}`;
    if (forms.length) {
      meta += ` · ${forms.length} form${forms.length === 1 ? '' : 's'}: ${forms.join(', ')}`;
      if (types.length) meta += ` · may display ${types.join(', ')} from the run folder`;
    }
    return { title: a.key, mono: true, meta };
  },
  scripts: (s) => ({ title: s.key, mono: true, meta: `Script${s.runtime ? ` · ${s.runtime}` : ''}`
    + `${s.command ? ` · ${s.command}` : s.file ? ` · ${s.file}` : ''}${s.cases ? ` · ${plural(s.cases, 'case')}` : ''}` }),
  skills: (s) => ({ title: String(s), mono: true, meta: 'Skill' }),
  workflows: (w) => ({ title: String(w), mono: true, meta: 'Workflow' }),
};

/** One row per contribution, in KIND_ORDER: { kind, title, mono, meta, worker }. A non-array kind adds nothing. */
export function addsRows(inventory) {
  const inv = inventory ?? {};
  return KIND_ORDER.flatMap((kind) => list(inv[kind]).map((x) => {
    const r = ROW[kind](x);
    return { kind, title: r.title, mono: r.mono, meta: r.meta, worker: r.worker === true };
  }));
}

/** The secret keys the plugin asks for: task sources, chat channels, then model secrets; deduped, first-seen order. */
export function asksFor(inventory) {
  const inv = inventory ?? {};
  const keys = [...list(inv.taskSources).flatMap((s) => list(s?.secrets)), ...list(inv.chatChannels).flatMap((c) => list(c?.secrets)),
    ...list(inv.modelSecrets).map((s) => s?.key)].filter((k) => typeof k === 'string' && k);
  return [...new Set(keys)];
}

/** The Setup lines: the npm dependency count, each setup command verbatim (mono), else "No dependencies". */
export function setupLines(inventory) {
  const inv = inventory ?? {};
  const out = [];
  if (inv.depCount > 0) out.push({ text: `${inv.depCount} npm dependencies (from lockfile)`, mono: false });
  for (const cmd of list(inv.setupCommands)) out.push({ text: String(cmd), mono: true });
  return out.length ? out : [{ text: 'No dependencies', mono: false }];
}

/** ol.mk-steps: Review · Install · Set up · Done; earlier steps done with a check, Done checked once current. */
export function renderSteps(doc, current) {
  const ol = make(doc, 'ol', 'mk-steps');
  ol.setAttribute('aria-label', 'Install steps');
  INSTALL_STEPS.forEach((label, i) => {
    if (i > 0) {
      const sep = make(doc, 'li', 'mk-step-sep');
      sep.setAttribute('aria-hidden', 'true');
      ol.append(sep);
    }
    const li = make(doc, 'li', i < current ? 'mk-step is-done' : 'mk-step');
    if (i === current) li.setAttribute('aria-current', 'step');
    const n = make(doc, 'span', 'mk-step-n');
    if (i < current || (i === 3 && current === 3)) n.append(icon(doc, 'check', 12));
    else n.textContent = String(i + 1);
    li.append(n, make(doc, 'span', 'mk-step-label', label));
    ol.append(li);
  });
  return ol;
}

/** The version the sheet shows: the item's version, else the sha's first 7 characters, else ''. */
const versionOf = (item) => item?.version || sha7(item?.source?.sha);

/** P3's head slot: the plugin icon, the name as the sheet title, version · marketplace, then the steps. */
export function renderSheetHead(doc, item, { step = 0 } = {}) {
  const frag = doc.createDocumentFragment();
  const id = make(doc, 'div', 'mk-sheet-id');
  const main = make(doc, 'div', 'mk-sheet-id-main');
  const title = make(doc, 'h2', 'subpage-title', item.name);
  title.id = 'mk-sheet-title';
  const meta = make(doc, 'div', 'mk-meta');
  const ver = versionOf(item);
  if (ver) {
    const dot = make(doc, 'span', null, ' · ');
    dot.setAttribute('aria-hidden', 'true');
    meta.append(make(doc, 'span', ver === sha7(item.source?.sha) ? 'mk-ver mk-mono' : 'mk-ver', ver), dot);   // a sha standing in is code (L23)
  }
  meta.append(make(doc, 'span', null, item.marketplace?.name ?? ''));
  main.append(title, meta);
  id.append(kindTile(doc, item.iconKind, { size: 'lg' }), main);
  frag.append(id, renderSteps(doc, step));
  return frag;
}

/** div.mk-wash.mk-wash-bad[role]: the alert glyph, an optional bold title, then the text. */
export function errorWash(doc, text, { title = null, role = 'alert' } = {}) {
  const w = make(doc, 'div', 'mk-wash mk-wash-bad');
  w.setAttribute('role', role);
  w.append(icon(doc, 'alert', 16));
  if (title) w.append(make(doc, 'strong', 'mk-wash-title', title));
  w.append(make(doc, 'span', 'mk-wash-text', String(text ?? '')));
  return w;
}

function section(doc, id, label) {
  const s = make(doc, 'section', 'mk-sec');
  s.setAttribute('aria-labelledby', id);
  const h = make(doc, 'h3', 'subsection-title', label);
  h.id = id;
  s.append(h);
  return s;
}

const INBOUND_WARNING = 'Anyone holding the bot token or in an allowed channel can pause, stop and approve runs.';

/** The Review step body (board 1.2): what the plugin adds, the secrets it asks for, setup and source. */
export function renderReview(doc, item, { needsGit = false, error = null } = {}) {
  const inv = item.entry?.inventory ?? {};
  const body = make(doc, 'div', 'mk-stack');
  if (error) body.append(errorWash(doc, error));
  if (item.description) body.append(make(doc, 'p', 'mk-desc', item.description));

  const rows = addsRows(inv);
  if (rows.length || !Array.isArray(inv.mcpServers)) {
    const adds = section(doc, 'mk-r-adds', 'Adds');
    const ul = make(doc, 'ul', 'mk-list');
    for (const r of rows) {
      const li = make(doc, 'li', 'mk-list-row');
      const main = make(doc, 'div', 'mk-row-main');
      main.append(make(doc, 'div', r.mono ? 'mk-row-title mk-mono' : 'mk-row-title', r.title), make(doc, 'div', 'mk-meta', r.meta));
      li.append(kindTile(doc, r.kind, { size: 'sm' }), main);
      if (r.worker) li.append(chip(doc, 'n', 'Runs a persistent worker'));
      ul.append(li);
    }
    adds.append(ul);
    if (!Array.isArray(inv.mcpServers)) adds.append(make(doc, 'div', 'mk-wash', 'MCP servers: unknown. Refresh the marketplace'));
    body.append(adds);
  }

  const keys = asksFor(inv);
  if (keys.length) {
    const asks = section(doc, 'mk-r-asks', 'Asks for');
    const ul = make(doc, 'ul', 'mk-list');
    for (const key of keys) {
      const li = make(doc, 'li', 'mk-list-row');
      const ico = make(doc, 'span', 'mk-ico');
      ico.append(icon(doc, 'key', 16));
      const main = make(doc, 'div', 'mk-row-main');
      main.append(make(doc, 'div', 'mk-row-title mk-mono', key));
      li.append(ico, main, chip(doc, 'n', 'Secret'));
      ul.append(li);
    }
    asks.append(ul);
    body.append(asks);
  }
  if (list(inv.chatChannels).some((c) => c?.inbound)) body.append(errorWash(doc, INBOUND_WARNING, { role: 'note' }));

  const setup = section(doc, 'mk-r-setup', 'Setup');
  for (const l of setupLines(inv)) setup.append(make(doc, 'div', l.mono ? 'mk-setup-line mk-mono' : 'mk-setup-line', l.text));
  body.append(setup);

  const { repoUrl = null, subdir = '', sha = null, webUrl } = item.source ?? {};
  const source = section(doc, 'mk-r-source', 'Source');
  const src = make(doc, 'div', 'mk-src');
  const main = make(doc, 'div', 'mk-src-main');
  const url = make(doc, 'span', 'mk-src-url mk-mono', String(repoUrl ?? '').replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/\.git$/, ''));
  if (subdir) url.append(make(doc, 'span', 'mk-src-sep', ' / '), doc.createTextNode(subdir));
  main.append(url);
  if (sha) main.append(make(doc, 'span', 'mk-src-sha mk-mono', `@ ${sha7(sha)}`));
  if (needsGit) main.append(renderNeedsGit(doc));
  src.append(icon(doc, 'git', 16), main);
  const href = webUrl ?? githubWebUrl(repoUrl, sha, subdir);
  if (href) {
    const a = make(doc, 'a', 'mk-link', 'View on GitHub');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.append(icon(doc, 'external', 14));
    src.append(a);
  }
  source.append(src);
  body.append(source);
  return body;
}

/** The Set up step body (board 1.3): the installed wash, an error when set, then one Set up section per entry. */
export function renderSetupStep(doc, item, sections, { error = null } = {}) {
  const body = make(doc, 'div', 'mk-stack');
  const ok = make(doc, 'div', 'mk-wash mk-wash-ok');
  ok.setAttribute('role', 'status');
  const sha = sha7(item.source?.sha);
  const ver = versionOf(item) === sha ? '' : versionOf(item);   // a version that is only the sha shows it once, as code
  ok.append(icon(doc, 'check', 16), make(doc, 'span', 'mk-wash-text', `Installed ${item.name}${ver ? ` ${ver}` : ''}`));
  if (sha) ok.append(make(doc, 'span', 'mk-wash-end mk-mono', sha));
  body.append(ok);
  if (error) body.append(errorWash(doc, error));
  for (const s of list(sections)) body.append(renderSetupFields(doc, s, { mode: 'install' }));
  return body;
}

/** 'Chat channel' -> 'chat channel'; 'MCP server' keeps its case (the second letter is upper case). */
const lowerKind = (s) => (/^.[a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/** Today's parseIdList rule (src/core/chat/allowlist.mjs): split on ',', trim, drop blanks, joined ', '. */
const ids = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean).join(', ');

/** One row per kind the plugin adds: { kind, title, meta: [{ text, mono? }], link: landing(kind) }. */
export function nowRows(inventory, { values = {} } = {}) {
  const inv = inventory ?? {};
  return KIND_ORDER.flatMap((kind) => {
    const items = list(inv[kind]);
    if (!items.length) return [];
    const names = items.map((x) => ROW[kind](x).title);
    if (items.length > 1) {
      return [{ kind, title: `${items.length} ${lowerKind(KINDS[kind].many)}`, meta: [{ text: names.join(', ') }], link: landing(kind) }];
    }
    const meta = [];
    if (kind === 'chatChannels') {
      const v = values?.[items[0].id] ?? {};
      const notify = ids(v.notifyChatIds);
      const allowed = ids(v.allowedChatIds);
      if (notify) meta.push({ text: 'Notifies ' }, { text: notify, mono: true });
      if (allowed) meta.push({ text: notify ? ' · commands from ' : 'Commands from ' }, { text: allowed, mono: true });
    }
    return [{ kind, title: `${names[0]} ${lowerKind(KINDS[kind].one)}`, meta, link: landing(kind) }];
  });
}

function linkRow(doc, href, link, text) {
  const a = make(doc, 'a', 'mk-lrow');
  a.href = href;
  a.dataset.link = link;
  a.append(make(doc, 'span', null, text), icon(doc, 'chevron', 16));
  return a;
}

/** The Done step body (board 1.4): the ready hero with live channel chips, Now in worca, Next. */
export function renderDone(doc, item, { channels = [], values = {} } = {}) {
  const inv = item.entry?.inventory ?? {};
  const body = make(doc, 'div', 'mk-stack');
  const hero = make(doc, 'div', 'mk-done-hero');
  const tile = make(doc, 'span', 'mk-ok-tile');
  tile.append(icon(doc, 'check', 28));
  hero.append(tile, make(doc, 'h3', 'subpage-title', `${item.name} is ready`));
  const mine = list(channels).filter((c) => c?.plugin === item.name);
  if (mine.length) {
    const chips = make(doc, 'div', 'mk-chips');
    for (const c of mine) chips.append(channelBadge(doc, c));
    hero.append(chips);
  }
  body.append(hero);

  const rows = nowRows(inv, { values });
  if (rows.length) {
    const now = section(doc, 'mk-d-now', 'Now in worca');
    const ul = make(doc, 'ul', 'mk-list');
    for (const r of rows) {
      const li = make(doc, 'li', 'mk-list-row');
      const main = make(doc, 'div', 'mk-row-main');
      main.append(make(doc, 'div', 'mk-row-title', r.title));
      if (r.meta.length) {
        const meta = make(doc, 'div', 'mk-meta');
        for (const p of r.meta) meta.append(p.mono ? make(doc, 'span', 'mk-mono', p.text) : doc.createTextNode(p.text));
        main.append(meta);
      }
      li.append(kindTile(doc, r.kind, { size: 'sm' }), main);
      if (r.link) {
        const a = make(doc, 'a', 'mk-link', r.link.label);
        a.href = r.link.href;
        a.dataset.link = 'landing';
        a.append(icon(doc, 'chevron', 14));
        li.append(a);
      }
      ul.append(li);
    }
    now.append(ul);
    body.append(now);
  }

  const next = section(doc, 'mk-d-next', 'Next');
  const links = make(doc, 'div', 'mk-links');
  if (list(inv.mcpServers).length) links.append(linkRow(doc, '#connectors/servers', 'connectors', 'Set up in Connectors'));
  links.append(linkRow(doc, '#marketplace/installed', 'manage', `Manage ${item.name}`));
  if (KIND_ORDER.includes(item.iconKind)) {
    links.append(linkRow(doc, '#marketplace/browse', 'browse', `Browse more ${lowerKind(KINDS[item.iconKind].many)}`));
  }
  next.append(links);
  body.append(next);
  return body;
}
