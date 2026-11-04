// src/shared/network-proxy-text.mjs — the Network proxy card's status sentences, shared with the
// server so setup apply's proxy-swap row says exactly what the card says (ui/public/settings-network-proxy.mjs
// re-exports them; src/core/proxy-host.mjs uses FIXED_PORT_NOTE).
// The Local proxy port field's hint: empty means a free port picked at each start; a set one is listened on at once.
export const PORT_EMPTY_NOTE = 'Leave it empty and Worca picks a free port each time it starts. Set one only for programs outside Worca (an IDE, a shell).';
// With a local proxy already running (egress-policy.mjs listenAlso):
export const PORT_SWITCH_NOTE = 'Takes effect at once. Programs already using the old port keep it until Worca restarts.';
// Only when the running server could not switch live (no live egress): the port then waits for the next start.
export const FIXED_PORT_NOTE = 'Applies at the next start';
export const SAVED_TEXT = 'Saved. New connections use it now.';
export const PORT_PENDING_TEXT = ' The local proxy port applies at the next start.';
export const NOT_SAVED_TEXT = 'Not saved: the test did not pass. Fix the values and Save again.';
export const SAVED_OFF_TEXT = 'Saved. New connections go direct now.';
