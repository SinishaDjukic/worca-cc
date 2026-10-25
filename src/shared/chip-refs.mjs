// src/shared/chip-refs.mjs
// Chat answer chips (ui/public/ask-ref-chips.mjs): which links and which text in an assistant answer name a GitHub
// pull request or issue, an Azure DevOps pull request or work item, a worca run or a chat, and the ONE key string
// the browser sends to POST /api/ask/refs/resolve and the server re-parses (parseRefKey) before it looks anything
// up. Bare refs that name no repo or organization (`PR #777`, `AB#123`) are never refs: a chat has no fixed project.
// Pure: no I/O, browser-importable.
import { parseAzurePrUrl } from './azure-remote.mjs';

/** Refs one resolve request may carry (the route answers 400 above it; the browser sends chunks of this size). */
export const REFS_MAX = 50;

const NUM = '[1-9]\\d{0,8}';                                          // <= 999,999,999: a GraphQL Int and an ADO id
const OWNER = '[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}';    // GitHub's login rule: no leading, trailing or double hyphen
const REPO = '[A-Za-z0-9._-]{1,100}';
const PIPELINE_ID = '[0-9a-f]{8}';
const LIVE_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ORG_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,49}$/;
const GH_URL_RE = new RegExp(`^https://(?:www\\.)?github\\.com/(${OWNER})/(${REPO})/(pull|issues)/(${NUM})(?:[/?#].*)?$`);
const ADO_WI_RE = new RegExp(`^https://(?:[^@/?#]+@)?([^/:?#]+)/((?:[^/?#]+/){0,3})_workitems/edit/(${NUM})/?(?:[?#].*)?$`, 'i');
const VS_HOST_RE = /^([a-z0-9][a-z0-9-]*)\.visualstudio\.com$/i;
const PIPELINE_RE = new RegExp(`^${PIPELINE_ID}$`);
const LIVE_RE = new RegExp(`^${LIVE_ID}$`);
const CHAT_RE = /^ask_[0-9a-f]{8}$/;
// Text refs. `gh` never follows a path, a URL or an address character; `run` (a bare History id) never sits inside a
// longer hex string, an id such as ask_… or proj-…, a path, or a file name. The server confirms every run candidate.
const TEXT_RE = new RegExp([
  `(?<gh>(?<![\\w./@-])(?<owner>${OWNER})/(?<repo>${REPO})#(?<num>${NUM})(?![\\w#-]))`,
  '(?<chat>(?<![\\w-])ask_[0-9a-f]{8}(?![\\w-]))',
  `(?<run>(?<![\\w./#:@-])${PIPELINE_ID}(?![\\w-]|[./:][\\w]))`,
].join('|'), 'g');
const KEY_RES = {
  gh: new RegExp(`^gh:(${OWNER})/(${REPO})#(${NUM})$`),
  adopr: new RegExp(`^adopr:([^/#\\s]{1,200})/([^/#\\s]{1,200})#(${NUM})$`),
  adowi: new RegExp(`^adowi:([^/#\\s]{1,200})#(${NUM})$`),
  run: new RegExp(`^run:(${PIPELINE_ID}|${LIVE_ID})$`),
  chat: /^chat:(ask_[0-9a-f]{8})$/,
};

// The run pages' tab words in the address (ui/public/nav/routes.mjs ROUTES.running/history tabs, keys and aliases;
// src/shared cannot import ui/public, so test/nav-routes.test.mjs pins this copy equal to the table).
export const RUN_TAB_WORDS = Object.freeze(new Set(['summary', 'diff', 'changes', 'artifacts', 'actions', 'workflow',
  'logs', 'agents', 'qa', 'overview', 'clarify']));

const dec = (x) => { try { return decodeURIComponent(x); } catch { return null; } };
const enc = encodeURIComponent;
// An ADO project name, decoded: printable, at most 64 characters (Azure's own limit), never a path. (Char codes, not a
// regex class of escapes: an editor that turns the escapes into raw control bytes makes git treat the file as binary.)
const okProject = (p) => typeof p === 'string' && p.length > 0 && p.length <= 64
  && [...p].every((c) => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127 && c !== '/' && c !== '\\');

function gh(owner, repo, number, type = null) {
  return { kind: 'gh', key: `gh:${owner}/${repo}#${number}`, owner, repo, number, type, label: `${owner}/${repo}#${number}`,
    url: `https://github.com/${owner}/${repo}/${type === 'pr' ? 'pull' : 'issues'}/${number}` };
}

