// src/core/ask/limits.mjs
// Fixed limits of the Ask Worca chat (ask-worca-design.md §6.9) plus the two
// operator-configurable per-turn guards, read fresh on every turn (D12). Pure
// apart from the settings readers, which are injectable for tests.
import { askMaxTurns as readAskMaxTurns, askMaxBudgetUsd as readAskMaxBudgetUsd } from '../settings.mjs';
import { TEXT_EXTENSIONS, BINARY_EXTENSIONS } from './attachment-kind.mjs';

export const ASK_LIMITS = Object.freeze({
  turnsPerThread: 1,                       // one running turn per thread (409)
  turnsGlobal: 3,                          // running turns across all threads (429)
  turnTimeoutMs: 30 * 60 * 1000,           // wall clock per turn (the runner has none)
  jobGraceMs: 30_000,                      // finished job kept for WS replay
  emptyThreadSweepMs: 24 * 60 * 60 * 1000, // empty threads older than this are swept at boot
  attachment: Object.freeze({
    maxFiles: 8,                           // per message
    maxBytesPerFile: 512 * 1024,           // text kinds — they are inlined/paged into prompts
    maxBytesPerBinaryFile: 5 * 1024 * 1024, // image/pdf kinds — read from disk, never inlined (#398)
    maxBytesPerThread: 25 * 1024 * 1024,   // enforced ACROSS kinds (was 4 MB text-only pre-#398)
    extensions: TEXT_EXTENSIONS,           // attachment-kind.mjs owns both tables
    binaryExtensions: BINARY_EXTENSIONS,
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
  artifactsListMaxLimit: 200,
  artifactReadDefaultBytes: 60_000,
  artifactReadMaxBytes: 200_000,
  // Scripts in the chat (scripts-workbench-design.md §9.1). The store's own caps (source
  // 256 KiB, 32 cases) are NOT repeated here: script-store / script-cases own those.
  scriptListMaxRows: 200,                  // list_scripts rows (= artifactsListMaxLimit)
  scriptSourceDefaultBytes: 60_000,        // get_script page (= diffDefaultBytes)
  scriptSourceMaxBytes: 200_000,           // get_script page cap (= diffMaxBytes)
  scriptLogMaxLines: 200,                  // test_script: the LAST N streamed lines…
  scriptLogMaxBytes: 16 * 1024,            // …and their byte cap (the tail is kept: a failure ends the log)
  scriptOutputMaxBytes: 16 * 1024,         // test_script: per output port (the head is kept)
  scriptTestDefaultTimeoutSec: 120,        // test_script timeoutSec default
  scriptTestMaxTimeoutSec: 600,            // …and its ceiling (= the engine's 10-minute default)
  scriptVerdictMaxIssues: 50,              // test_script: verdict issues sent (the rest is counted, not sent)
  scriptResultFieldMaxChars: 2000,         // test_script: per verdict field / warning / diff / error line (chars)
  briefMaxChars: 8000,
  metricsRunsDefaultLimit: 20,             // list_team_metrics_runs page (= listRunsDefaultLimit)
  metricsRunsMaxLimit: 100,                // list_team_metrics_runs page cap (= listRunsMaxLimit)
  metricsBreakdownMaxRows: 20,             // get_team_metrics rows per breakdown dimension
  workflowTaskMaxChars: 32_000,            // propose_workflow task text (= classify.mjs TASK_TEXT_CAP)
  workflowNoteMaxChars: 200,               // propose_workflow note shown on the card
  proposalNoteMaxChars: 200,               // propose_run note ("why this shape") shown on the run card
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
