// ui/public/marketplace/update-model.mjs — the Update review sheet's pure rules (marketplace P6, board 3.2, DECISIONS
// U2): which card is ready, what the footer says, which access chip and "What changes" lines a preview gives. No DOM.
import { needsReview } from '../../../src/shared/plugin-access.mjs';
import { relTime } from '../plugins-view.mjs';

/** The chip label of each access kind (P1 SM12: `mcp` / `skill` = a new or changed server / skill). */
export const ACCESS_LABELS = Object.freeze({
  secret: 'New secret', channelSecret: 'New secret', modelSecret: 'New secret',
  modelEnv: 'Model env changed', setup: 'Setup changed', taskSource: 'New task source', chatChannel: 'New chat channel',
  agent: 'New agent', model: 'New model', mcp: 'MCP server change', skill: 'Skill change',
});

const list = (v) => (Array.isArray(v) ? v : []);
const sha7 = (sha) => (typeof sha === 'string' && sha ? sha.slice(0, 7) : '');
const afterDot = (id) => { const s = String(id ?? ''); const i = s.indexOf('.'); return i === -1 ? s : s.slice(i + 1); };

/** One "What changes" line per access kind: [text, mono(id), glyph]. `mcp` and `skill` come from the server's lines. */
const LINE = {
  secret: (id) => ['New secret: ', afterDot(id), 'key'],
  channelSecret: (id) => ['New secret: ', afterDot(id), 'key'],
  modelSecret: (id) => ['New secret: ', afterDot(id), 'key'],
  modelEnv: (id) => ['Model env changed: ', String(id ?? ''), 'alert'],
  setup: () => ['Setup commands changed', null, 'script'],
  taskSource: (id) => ['New task source: ', String(id ?? ''), 'tray'],
  chatChannel: (id) => ['New chat channel: ', String(id ?? ''), 'chat'],
  agent: (id) => ['New agent: ', String(id ?? ''), 'agent'],
  model: (id) => ['New model: ', String(id ?? ''), 'cube'],
};

/** The card's access chip: the first red change, else the first change; no change → null. */
export function accessChip(changes) {
  const all = list(changes);
  if (!all.length) return null;
  const c = all.find((x) => x?.red) ?? all[0];
  return { label: ACCESS_LABELS[c?.kind] ?? 'New access', red: !!c?.red };
}

/** "What changes": the access lines (red first), then removed models, then the server's MCP and skill lines. */
export function deltaLines(preview) {
  const access = list(preview?.access).filter((c) => c && c.kind !== 'mcp' && c.kind !== 'skill' && Object.hasOwn(LINE, c.kind));
  const sorted = [...access.filter((c) => c.red), ...access.filter((c) => !c.red)];
  const d = preview?.manifestDelta ?? {};
  return [
    ...sorted.map((c) => { const [text, mono, glyph] = LINE[c.kind](c.id); return { text, mono, red: !!c.red, glyph }; }),
    ...list(d.removedModels).map((id) => ({ text: 'Removed model: ', mono: String(id), red: false, glyph: 'cube' })),
    ...list(d.mcpLines).map((l) => ({ text: String(l?.text ?? ''), mono: null, red: !!l?.red, glyph: 'plug' })),
    ...list(d.skillLines).map((l) => ({ text: String(l?.text ?? ''), mono: null, red: !!l?.red, glyph: 'skill' })),
  ];
}

const SUMMARY_RE = /^(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?$/;

/** The `git diff --stat` / formatDiffstat summary line (LF or CRLF): { files, insertions, deletions } (null halves), else null. */
export function parseDiffstat(text) {
  const last = String(text ?? '').replace(/\r\n/g, '\n').trim().split('\n').at(-1).trim();   // git indents the summary line
  const m = SUMMARY_RE.exec(last);
  if (!m) return null;
  return { files: Number(m[1]), insertions: m[2] == null ? null : Number(m[2]), deletions: m[3] == null ? null : Number(m[3]) };
}

/** Nothing to update (P5 installed.mjs's rule): the candidate is the pin, or — a monorepo marketplace moves candidateSha to
 *  the repository tip while the plugin folder did not change — no commits and an empty diffstat. */
export function isUpToDate(p) {
  return !!p?.candidateSha && (p.candidateSha === p.pinnedSha || (Array.isArray(p.commits) && !p.commits.length && !String(p.diffstat ?? '').trim()));
}

/** A card for one Installed row, before its preview. */
export function newCard(row) {
  return { name: row.name, row, state: 'loading', preview: null, error: null, include: true, reviewed: false, stale: false, expanded: false };
}

/** New access, or a preview that went stale: the card waits for "I've reviewed these changes". */
export function needsTick(c) {
  return !!c.stale || (!!c.preview && needsReview(c.preview.access || []));
}

/** Still to update: previewing or in review. */
export function isPending(c) {
  return c.state === 'loading' || c.state === 'review';
}

/** In the run: a pending card whose Include is ticked; one that is still previewing or needs the tick has no Include. */
export function isIncluded(c) {
  return isPending(c) && (c.state === 'loading' || needsTick(c) || !!c.include);
}

/** Ready to apply: in review, included, and ticked when it must be. */
export function isReady(c) {
  return c.state === 'review' && isIncluded(c) && (!needsTick(c) || !!c.reviewed);
}

/** The footer: "<k> of <n> ready", the "only" button while some are ready, the primary; Done once nothing is pending. */
export function footState(cards) {
  const pending = cards.filter(isPending);
  if (!pending.length) {
    const done = cards.filter((c) => c.state === 'done').length;
    return { meta: `${done} of ${cards.length} updated`, only: null, primary: 'Done', enabled: true, finished: true };
  }
  const inc = pending.filter(isIncluded);
  const rdy = inc.filter(isReady);
  const n = inc.length;
  const k = rdy.length;
  return {
    meta: n ? `${k} of ${n} ready` : '',
    // never beside a preview still out: previews and applies share the marketplace's git cache (LC-P6-5)
    only: k > 0 && k < n && !pending.some((c) => c.state === 'loading') ? (k === 1 ? `Update ${rdy[0].name} only` : `Update ${k} ready`) : null,
    primary: n === 0 ? 'Update' : n === 1 ? `Update ${inc[0].name}` : `Update ${n} plugins`,
    enabled: n > 0 && k === n,
    finished: false,
  };
}

/** The sheet title: "Update <name>" for one card, else "Update <n> plugins". */
export function sheetTitle(cards) {
  return cards.length === 1 ? `Update ${cards[0].name}` : `Update ${cards.length} plugins`;
}

/** "<from> → <to>": the preview's versions, else the row's, else short shas. */
export function versionRange(c) {
  const from = c.preview?.pinnedVersion ?? c.row.version ?? sha7(c.row.pinnedSha);
  const to = c.preview?.candidateVersion ?? c.row.latest?.version ?? sha7(c.preview?.candidateSha);
  return to ? `${from} → ${to}` : from;
}

/** The head's line: "Previewed <when>" from the latest preview, "Previewing…" before any. */
export function previewedLabel(cards, now = Date.now()) {
  let at = null;
  for (const c of cards) {
    const t = c.preview?.previewedAt;
    if (typeof t === 'string' && Number.isFinite(Date.parse(t)) && (at == null || Date.parse(t) > Date.parse(at))) at = t;
  }
  return at == null ? 'Previewing…' : `Previewed ${relTime(at, now)}`;
}
