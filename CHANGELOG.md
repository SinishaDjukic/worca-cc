# Changelog

## Unreleased

### Corporate proxy (experimental, flag `corporateProxy`)

- With the flag on, Worca's local proxy logs in to a corporate proxy (NTLMv2, or Basic when `networkProxy.auth` is `basic`; from `settings.json` `networkProxy.upstream` or an existing `HTTP(S)_PROXY`) and every child (agents, git, MCP servers, plugins, chat channels) and Worca's own fetch go through `http://127.0.0.1:<port>`, a URL without credentials, so plugins get it too. After one rejected login Worca stops sending credentials and answers 407 "proxy needs login", so the account is not locked. A hosting platform's outbound network policy now forwards to that proxy instead of replacing it.
- Log in once: `worca proxy login` or Settings › Network proxy saves the domain, user and NT hash (never the password) in a file only you can read (0600; owner-only ACL on Windows), and every boot uses it.
- `worca proxy status|test|logout`; the Test button and `worca proxy test` check github.com and api.anthropic.com.
- A rejected login is remembered across restarts, and a new login clears "proxy needs login" without a restart.
- Boot line `Corporate proxy: via host:port (NTLMv2)`.
- Kept-alive logins, Negotiate, Digest and a fixed port: plain-HTTP requests reuse one NTLM-logged-in connection until it idles out (`networkProxy.timeouts.idleMs`); a proxy that offers only `Negotiate` gets NTLMv2 inside it; `networkProxy.auth: "digest"` answers RFC 7616 Digest with the password from `HTTPS_PROXY`; `networkProxy.fixedPort` (or Local proxy port on the card) pins the local proxy to `127.0.0.1:<port>`, shown by `worca proxy status`; Playwright and Chrome launches in runs get the local proxy explicitly.

### Projects: New never overrides; Remove deletes worca's own folders

- New by name names what blocks it: a registered project by its stored name, a folder by its path ("<path> is already registered as "<name>""), in the dialog, over the API and on Ask cards; a refusal from Create itself keeps Create off until the name changes.
- Remove project on a Folder project whose folder worca made in its projects folder (`<worcaHome>/projects`) now deletes that folder too, after a red confirm naming it (`DELETE /api/projects?…&deleteFolder=1`; without it such a removal answers 409). Git projects, folders added from elsewhere, custom projects roots and symlinks are only unregistered, as before. Removal is refused (409) while a run of the project is running or paused.

### Implement Run Presets Feature

- Save, pick and manage run presets in New run: The web UI review's blocking findings are fixed with tests: Agents-row edits in preset mode now store concrete booleans (presetNodePick), so Start, Update preset and Save as new no longer get a 400; the hidden-settings note counts only model picks (4 agent picks); preset menu and Settings labels load workspaces and repaint after projects load.
- Save a finished run's setup as a preset, and start from the Chat home: Cycle 2 fixes the web UI review's one major issue: a Chat home chip and Settings › Presets Use now both go through usePresetOnNewRun, which awaits applyPreset and focuses the empty prompt, and each path has a test.
- Presets in schedules, the CLI and Ask Worca: The diff matches plan v5: v62 preset_id columns; the preset is read at fire time as its stored owner; worca run goes only through the probed server; Ask propose_run takes presetId through the shared validator and refuses a Permissive preset; the flag moves to beta.
