// src/core/engines/session-dispatch.mjs — NEW. Task 27 writes only this part; Task 31 appends the rest below it.
// The session host's dispatch contract (session groups, spec §5). A main agent that did not dispatch as told raises
// SessionHostError; its stamped errorClass is what classifyError returns (recoverable-error.mjs:27: a stamp is authoritative).

/** Watchdog codes (C1, C11, C20, Task 41). Every one classifies as `session_host`. */
export const SESSION_HOST_CODES = Object.freeze(['SESSION_HOST_NO_DISPATCH', 'SESSION_HOST_MULTI_DISPATCH', 'SESSION_HOST_STRAY_TOOL',
  'SESSION_HOST_VANISHED', 'SESSION_HOST_CAP', 'SESSION_HOST_BUDGET']);

export class SessionHostError extends Error {
  /** @param {string} code one of SESSION_HOST_CODES  @param {string} message  @param {object} [detail] ids, names and counts only */
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'SessionHostError';
    this.code = code;
    this.detail = detail;
    this.errorClass = 'session_host';   // C1: the failure-policy row `session_host`, whatever the message says
  }
}

export const isSessionHostError = (e) => e instanceof SessionHostError;
