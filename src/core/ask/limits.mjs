// src/core/ask/limits.mjs
// Fixed limits of the Ask Worca chat (ask-worca-design.md §6.9) plus the two
// operator-configurable per-turn guards, read fresh on every turn (D12). Pure
// apart from the settings readers, which are injectable for tests.
import { askMaxTurns as readAskMaxTurns, askMaxBudgetUsd as readAskMaxBudgetUsd } from '../settings.mjs';

export const ASK_LIMITS = Object.freeze({
  turnsPerThread: 1,                       // one running turn per thread (409)
  turnsGlobal: 3,                          // running turns across all threads (429)
  turnTimeoutMs: 30 * 60 * 1000,           // wall clock per turn (the runner has none)
  jobGraceMs: 30_000,                      // finished job kept for WS replay
  emptyThreadSweepMs: 24 * 60 * 60 * 1000, // empty threads older than this are swept at boot
  attachment: Object.freeze({
    maxFiles: 8,                           // per message
    maxBytesPerFile: 512 * 1024,
    maxBytesPerThread: 4 * 1024 * 1024,
    extensions: Object.freeze(['.md', '.markdown', '.txt', '.json', '.csv', '.log']),
  }),
  contextHeaderMaxChars: 1024,             // [worca context] block
  inlineAttachmentsMaxBytes: 24 * 1024,    // inlined into the turn prompt
  restoredMaxChars: 30_000,                // DB-replay fallback prompt
  blockIoMaxChars: 2048,                   // persisted tool input / error per block
  agentLogMaxLines: 50,
  listRunsDefaultLimit: 20,
  listRunsMaxLimit: 100,
  runsScanLimit: 200,                      // listAllPipelines({limit}) before JS filtering
  diffDefaultBytes: 60_000,
  diffMaxBytes: 200_000,
  gitOutputMaxBytes: 200_000,              // per `git` tool call (P4 §8), sliceBytes window
  gitCaptureMaxBytes: 8_000_000,           // stdout CAPTURE cap per spawn — past it the child is killed and the output marked capped
  worktreesPerThread: 5,                   // P4 D9
  worktreesGlobal: 15,                     // P4 D9
  attachmentReadDefaultBytes: 32_000,
  attachmentReadMaxBytes: 200_000,
  briefMaxChars: 8000,
  commentBodyMaxChars: 4000,               // diff_comments.body cap (pinned equal to COMMENT_BODY_MAX)
  titleMaxChars: 120,
  headerRuns: 5,
  headerCards: 5,
  headerAttachments: 5,
  deltaBatchMs: 50,
  deltaBatchChars: 256,
  defaultModel: 'claude-opus-5',           // D8
  defaultEffort: 'high',
});

/**
 * The two configurable per-turn guards. Read fresh every call — a Settings change
 * applies to the next turn without a restart.
 * @returns {{maxTurns:number, maxBudgetUsd:number|null}}
 */
export function askLimits({ readMaxTurns = readAskMaxTurns, readMaxBudgetUsd = readAskMaxBudgetUsd } = {}) {
  return { maxTurns: readMaxTurns(), maxBudgetUsd: readMaxBudgetUsd() };
}
