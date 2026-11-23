// ui/routes/chat/feature-run-card.mjs — feature "chat" (docs/chat.md): POST /api/ask/threads/:threadId/feature-runs posts a
// tracked run card, titled with its feature, into a chat thread for a run that started from that feature (offerShipCard's way).
import { appendMessage as askAppendMessage, getThread as askGetThread, linkRun as askLinkRun, listRunLinks as askListRunLinks, newAskId } from '../../../src/core/ask/store.mjs';
import { requireFlag } from '../../../src/core/flags.mjs';
import { getFeature, startByRunId } from '../../../src/core/requirements/store.mjs';
import { askIdParam, askThreadVisible, attachAskFollower, badRequest, broadcast, liveRunEntry } from '../../server.mjs';

/** The card a feature's run shows in chat: track_run's progress card plus the `feature` the client titles it with. */
function featureRunCard(feature, start, entry) {
  const workspace = feature.scopeType === 'workspace';
  const label = feature.scopeKey;
  return {
    type: 'progress', runId: start.runId, pipelineId: (entry && entry.pipelineId) || start.pipelineId || null,
    ...(workspace ? { workspaceId: feature.scopeKey } : { projectKey: feature.scopeKey }),
    title: feature.title, label, status: (entry && entry.status) || null,
    feature: { seq: feature.seq, id: feature.id, title: feature.title },
  };
}

export function register(app) {

app.post('/api/ask/threads/:threadId/feature-runs', requireFlag('requirements'), (req, res) => {
  const threadId = askIdParam(res, req.params.threadId, 'thread');
  if (!threadId) return;
  const { seq, runId } = req.body || {};
  if (!Number.isInteger(seq) || seq < 1) return badRequest(res, 'seq must be a positive integer');
  if (typeof runId !== 'string' || !runId) return badRequest(res, 'runId is required');
  try {
    const thread = askGetThread(threadId);
    if (!thread || !askThreadVisible(thread, req)) return res.status(404).json({ error: 'thread not found' });
    const start = startByRunId(runId);
    const feature = start && start.featureSeq === seq ? getFeature(seq) : null;
    if (!start || !feature) return res.status(404).json({ error: 'run not found for that feature' });
    const existing = askListRunLinks(threadId).find((l) => l.runId === runId);
    if (existing) return res.status(200).json({ cardId: existing.cardId });
    const entry = liveRunEntry(runId);
    const cardId = newAskId('card');
    askLinkRun(threadId, { runId, cardId, pipelineId: (entry && entry.pipelineId) || start.pipelineId || null, status: (entry && entry.status) || null });
    const message = askAppendMessage(threadId, { role: 'assistant', text: '', status: 'done',
      blocks: [{ kind: 'card', id: cardId, state: 'tracked', card: featureRunCard(feature, start, entry) }] });
    broadcast({ type: 'ask-message', threadId, message });
    if (entry && entry.orch) attachAskFollower(entry.orch, { threadId, runId, cardId });
    return res.status(201).json({ cardId });
  } catch (err) {
    console.error(`[worca-ui] feature run card failed: ${err && err.message ? err.message : err}`);
    return res.status(500).json({ error: 'could not post the run card' });
  }
});

}
