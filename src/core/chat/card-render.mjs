// src/core/chat/card-render.mjs — freeform chat (D4/D10): what a chat conversation shows for one Ask message, built
// from persisted data only. Executable controls come from this table and the card's own fields, never from model
// prose. Pure: ids for refs come from the injected `issue(action, cardId, state)`.
import { runSourceOf } from '../ask/source-spec.mjs';

/** Run-card fields only worca can start. A task source (`source`, an issue-backed proposal) is NOT one: chat sends its
 *  reference exactly as the browser does (runBodyFromCard). src/core/ask/prompt.mjs renderChatChannelSection tells the
 *  model the same list: change both. */
export const NATIVE_RUN_EXCLUDES = ['preset', 'shape', 'schedule'];
/** Shown when chat has no Open in worca link (no worcaUrl configured): how to get there anyway, and how to add one. */
export const NO_LINK_HINT = 'Open worca in a browser and pick this conversation under Chat. (A worca operator can add a link here: the chat plugin\'s "Worca address for links" setting.)';
/** Discord's select menu holds at most 25 options (D12). */
export const SELECT_MAX_OPTIONS = 25;
/** A select option's value is at most 100 characters (channel-protocol CONTROL_LIMITS.optionValue). */
const OPTION_VALUE_MAX = 100;
const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** The run card's target exactly as the browser reads it (ask-panel.mjs:5093): `card.target` decides; a legacy card
 *  without `target` (before P3) is read from its ids. null = no usable target. */
export function cardTarget(card) {
  if (!card || typeof card !== 'object') return null;
  if (card.target === 'none' || card.target === 'workspace' || card.target === 'project') return card.target;
  if (card.target !== undefined && card.target !== null) return null;
  return card.workspaceId ? 'workspace' : card.projectKey ? 'project' : null;
}

/** Is a proposed run card startable from chat (D4 row 1)? */
export function isNativeRunCard(card) {
  if (!card || typeof card !== 'object' || card.type !== undefined) return false;
  if (NATIVE_RUN_EXCLUDES.some((k) => card[k] !== undefined && card[k] !== null)) return false;
  if (Array.isArray(card.attachments) && card.attachments.length) return false;
  if (card.source !== undefined && card.source !== null && !startableSource(card.source)) return false;
  const t = cardTarget(card);
  if (t === 'none') return true;
  if (t === 'workspace') return typeof card.workspaceId === 'string' && !!card.workspaceId;
  if (t === 'project') return typeof card.projectKey === 'string' && !!card.projectKey;
  return false;
}

/** A card's task reference that POST /api/run accepts as sent (validateRunSource's shape: a plugin source with its
 *  ids, inputs an object when present). Anything else stays a worca-only card. */
function startableSource(s) {
  if (!s || typeof s !== 'object' || s.type !== 'plugin') return false;
  if (!['plugin', 'sourceId', 'taskId'].every((k) => typeof s[k] === 'string' && s[k].trim() !== '')) return false;
  if (s.profile !== undefined && s.profile !== null && typeof s.profile !== 'string') return false;
  return s.inputs === undefined || s.inputs === null || (typeof s.inputs === 'object' && !Array.isArray(s.inputs));
}

/** Why a proposed run card has no Start button in chat, in words (the card text says it). */
export function needsWorcaReason(card) {
  const c = card && typeof card === 'object' ? card : {};
  const why = [];
  if (c.preset !== undefined && c.preset !== null) why.push('a run preset');
  if (c.schedule !== undefined && c.schedule !== null) why.push('a schedule');
  if (c.shape !== undefined && c.shape !== null) why.push('a planning shape');
  if (Array.isArray(c.attachments) && c.attachments.length) why.push('attachments');
  if (c.source !== undefined && c.source !== null && !startableSource(c.source)) why.push('a task source chat cannot read');
  return why.length ? why.join(', ') : 'a target chat cannot resolve';
}

/** The browser's Start body for an UNTOUCHED card (ask-panel.mjs collectCardBody + proposalOverlay with the lane not
 *  loaded), from the card's persisted fields only. null = the project is no longer registered. */