function adoWorkItem(href) {
  const m = ADO_WI_RE.exec(href);
  if (!m) return null;
  const host = m[1].toLowerCase();
  const segs = m[2].split('/').filter(Boolean).map(dec);
  if (segs.some((s) => s == null)) return null;
  let org;
  if (host === 'dev.azure.com') org = segs.shift();
  else {
    const vs = VS_HOST_RE.exec(host);
    if (!vs) return null;
    org = vs[1];
    if (segs[0] && segs[0].toLowerCase() === 'defaultcollection') segs.shift();
  }
  if (!org || !ORG_RE.test(org) || segs.length > 1 || (segs[0] && !okProject(segs[0]))) return null;
  const number = Number(m[3]);
  return { kind: 'adowi', key: `adowi:${enc(org)}#${number}`, org, number, label: `AB#${number}`, url: href };
}

function hashRef(href) {
  const m = /^#(history|running|chat)\/(.+)$/.exec(href);
  if (!m) return null;
  const segs = m[2].split('/');
  if (m[1] === 'chat') return segs.length === 1 && CHAT_RE.test(segs[0]) ? { kind: 'chat', key: `chat:${segs[0]}`, id: segs[0], url: href } : null;
  // #history/<projectKey>/<id>[/tab], #history/workspaces/<wsId>/<id>[/…], #running/<app run id>[/tab], and the old
  // …/details[/tab] forms (they still open the same tab).
  const at = m[1] === 'running' ? 0 : segs[0] === 'workspaces' ? 2 : 1;
  const id = segs[at] || '';
  const tail = segs.slice(at + 1);
  const okTail = !tail.length || (tail.length === 1 && RUN_TAB_WORDS.has(tail[0]))
    || (tail[0] === 'details' && tail.length <= 2);
  if (!okTail) return null;
  if (m[1] === 'running' ? !LIVE_RE.test(id) : !(PIPELINE_RE.test(id) && segs.slice(0, at).every(Boolean))) return null;
  return { kind: 'run', key: `run:${id}`, id, url: href };
}

/** What an answer link's href names, or null: { kind:'gh'|'adopr'|'adowi'|'run'|'chat', key, label?, url, … }. */
export function refFromHref(href) {
  const s = String(href || '').trim();
  if (s.startsWith('#')) return hashRef(s);
  const g = GH_URL_RE.exec(s);
  if (g) return { ...gh(g[1], g[2], Number(g[4]), g[3] === 'pull' ? 'pr' : 'issue'), url: s };
  const pr = /\/pullrequest\//i.test(s) ? parseAzurePrUrl(s) : null;
  if (pr) {
    if (!ORG_RE.test(pr.org) || !okProject(pr.project) || !Number.isSafeInteger(pr.number) || pr.number < 1 || pr.number > 999_999_999) return null;
    return { kind: 'adopr', key: `adopr:${enc(pr.org)}/${enc(pr.project)}#${pr.number}`, org: pr.org, project: pr.project, repo: pr.repo,
      number: pr.number, label: `${pr.repo}!${pr.number}`, url: s };
  }
  return adoWorkItem(s);
}

/** The refs in one text node's text: [{ start, end, ref }] in order. `owner/repo#N` is a GitHub issue or PR (the
 *  lookup tells which); `ask_<8 hex>` a chat; 8 hex a run CANDIDATE (`kind:'run', candidate:true`). */
export function refsInText(text) {
  const out = [];
  for (const m of String(text || '').matchAll(TEXT_RE)) {
    const g = m.groups;
    const ref = g.gh ? gh(g.owner, g.repo, Number(g.num))
      : g.chat ? { kind: 'chat', key: `chat:${g.chat}`, id: g.chat, url: `#chat/${g.chat}` }
        : { kind: 'run', key: `run:${g.run}`, id: g.run, url: null, candidate: true };
    out.push({ start: m.index, end: m.index + m[0].length, ref });
  }
  return out;
}

/** The server's half: a key from the browser → { kind, … } | null. Strict: only what refFromHref/refsInText mint. */
export function parseRefKey(key) {
  if (typeof key !== 'string' || key.length > 300) return null;
  const kind = key.slice(0, key.indexOf(':'));
  const re = Object.hasOwn(KEY_RES, kind) ? KEY_RES[kind] : null;   // `constructor:x` names no kind
  const m = re ? re.exec(key) : null;
  if (!m) return null;
  if (kind === 'gh') return { kind, key, owner: m[1], repo: m[2], number: Number(m[3]) };
  if (kind === 'run' || kind === 'chat') return { kind, key, id: m[1] };
  const org = dec(m[1]);
  if (!org || !ORG_RE.test(org)) return null;
  if (kind === 'adowi') return { kind, key, org, number: Number(m[2]) };
  const project = dec(m[2]);
  return okProject(project) ? { kind, key, org, project, number: Number(m[3]) } : null;
}
