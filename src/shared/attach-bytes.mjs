// src/shared/attach-bytes.mjs — a chat message's attachment cap and base64, for Stillhet's live chat (COV-3 #6: a proposal's
// files ride Start as extras). Stillhet may not import ui/public/attach-files.mjs (test/stillhet-import-guard.test.mjs), so
// these two live here; classic keeps its own, and test/stillhet-chat-live.test.mjs pins both to the same values.

/** Bytes per message, across files: src/core/ask/limits.mjs maxBytesPerMessage. */
export const ATTACH_MAX_MESSAGE_BYTES = 100 * 1024 * 1024;

/** Bytes (a Uint8Array view) → base64, 32 KB at a time (String.fromCharCode.apply caps its argument count). */
export function bytesToBase64(bytes, btoa = globalThis.btoa) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