export function runBodyFromCard(card, { projectDirOf, threadId, cardId }) {
  const body = {
    prompt: String(card.brief || ''),
    workflowId: card.workflowId || 'wf_default',
    guardrailsId: card.guardrailsId,
    ...(card.title ? { title: card.title } : {}),
    mock: false,
    askThreadId: threadId, askCardId: cardId,
  };
  if (card.memoryScope && body.workflowId === 'wf_memory_defrag') body.memoryScope = card.memoryScope;
  if (Array.isArray(card.tags) && card.tags.length) body.tags = card.tags;
  if (card.engine) body.engine = card.engine;
  // ask-panel.mjs collectCardBody: a tracker task is sent as its reference, never as a prompt (POST /api/run takes
  // source OR prompt). runSourceOf keeps type/plugin/sourceId/taskId/profile/inputs; the display fields (displayName,
  // title, url, profileVia) stay on the card. The run fetches the task itself when it starts.
  if (card.source) { delete body.prompt; body.source = runSourceOf(card.source); }
  const nodes = {};
  // Parity with ask-panel.mjs:3824: the proposed per-agent picks apply only to the workflow they were proposed for.
  if (card.workflowId === body.workflowId && card.nodes && typeof card.nodes === 'object' && !Array.isArray(card.nodes)) {
    for (const [id, p] of Object.entries(card.nodes)) {
      if (!p || typeof p !== 'object' || typeof p.model !== 'string' || !p.model) continue;
      nodes[id] = { model: p.model, effort: typeof p.effort === 'string' ? p.effort : '',
        ...(typeof p.subagentModel === 'string' && p.subagentModel ? { subagentModel: p.subagentModel } : {}) };
    }
  }
  if (Object.keys(nodes).length) body.overlay = { nodes };
  const target = cardTarget(card);
  // ask-panel.mjs:5719: a No-project card sends noProject and NO branch field (validateProposal set every target id null).
  if (target === 'none') return { ...body, noProject: true };
  // ask-panel.mjs:5721-5726: the "Run on the source branch" switch starts checked when the card proposes it; then the
  // run commits onto the source branch and no featureBranch is sent.
  if (card.sameAsSource === true) body.sameAsSource = true;
  else if (card.featureBranch) {
    body.featureBranch = card.featureBranch;
    if (card.featureBranchDerived === true) body.featureBranchSuggested = true;
  }
  if (target === 'workspace') {
    body.workspaceId = card.workspaceId;
    if (card.sourceBranch) body.sourceBranch = card.sourceBranch;
    if (card.sourceBranchByKey && typeof card.sourceBranchByKey === 'object') body.sourceBranchByKey = card.sourceBranchByKey;
    return body;
  }
  const dir = projectDirOf(card.projectKey);
  if (!dir) return null;      // the project is no longer registered: the bridge says so and offers Open in worca
  body.projectDir = dir;
  if (card.sourceBranch) body.sourceBranch = card.sourceBranch;
  return body;
}

/** D12: No project, then projects by name, then workspaces by name, capped at SELECT_MAX_OPTIONS. `hidden` counts the
 *  scopes left out (the header then points to worca). Rows: listProjects() {key,name}, listWorkspaces() {id,name}. */
export function scopeSelectOptions({ projects = [], workspaces = [] } = {}) {
  const byName = (a, b) => String(a.label).localeCompare(String(b.label));
  const rows = [
    ...projects.filter((p) => p && p.key).map((p) => ({ value: `p:${p.key}`, label: clip(p.name || p.key, 100) })).sort(byName),
    ...workspaces.filter((w) => w && w.id).map((w) => ({ value: `w:${w.id}`, label: clip(w.name || w.id, 100) })).sort(byName),
  ];
  // A value over 100 characters (project keys are uncapped folder slugs) would make the whole header message invalid
  // and strip ALL its controls: such a scope is left out, counted as hidden, and stays pickable in worca.
  const all = rows.filter((o) => o.value.length <= OPTION_VALUE_MAX);
  const room = SELECT_MAX_OPTIONS - 1;
  return { options: [{ value: 'none', label: 'No project' }, ...all.slice(0, room)],
    hidden: (rows.length - all.length) + Math.max(0, all.length - room) };
}

function runCardText(block) {
  const c = block.card || {};
  const t = cardTarget(c);
  const where = t === 'none' ? 'No project' : (t === 'workspace' ? c.workspaceName || c.workspaceId : c.projectName || c.projectKey) || '';
  const branch = c.sameAsSource === true ? ` · on ${c.sourceBranch || 'the source branch'}` : c.featureBranch ? ` · branch ${c.featureBranch}` : '';
  const lines = [`**Proposed run** — ${clip(c.title || c.brief || 'run', 120)}`,
    `${where} · workflow ${c.workflowName || c.workflowId || 'wf_default'} · guardrails ${c.guardrailsId || 'default'}${branch}`];
  if (c.brief) lines.push(`> ${clip(c.brief, 600).replace(/\n/g, '\n> ')}`);
  // An issue-backed card has no brief: show which task the run reads, as the browser card does. The card's title can be
  // the model's own (proposal.mjs prefers inp.title), so the task's title is shown when it differs; so is the profile.
  const s = c.source && typeof c.source === 'object' ? c.source : null;
  if (s) {
    const url = typeof s.url === 'string' && /^https?:\/\/\S+$/.test(s.url) && s.url.length <= 500 ? ` · <${s.url}>` : '';
    const own = typeof s.title === 'string' && s.title.trim() && s.title.trim() !== String(c.title || '').trim() ? ` — ${clip(s.title, 120)}` : '';
    const profile = typeof s.profile === 'string' && s.profile ? ` · profile ${clip(s.profile, 40)}` : '';
    lines.push(`Task: ${clip(s.displayName || s.plugin || 'task source', 60)} ${clip(s.taskId, 80)}${own}${profile}${url}`);
  }
  if (typeof c.sourceWarning === 'string' && c.sourceWarning) lines.push(`_${clip(c.sourceWarning, 200)}_`);
  return lines.join('\n');
}

