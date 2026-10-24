---
name: ask-forms-series-traps
description: Read before changing ask-form gates or any surface showing forms (web, CLI, chat), the ask-files route or mime sniffer, or running ffmpeg on an uploaded video
paths: src/shared/forms/**, ui/public/ask/**, src/core/ask-projection.mjs, src/core/ask-files.mjs, src/core/chat/**, src/cli/render.mjs, src/core/plugin-store.mjs, src/core/plugin-manifest.mjs, src/core/agent-registry.mjs, src/core/media/**, src/core/ask/video-attachment.mjs, src/core/ask/attachment-kind.mjs, src/shared/artifact-kinds.mjs, tools/verify-ask-forms-cdp.mjs, test/*forms*.test.mjs, test/ui-ask-*.test.mjs, test/helpers/ask-form-fixture*.mjs, test/ask-files.test.mjs, test/ask-projection.test.mjs
updated: 2026-10-24T15:55:36.602Z
author: Denislav Prinov
---

Green dry runs held blocking defects only PROBING found.

## Gates
- Inherited names are valid keys and path segments: `obj[k]` hits `Object.prototype` (`props['constructor']`; a posted `"__proto__"` re-prototypes what a `when` reads). `Object.hasOwn` every lookup by a supplied name; build answers with `Object.fromEntries`. Probe `{"constructor":1,"toString":2,"__proto__":{}}` as data, answer, field name, `when` key, path segment.
- "Gate 1 admitted it" must imply "no consumer throws" (`table.columns: [null]` crashed `projectForm`). Form sweep: every layout/schema key of every node x ~17 junk values (`null`, `7`, `''`, `[]`, `{}`, `[null]`, `'constructor'`, `-1`, `1.5`…): `validateFormDef` never throws, and where it admits no consumer (`autoAnswer`, `checkAskData`, `fileRefs`, `promptFields`, `projectForm`, `coerceInput`, `parseAnswerLine`, `collectAnswer`) throws.
- The form sweep never mutates DATA: also set every location of each fixture's `example` (plus opaque rows) to ~27 junk values; where `checkAskData` admits, run every consumer, grep the projection for `undefined|[object |native code|default null|NaN`, post each junk as each answer. Row props via `own(r, k)`; only scalars become text.
- A `bad-auto` check sees only the auto state (a `when`-hidden field's bad `default` slips through): per-field invariants need a static check. Run second-order checks only when `errors.length === 0`.
- What a keyword RESOLVES to needs a "right kind" check like a `bind` (`enumFrom` rows on an optional field, `defaultFrom` on a list, a `null` source, a `when` on the wrong type).
- A tie-break fix moves the misread: check every SURFACE (projection AND CLI print `n) label`): refuse a number that is one row's position and another's id, exact label first.
- A fixed round cap is invisible to fixtures (`settle()` stopped after 6 rounds): loop to the fixpoint; probe a chain longer than any cap.
- A byte limit does not bound recursion; `JSON.stringify` recurses too (`RangeError` near 6800 on Node 22, never on 25): test each walker x shape as ONE cold call per fresh process on both Nodes. Fix: iterative `nestsDeeperThan(value, 256)` BEFORE the byte count AND in `collectAnswer` (gate 3's `clone()` threw a 500 where a 422 is owed).
- Sibling-form harness: brace-match each `const NAME = {` literal holding `example` + `layout` + `answer` in plan/fixture text (`Function('return (' + text + ')')()`), plus json blocks with `"example"`, through `validateFormDef` before AND after any gate-1 tightening.

## Web renderer (`ui/public/ask/**`)
- Run the junk sweep against the RENDERER: gate 1 admits `titleKey`/`captionKey`/`fileKey`/column `key` = `"constructor"` and `r[k]` printed `function Object() { [native code] }`. Agent-named reads go through `own(o, k)` (`dom.mjs`); answer state is null-prototype. Pinned by `test/ui-ask-form-junk.test.mjs` (keep its "admitted >= N" floors). A sync jsdom mount loop OOMs on `<details open>`: async sweeps, yield every ~50 mounts.
- `fileRefs[i] ↔ files[i]` is no contract: look up by `rel` (`ctx.fileFor`). A host seam wrapped as `Promise.resolve().then(() => host(i))` runs LATE: call it synchronously in a `try`.
- A required control whose visible state is a legal value SEEDS it at mount (a required toggle drew "off", Submit said `required`): mirror `answer.mjs` `candidate` (boolean → `false`, number → `minimum`; optional unanswered; `readonly` never seeds). Probe each new widget REQUIRED with no default.
- `tones` is a closed set `info | ok | warn | bad` (`toneOf`) as `data-tone`; never build a class from an agent word.
- Every `renderAskForm` call site passes the SAME host seams (previews without `markdown`/`highlight` showed `**bold**`): diff `grep -n 'renderAskForm(' ui/public/app.js`; pin via `window.__worcaTestHooks.askMarkdown` set before import, poll `.af-md strong`.
- After a 422 the registrant's `collect` calls `setErrors` with the local result. Workspace History test: `bootDetail` answering `/api/workspaces/<wid>/runs/<id>`, `go(win, 'history/workspaces/<wid>/<id>')`.
- The ask-files route needs a manifest (`<runDir>/ask-files/<askId>/manifest.json`, `files[].index` → `<index><ext>`, `mime` in `ASK_FILE_MIMES`): resolve via `askFilesRunDir` (`_testing`), write as `snapshotAskFiles`. Headless Chrome's PDF `<iframe>` is 0x0 while its pane is `[hidden]`: click the tab, `scrollIntoView`, measure.

## CLI, chat, mime, plugin API
- A PERSISTED form ask has no `agent` (only the wire envelope does; use the row's `agentKey`): build fixtures from the executor's call or a real run.
- `coerceInput` admits a duplicate rank (`a,a`); only `collectAnswer` refuses it. CLI e2e cues never anchor error lines with `^` (no echo over a pipe).
- Chat probe: `test/chat-inbound-e2e.test.mjs` harness + a fake `orch` (`EventEmitter` + `answer()` + `getState()`); `chatNotifier.attach(orch, {runId, entry})`, set `entry.pendingQuestion`, emit `question`. Delivery needs `capabilities:{inbound:true, outbound:true}` AND your own `notifyChatIds`. `answerRun` calls `orch.answer` BEFORE `resolvePending` (`INVALID_ANSWER` keeps the card open). Chat plugins chunk at newlines: never clip prompts.
- `sniffMime` runs binary arms BEFORE the text probe, so ASCII magic matches prose (`ID3 …`, `OggS`, `GIF89a`): require structural bytes (ID3v2 `buf[3]` in 2..4 and `buf[4] !== 0xff`; Ogg `buf[4] === 0`). `%PDF-` within 1024 bytes is PDF by design; `application/json` does not satisfy `text/*`; > 1 MiB without magic is `too-big`.
- A capability keyed on the negotiated plugin API has THREE readers: load (`agent-registry.scanLayer`, `negotiatedApi(range) >= WORCA_ASK_FORMS_API`), `validatePluginDir`, `buildInstallInventory` (consent card). Probe all over one dir across `">=3 <4"`/`">=4 <5"`/`">=3 <5"`/no engines/bad manifest; `null` fails CLOSED.

## Video uploads (ffmpeg)
- Claude Code passes only an .mp4's PATH (Read refuses binaries): store it, hand the model the path, say why; frames are an addition, never a precondition.
- `ffmpeg-static` 5.3.0 = ffmpeg 6.0, NO ffprobe: parse `ffmpeg -hide_banner -nostdin -i FILE` stderr (always exit 1). `Duration:` and `Stream #0:N…: Video:` sit at exactly 2 spaces, tags at 4+: anchor on indentation; take only numbers and `[a-z0-9_]` codecs, no tag text to a model. Rotated files show the CODED size (`displaymatrix: rotation`); JPEGs come out upright. WebM `Duration: N/A`: scan `-map 0:v:0 -c copy -f null -`, read the LAST `time=`. Count the frames that exist.
- Force the demuxer: an HLS playlist saved as `.mp4` opens as HLS even under `-protocol_whitelist file`. Sniff the container (`ftyp` / EBML DocType), pass `-f mov`/`-f matroska`, `-protocol_whitelist file` (stdin needs `fd`), `-enable_drefs 0` for mov.
- Spawn via `spawnScript` with `stdoutMode:'frame'` + `onLine: () => {}` (`'capture'` sets `windowsVerbatimArguments` on win32); env `scrubbedEnv()`. image2 reads `%` in paths as a pattern: name frames relative to the cwd. Never copy the promo kit's ffmpeg calls (no timeout, inherited env).
- `viewerKindFor` answering `'video'` for `.mov/.m4v/.mkv` bypasses `previewKindFor`'s `NO_PREVIEW_EXT` and reds `ui-artifact-viewer`: run it whenever `artifact-kinds.mjs` changes.
