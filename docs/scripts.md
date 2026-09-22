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
name, runtime and origin. **Duplicate** copies any script into your own layer;
**Delete** refuses while a saved workflow still places it.

**New script** is two steps. Step 1 picks the runtime — Node.js, Python (when the
host has an interpreter, else the card says why) or Shell. Step 2 is the
workspace, the one page a script has:

- **Identity** — the name (the key is derived from it, `Run tests` → `runTests`,
  and stays editable until the first save), a one-line description, one of
  twelve colours and one of twenty icons. The tile at the top is the card as the
  palette and the canvas show it.
- **Interface** — read from the code as you type. Every `inputs.<name>`,
  `outputs.<name>` and `params.<name>` the program mentions (`api.inputs.…` in
  Python, `$WORCA_IN_<NAME>` / `$WORCA_OUT_<NAME>` / `$WORCA_PARAM_<NAME>` in a
  shell script) becomes a row. Click a type chip to change it (`md` · `json` ·
  `void`), an input's mode (`optional` · `required` · `loop`), a param's type;
  a param's default is read from `?? 40`, `or 5` or `${VAR:-x}` and can be
  typed over. A script that returns a `verdict` (or writes `$WORCA_VERDICT`)
  can route each output `on pass` / `on fail`; a shell script routes on its
  exit code with one switch (exit 0 → `pass`, exit 1 → `fail`). A port the
  sidecar declares but the code no longer reads stays, marked `not in code`,
  until you remove it. To declare a trigger port, read it: `inputs.done`.
- **Advanced** — timeout, domain, palette order, the verdict file name, and a
  shell script's clean / blocking exit codes. All defaulted.
- **The editor** — with **Load example** (a working gate per runtime). A `shell`
  script is either a **Command** or a **File**; a file may carry a second
  `win32` variant for `cmd.exe`.
- **Test** — the bench, right under the editor, runs the unsaved draft as soon
  as the script has a name.

A saved script opens on the same workspace. Built-in and plugin scripts render it
read-only with their path; duplicate one to change it. Scripts whose ports are
declared per placed card (the built-in `shell`, `js` and `py` cards and their
duplicates) show those default ports inert, marked `ports per card`.

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

## Setting params from a wire

A card's params are normally fixed in the inspector. To let an upstream node choose them at run
time, select the card and tick **Params from a wire**. The card gains a `params` input (json).
Wire any json output into it — an agent's, or another script's.

The payload is one JSON object whose keys are the script's param ids:

```json
{ "ref": "release/2.4", "stat": true }
```

- The wire wins over the inspector; the inspector wins over the sidecar default. A key that is
  absent — or `null` — falls through.
- The script does not change. It still reads `params.ref`, `api.params.ref` or `$WORCA_PARAM_REF`.
- `command` and `code` params can never be set by a wire. They are what the card runs, with
  worca's privileges.
- An unknown key, a wrong type, or a file that is not a JSON object stops the card before anything
  runs, and the error names the key. On a mock run such a payload is ignored with a warning and
  the card's own params apply.
- For a shell script a wired string may only contain letters, digits, space and
  `_ . , : @ / \ + = ~ -`. `cmd.exe` expands `%VAR%` before it parses the line, so anything else
  could run as a command on Windows; the rule is the same on every OS.
- The card waits for the wire before its first run, like any other wired input, and a new value
  on the wire runs the card again.
- The run's `scripts/<node>-c<n>.envelope.json` lists the params a wire set under `wiredParams`.

A wired value comes from another node — often from a model. Treat it as untrusted input: the
built-in Git diff card, for one, refuses a branch name that starts with `-`.

A script that already declares an input named `params` keeps it; the toggle is not offered.

## The bench

The bench sits under the editor and runs one script by itself, through the same runner a pipeline run uses, so "passes in the bench" and "works in a run" cannot drift.

- **Folder** — in the bar under the editor: a scratch folder, or a registered project's real checkout. **Test** runs; **Stop** ends the program.
- **Params** — the same form the composer's inspector shows for a placed card.
- **Ports** — only for a *Ports per card* script: the set this run declares, edited
  the way a placed card's is. A saved case keeps its own set.
- **Inputs** — tick a port and give it text, a local file, or an artifact of a
  past run. A void port is a "fired" checkbox. An unticked port is unbound and
  absent from the envelope, exactly as in a run.
- **Test** streams the program's output live; the result shows the status, the
  exit code, the duration, which ports fired, every output it wrote, the verdict
  and the envelope it was given.

An unsaved edit runs too: the bench writes the editor's source beside the real
file and removes it afterwards. **Stop** ends the program; so does leaving the
page, because nothing else shows a bench.

## Saved cases

Name the setup in the Cases strip and **Save as case** stores it in
`<key>.tests.json`. A script that is not saved yet can be tested but not given a case.
Selecting a case loads it back — params, inputs, folder and
expectation — so **Update case** overwrites it with whatever is on screen (until
you do, **Test** on an edited case runs what is on screen, and the stored case's
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
on Windows; write the second one from the editor's `win32` tab. worca writes
the `.cmd` with CRLF line endings and the `.sh` with LF, whatever the editor held. Commands
and file names may also be declared per platform in the sidecar. Bench folders
live under `~/.worca-cc/bench/` and are swept after a day.