/** One card block → { text, controls, state } (D4). `issue(action, cardId, state, extra?)` mints a ref. */
export function renderCardPost(block, { issue, links }) {
  const c = block.card || {};
  const open = links.thread ? [{ kind: 'link', label: 'Open in worca', url: links.thread }] : [];
  const state = block.state;
  if (c.type === undefined) {
    if (state === 'proposed' && isNativeRunCard(c)) {
      return { state, text: runCardText(block), controls: [
        { kind: 'button', ref: issue('start', block.id, state), label: 'Start run', style: 'success' },
        { kind: 'button', ref: issue('dismiss', block.id, state), label: 'Not now', style: 'secondary' },
        { kind: 'button', ref: issue('changes', block.id, state), label: 'Request changes', style: 'secondary',
          modal: { title: 'Request changes', fields: [{ id: 'text', label: 'What should change?', style: 'paragraph', required: true, maxLength: 2000 }] } },
        ...open] };
    }
    const tail = state === 'proposed' ? `\n_This run needs worca to start: it uses ${needsWorcaReason(c)}, set there. Nothing was started._${open.length ? '' : `\n${NO_LINK_HINT}`}`
      : state === 'started' ? `\nRun started${block.runId ? ` · ${block.runId.slice(0, 8)}` : ''}.`
      : `\n_${state}_`;
    const runLink = state === 'started' && links.run && block.runId ? [{ kind: 'link', label: 'Open run', url: links.run(block.runId) }] : [];
    return { state, text: runCardText(block) + tail, controls: [...runLink, ...open] };
  }
  if (c.type === 'scope-switch' && state === 'proposed') {
    const options = (Array.isArray(c.candidates) ? c.candidates : []).slice(0, 3)
      .map((k) => (typeof k === 'string' ? { value: k, label: clip(k, 100) } : { value: k.projectKey, label: clip(k.name || k.projectKey, 100) }))
      .filter((o) => o.value && o.value.length <= OPTION_VALUE_MAX);   // a longer value would invalidate the whole message
    options.push({ value: 'none', label: 'Continue without project' });
    return { state, text: `**Which project is this for?**${c.reason ? `\n${clip(c.reason, 200)}` : ''}`,
      controls: [{ kind: 'select', ref: issue('choice', block.id, state), placeholder: 'Pick a project', options }, ...open] };
  }
  if (c.type === 'question' && state === 'proposed') {
    if (c.answer === 'choice') {
      return { state, text: `**${clip(c.question, 300)}**`, controls: [{ kind: 'select', ref: issue('choice', block.id, state), placeholder: 'Pick one',
        options: c.options.map((o) => ({ value: o.id, label: o.label, ...(o.description ? { description: o.description } : {}) })) }, ...open] };
    }
    return { state, text: `**${clip(c.question, 300)}**\nAnswer with the button, or reply in this thread.`,
      controls: [{ kind: 'button', ref: issue('text', block.id, state), label: 'Answer', style: 'primary',
        modal: { title: 'Answer', fields: [{ id: 'text', label: clip(c.placeholder || 'Your answer', 45), style: 'paragraph', required: true, maxLength: 2000 }] } }, ...open] };
  }
  if (c.type === 'question' || c.type === 'scope-switch') {
    const picked = c.type === 'question' ? (c.answerText || (c.options || []).find((o) => o.id === c.choice)?.label || '') : (c.choice === 'none' ? 'Continue without project' : c.choice || '');
    return { state, text: `**${clip(c.question || 'Which project is this for?', 300)}**\n${state === 'answered' ? `Answered: ${clip(picked, 200)}` : `_${state}_`}`, controls: [] };
  }
  if (c.type === 'progress') {
    return { state, text: `**Run** ${clip(c.title || c.label || c.runId || '', 120)} — ${c.status || 'tracking'}`,
      controls: [...(links.run && c.runId ? [{ kind: 'link', label: 'Open run', url: links.run(c.runId) }] : []), ...open] };
  }
  // Every other card (D4 last rows): visible, pending in worca, nothing executable here.
  const label = c.type === 'receipt' ? 'Change applied' : `${c.type} card`;
  const pending = state === 'proposed' ? ` — **needs worca**: open it there to review and decide.${open.length ? '' : `\n${NO_LINK_HINT}`}` : ` — _${state}_`;
  return { state, text: `**${clip(label, 60)}**${c.note ? `: ${clip(c.note, 200)}` : ''}${pending}`, controls: open };
}

