// src/shared/proxy-timeouts.mjs — the corporate proxy's default timeouts, one copy for the server
// (src/core/upstream-proxy.mjs clamps a saved networkProxy.timeouts against them) and the setup assistant
// (ui/public/setup-assistant.mjs shows them filled in and saves only a value that differs).
export const UPSTREAM_TIMEOUTS = Object.freeze({ connectMs: 60_000, authMs: 60_000, idleMs: 300_000 });
