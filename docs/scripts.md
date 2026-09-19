# Scripts

A **script card** is a workflow card that runs your own program instead of an
agent. Same typed ports, same verdict routing, same run monitor — no model call,
no cost, and a deterministic result.

A script runs with worca's privileges and is not sandboxed, exactly like a
plugin connector or an agent's Bash tool.

## Where scripts live

| layer | folder | writable |
|---|---|---|
| built-in | `scripts/` in the worca package | no |
| yours | `~/.worca-cc/scripts/` | yes |
| plugin | `<plugin>/current/scripts/` | no |

A script is a `<key>.meta.json` sidecar plus the file it names, and optionally a
`<key>.tests.json` of saved test cases. Keys are unique across scripts **and**
agents.

## The Scripts page

`Scripts` in the rail (interface mode **Expert**). The list shows every registered
script with its origin, runtime, ports and saved cases; a filter matches key,
name, runtime and origin.
**New script** opens an empty one; **Duplicate** copies any script into your own
layer; **Delete** refuses while a saved workflow still places it.

A script's page has three tabs:

- **Overview** — display name, key, description, runtime, domain, colour, icon,
  order, timeout, shell exit codes, the params it exposes to each placed card,
  and its ports (or *Ports per card* for a script whose ports are declared per
  placed card).
- **Source** — the program, in an editor with syntax highlighting. A `shell`
  script is either a **Command** or a **File**; a file may carry a second
  `win32` variant for `cmd.exe`.
- **Test** — the bench.

Built-in and plugin scripts render read-only with their path; duplicate one to
change it.

## The runtimes

`node` is the default and needs nothing beyond worca's own Node. `shell` runs
`/bin/sh -c` (POSIX) or `cmd.exe /d /s /c` (Windows). `python` is not available
yet: the runtime picker shows it disabled.

```js
// node — <key>.mjs
export default async function ({ inputs, outputs, params, ctx, log }) {
  log('info', 'inputs and outputs are absolute paths');
  return { outputs: { report: { value: '# done\n' } }, summary: 'ok' };
}
```

```sh
# shell — <key>.sh. Every port and param is an environment variable.
echo "# done" > "$WORCA_OUT_REPORT"
```

A `node` script returns `{ outputs?, verdict?, summary? }`; anything
it prints goes to the run log. A `shell` script's exit code decides: `0` is
clean, `1` is blocking, anything else is an execution error — overridable per
script with `exitCodes`.

Every declared output that is not `void` must exist when the script ends —
written to its path or returned as a `value` — whichever way the verdict goes;
a `node` script that skips one fails with `output "<port>" was not written`. A
`shell` script's unwritten md outputs receive its captured report. Two ports may
share one filename, which is how the built-in `shell` feeds both `log` and `fail`.

## The bench

The **Test** tab runs one script by itself, through the same runner a pipeline
run uses, so "passes in the bench" and "works in a run" cannot drift.

- **Folder** — a scratch folder, or a registered project's real checkout.
- **Params** — the same form the composer's inspector shows for a placed card.
- **Ports** — only for a *Ports per card* script: the set this run declares, edited
  the way a placed card's is. A saved case keeps its own set.
- **Inputs** — tick a port and give it text, a local file, or an artifact of a
  past run. A void port is a "fired" checkbox. An unticked port is unbound and
  absent from the envelope, exactly as in a run.
- **Run** streams the program's output live; the result shows the status, the
  exit code, the duration, which ports fired, every output it wrote, the verdict
  and the envelope it was given.

An unsaved edit runs too: the bench writes the editor's source beside the real
file and removes it afterwards. **Stop** ends the program; so does leaving the
Test tab, because nothing outside it shows a bench.

## Saved cases

Name the setup in the Cases column and **Save as case** stores it in
`<key>.tests.json`. Selecting a case loads it back — params, inputs, folder and
expectation — so **Update case** overwrites it with whatever is on screen (until
you do, **Run** on an edited case runs what is on screen, and the stored case's
dot is left alone);
**Rename** and **Delete** sit on the row itself. A script keeps up to 32 cases.

The **Expect** row turns a case into a check. Pick the verdict it should reach
(`clean`, `blocking` or `error`), tick the output ports that must fire and, if
it matters, a substring the summary has to contain; **Use result** fills the
verdict and the fired ports from the run you just watched. Leave the verdict on `—` and the case
simply reports what happened and is never red.

A case carries its params, its inputs (inline, up to 256 KiB per port), its
folder choice and that optional expectation:

```json
{ "version": 1,
  "cases": [
    { "id": "c_failing", "name": "failing suite",
      "params": { "command": "npm test" },
      "inputs": { "plan": { "text": "# Plan\n" }, "done": { "fired": true } },
      "cwd": { "kind": "scratch" },
      "expect": { "verdict": "blocking", "fired": ["log", "fail"] } } ] }
```

**Run all** runs every case in order and reports how many passed, failed and ran
without an expectation. Results live for the session only — nothing is written
to the run history. Cases you save for a built-in or plugin script are yours:
they live in `~/.worca-cc/scripts/<key>.tests.json` and never touch the shipped
file, which stays marked `shipped` and offers no Rename or Delete.

## All three operating systems

A `shell` script with a file runs `<key>.sh` on macOS and Linux and `<key>.cmd`
on Windows; write the second one from the Source tab's `win32` view. worca writes
the `.cmd` with CRLF line endings and the `.sh` with LF, whatever the editor held. Commands
and file names may also be declared per platform in the sidecar. Bench folders
live under `~/.worca-cc/bench/` and are swept after a day.
