// src/shared/network-proxy-text.mjs — the Network proxy card's status sentences, shared with the
// server so setup apply's proxy-swap row says exactly what the card says (ui/public/settings-network-proxy.mjs
// re-exports them; src/core/proxy-host.mjs uses FIXED_PORT_NOTE).
export const FIXED_PORT_NOTE = 'Applies at the next start';
export const SAVED_TEXT = 'Saved. New connections use it now.';
export const PORT_PENDING_TEXT = ' The local proxy port applies at the next start.';
export const NOT_SAVED_TEXT = 'Not saved: the test did not pass. Fix the values and Save again.';
export const SAVED_OFF_TEXT = 'Saved. New connections go direct now.';
