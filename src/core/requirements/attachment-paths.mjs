// src/core/requirements/attachment-paths.mjs
// Where a feature file's or a brief document's body lives (plans/requirements-a8-design.md D9): one folder under the Worca home,
// one body per store-minted id, named by the id and the kind's extension (a generic binary keeps its name's sanitised extension, never the name itself). attachment-job.mjs (reads,
// replaces, the run hand-off) and attachment-fetch.mjs (a downloaded tracker file, A6.1 D9) both write there.
import { join } from 'node:path';
import { worcaHome } from '../projects.mjs';
import { extensionForAttachment } from '../ask/attachment-kind.mjs';
import { REQ_ATT_ID_RE } from './attachments.mjs';

export const attachmentsDir = () => join(worcaHome(), 'requirements', 'att');

/** A body's path, from the store-minted id and the kind's extension only; a generic binary adds its name's sanitised extension. */
export function attachmentFile(row) {
  if (!row || typeof row.id !== 'string' || !REQ_ATT_ID_RE.test(row.id)) throw new Error('attachmentFile: refusing an id the store never minted');
  return join(attachmentsDir(), `${row.id}${extensionForAttachment(row.kind, row.mime, row.name)}`);
}
