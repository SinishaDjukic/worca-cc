// ui/public/ask-model.mjs — DOM-free thread model + ask-* frame reducer for the
// Ask Worca panel (spec §10.1). One instance per open thread; the panel swaps
// instances on thread switch. Everything lives in the factory closure — the
// module is evaluated once per test file even though app.js is re-imported with
// a cache-buster, so module scope must stay empty of state.
//
// Frame classes (spec §6.6 / the P2→P3 contract): job frames carry
// {threadId, messageId, seq} and are deduped by the per-job monotonic seq;
// out-of-turn frames (ask-message / ask-title / ask-run-status) upsert by their
// own key. A seq gap is REPORTED ({gap:true}), never healed here — the panel
// re-fetches the thread over REST and resubscribes (spec §10.8).

const TERMINAL = new Set(['done', 'stopped', 'error']);

export function createThreadModel({ threadId }) {
  let thread = { id: threadId, title: null, model: null, effort: null, totals: {}, updatedAt: null };
  let rows = [];
  let attachments = [];
  const links = new Map();
  let live = null;
  let inFlight = null;
  let dirty = newDirty();

  function newDirty() {
    // runLinks dirt is produced but not yet consumed — no v1 UI renders run links directly; the follower notices carry the visible state.
    return { structure: false, messages: new Set(), blocks: new Map(), answer: new Set(), label: false, meters: false, title: false, runLinks: false };
  }

  function rowById(id) {
    for (const r of rows) if (r && r.id === id) return r;
    return null;
  }

  function upsertRow(message) {
    const i = rows.findIndex((r) => r && r.id === message.id);
    if (i >= 0) {
      rows[i] = message;
    } else {
      const seq = typeof message.seq === 'number' ? message.seq : Infinity;
      const at = rows.findIndex((r) => (typeof r.seq === 'number' ? r.seq : Infinity) > seq);
      if (at === -1) rows.push(message);
      else rows.splice(at, 0, message);
    }
    dirty.structure = true;
  }

  function markBlockDirty(messageId, blockId) {
    if (!dirty.blocks.has(messageId)) dirty.blocks.set(messageId, new Set());
    dirty.blocks.get(messageId).add(blockId);
  }

  function ensureStreamingRow(messageId, base = {}) {
    let row = rowById(messageId);
    if (!row) {
      row = {
        id: messageId, threadId, seq: undefined, role: 'assistant', text: '', blocks: [],
        status: 'streaming', reason: null, model: base.model ?? null, effort: base.effort ?? null,
        usage: null, costUsd: null, durationMs: null, createdAt: base.startedAt ?? null,
      };
      upsertRow(row);
    }
    if (!Array.isArray(row.blocks)) row.blocks = [];
    return row;
  }

  function upsertBlock(row, block) {
    const i = row.blocks.findIndex((b) => b && b.id === block.id);
    if (i >= 0) row.blocks[i] = block;
    else row.blocks.push(block);
  }

  function finalizeDone(row, frame) {
    row.text = frame.text ?? '';
    row.blocks = Array.isArray(frame.blocks) ? frame.blocks : row.blocks;
    row.usage = frame.usage ?? null;
    row.costUsd = frame.costUsd ?? null;
    row.durationMs = frame.durationMs ?? null;
    row.status = frame.status || 'done';
    row.reason = frame.reason ?? null;
    row.model = frame.model ?? row.model;
    if (frame.threadTotals) { thread.totals = frame.threadTotals; }
    live = null;
    inFlight = null;
    dirty.structure = true;
    dirty.messages.add(row.id);
    dirty.answer.add(row.id);
    dirty.meters = true;
    dirty.label = true;
  }

  function applyJobFrame(frame) {
    const existing = rowById(frame.messageId);
    if (existing && TERMINAL.has(existing.status)) return { dropped: 'terminal-message' };
    if (live && frame.messageId === live.messageId) {
      if (frame.seq <= live.lastSeq) return { dropped: 'stale-seq' };
      if (frame.seq > live.lastSeq + 1) return { gap: true };
      live.lastSeq = frame.seq;
    } else if (frame.type === 'ask-start') {
      ensureStreamingRow(frame.messageId, frame);
      live = { messageId: frame.messageId, userMessageId: frame.userMessageId ?? null, label: 'Thinking', startedAt: frame.startedAt ?? null, lastSeq: frame.seq, text: '', usage: null, costUsd: null };
      inFlight = { messageId: frame.messageId };
      dirty.label = true;
    } else if (!live && inFlight && frame.messageId === inFlight.messageId) {
      // Adoption: the ring buffer may have evicted the prefix — accept the first
      // frame at whatever seq it carries; ask-done.text heals the missing text.
      ensureStreamingRow(frame.messageId);
      live = { messageId: frame.messageId, userMessageId: null, label: null, startedAt: null, lastSeq: frame.seq, text: '', usage: null, costUsd: null };
    } else {
      return { dropped: 'no-live' };
    }

    const row = ensureStreamingRow(frame.messageId, frame);
    switch (frame.type) {
      case 'ask-start':
        row.model = frame.model ?? row.model;
        row.effort = frame.effort ?? row.effort;
        break;
      case 'ask-label':
        live.label = frame.label;
        dirty.label = true;
        break;
      case 'ask-delta':
        live.text += String(frame.text ?? '');
        dirty.answer.add(frame.messageId);
        break;
      case 'ask-block':
      case 'ask-card':
        if (frame.block && frame.block.id != null) {
          upsertBlock(row, frame.block);
          markBlockDirty(frame.messageId, frame.block.id);
        }
        break;
      case 'ask-usage':
        live.usage = frame.usage ?? null;
        live.costUsd = frame.costUsd ?? null;
        dirty.meters = true;
        break;
      case 'ask-done':
        finalizeDone(row, frame);
        break;
      case 'ask-error':
        row.text = live.text;
        row.status = 'error';
        row.errorMessage = frame.message || 'unknown error';
        live = null;
        inFlight = null;
        dirty.structure = true;
        dirty.messages.add(row.id);
        dirty.answer.add(row.id);
        dirty.label = true;
        dirty.meters = true;
        break;
      default:
        break; // unknown ask-* job frame: its seq is consumed, its payload ignored
    }
    return { ok: true };
  }

  function applyOutOfTurn(frame) {
    switch (frame.type) {
      case 'ask-title':
        thread.title = frame.title ?? null;
        dirty.title = true;
        return { ok: true };
      case 'ask-message': {
        const m = frame.message;
        if (!m || typeof m.id !== 'string') return { dropped: 'no-live' };
        upsertRow(m);
        dirty.messages.add(m.id);
        return { ok: true };
      }
      case 'ask-run-status': {
        if (typeof frame.runId !== 'string') return { dropped: 'no-live' };
        const cur = links.get(frame.runId) || { pipelineId: null, cardId: null, status: null, phase: null };
        links.set(frame.runId, {
          pipelineId: frame.pipelineId ?? cur.pipelineId,
          cardId: frame.cardId ?? cur.cardId,
          status: frame.status ?? cur.status,
          phase: frame.phase ?? cur.phase,
        });
        dirty.runLinks = true;
        return { ok: true };
      }
      default:
        return { dropped: 'no-live' };
    }
  }

  return Object.freeze({
    threadId,
    load(snapshot) {
      thread = { ...snapshot.thread };
      rows = Array.isArray(snapshot.messages) ? snapshot.messages.slice() : [];
      attachments = Array.isArray(snapshot.attachments) ? snapshot.attachments.slice() : [];
      links.clear();
      for (const l of Array.isArray(snapshot.runLinks) ? snapshot.runLinks : []) {
        links.set(l.runId, { pipelineId: l.pipelineId ?? null, cardId: l.cardId ?? null, status: l.status ?? null, phase: l.phase ?? null });
      }
      live = null;
      inFlight = snapshot.inFlight ?? null;
      dirty = newDirty();
      dirty.structure = true;
      dirty.title = true;
      dirty.meters = true;
      dirty.runLinks = true;
      dirty.label = true;
    },
    apply(frame) {
      if (!frame || frame.threadId !== threadId) return { dropped: 'other-thread' };
      if (typeof frame.seq === 'number') return applyJobFrame(frame);
      return applyOutOfTurn(frame);
    },
    takeDirty() {
      const d = dirty;
      dirty = newDirty();
      return d;
    },
    messages() { return rows; },
    thread() { return thread; },
    totals() {
      return { ...thread.totals, live: live ? { usage: live.usage, costUsd: live.costUsd } : null };
    },
    inFlight() { return inFlight; },
    live() { return live; },
    runLinks() { return links; },
    attachmentsBytes() { return attachments.reduce((n, a) => n + (a && Number.isFinite(a.bytes) ? a.bytes : 0), 0); },
    findCard(cardId) {
      for (const r of rows) {
        const b = (r && Array.isArray(r.blocks) ? r.blocks : []).find((x) => x && x.kind === 'card' && x.id === cardId);
        if (b) return { message: r, block: b };
      }
      return null;
    },
    noteLocalUserMessage({ id, text, attachments: atts }) {
      upsertRow({
        id, threadId, seq: undefined, role: 'user', text: String(text ?? ''),
        blocks: (Array.isArray(atts) ? atts : []).map((a) => ({ kind: 'attachment', id: a.id ?? null, name: a.name, bytes: a.bytes })),
        status: null, reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: null,
      });
      dirty.messages.add(id);
    },
  });
}