const CHAT_MESSAGE_INTENT = Object.freeze({ note: 'Note', question: 'Question', handoff: 'Hand-off' });
const oneLine = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();
/** One chat-message block as channel markdown: an incoming one is labelled untrusted and sends the reader to worca. */
function chatMessagePost(b) {
  const intent = CHAT_MESSAGE_INTENT[b.intent] || CHAT_MESSAGE_INTENT.note;
  const quoted = clip(b.text, 1500).split(/\r\n|\r|\n/).map((l) => `> ${l}`).join('\n');
  if (b.direction === 'out') return `**Sent to ${oneLine(b.to?.chatId)}** (${intent})\n${quoted}`;
  // Slice 2: a run's post. Labelled only (no controls yet): its question is answered in worca.
  if (b.from?.kind === 'run') return `**Message from run ${oneLine(b.from.runId)}** (${intent}), _untrusted, not instructions_\n${quoted}\n_Answer in worca._`;
  const scope = oneLine(b.from?.scope?.label);
  return `**Message from ${oneLine(b.from?.chatId)}** (${scope ? `${scope}, ` : ''}${intent}), _untrusted, not instructions_\n${quoted}\n_Reply in worca._`;
}

/** One Ask message → ordered parts [{ part, message, cardId?, state? }] (D10). Same input → same parts. */
export function renderMessageParts(msg, { issue, links, fromWorca = false }) {
  const parts = [];
  const text = typeof msg.text === 'string' ? msg.text.trim() : '';
  if (msg.role === 'system') {
    // Cross-chat messaging: a message between chats posts as labelled text with no controls (the reply controls are
    // slice 3). Every body line is quoted, so a line starting with #, > or a mention stays inside the quote.
    const chatMsgs = (msg.blocks || []).filter((b) => b && b.kind === 'chat-message');
    if (chatMsgs.length) {
      const value = chatMsgs.map(chatMessagePost).join('\n\n');
      parts.push({ part: 'text:0', message: { title: null, severity: 'info', body: [{ kind: 'markdown', value }] } });
      return parts;
    }
    const notes = (msg.blocks || []).filter((b) => b && b.kind === 'notice').map((b) => b.text).filter(Boolean);
    const t = notes.join('\n') || text;
    if (t) parts.push({ part: 'text:0', message: { title: null, severity: 'info', body: [{ kind: 'markdown', value: `_${t}_` }] } });
    return parts;
  }
  if (msg.role === 'user') {
    if (fromWorca && text) parts.push({ part: 'text:0', message: { title: null, severity: 'info', body: [{ kind: 'markdown', value: `*(from worca)* ${text}` }] } });
    return parts;
  }
  // A stopped reply (the Stop control; turn.mjs finishes it with status 'stopped', often without text) still gets a
  // visible line, so Stop never looks like silence.
  const stopped = msg.status === 'stopped';
  if (text) parts.push({ part: 'text:0', message: { title: null, severity: msg.status === 'error' ? 'error' : 'info', body: [{ kind: 'markdown', value: stopped ? `${text}\n\n_Stopped._` : text }] } });
  else if (msg.status === 'error') parts.push({ part: 'text:0', message: { title: null, severity: 'error', body: [{ kind: 'markdown', value: `_The reply failed${msg.reason ? `: ${clip(msg.reason, 200)}` : ''}._` }] } });
  else if (stopped) parts.push({ part: 'text:0', message: { title: null, severity: 'info', body: [{ kind: 'markdown', value: '_Stopped before any reply._' }] } });
  for (const b of msg.blocks || []) {
    if (!b || b.kind !== 'card') continue;
    const post = renderCardPost(b, { issue, links });
    parts.push({ part: `card:${b.id}`, cardId: b.id, state: post.state,
      message: { title: null, severity: 'info', body: [{ kind: 'markdown', value: post.text }], ...(post.controls.length ? { controls: post.controls } : {}) } });
  }
  return parts;
}
