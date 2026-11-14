// src/shared/claude-sign-in.mjs
// Copy shared by the server's setup check (src/core/setup/detect.mjs) and the browser's onboarding dialogs
// (ui/public/setup-assistant.mjs, the Connect Claude Code dialog in app.js).

/** Signed out: the config folder `claude auth status` read. A server started with another HOME or
 *  CLAUDE_CONFIG_DIR reads another sign-in than the person's terminal, so /login there cannot help. */
export const claudeCheckedWhere = (dir) =>
  `Worca checked ${dir}. If your terminal is signed in, Worca may be running with a different HOME or CLAUDE_CONFIG_DIR.`;
