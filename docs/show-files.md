# Files in the chat

Chat can put files into its reply as a **files card**. Images show inline as tiles. Any other file is a row
with its kind and size. Every file has two icon buttons, the same as a run's artifacts: **Download**, and **Show in
folder** (labelled with the app, for example *Show in Finder*). A tile shows them when you point at it. A click on a
tile or a row opens the viewer: ←/→ steps through the card's files, an image zooms on click, and the viewer has
**Full screen** and **Download**.

## When Ask shows files

Ask calls the `show_files` tool when it makes or finds a file you should see: a screenshot, a chart, a generated
report, a run artifact. The usual case is a screenshot in agent mode:

1. Ask runs a command with `run_command` that saves a screenshot in `$WORCA_ASK_OUT`, this chat's output folder,
   for example `npx playwright screenshot http://localhost:3000 "$WORCA_ASK_OUT/home.png"`.
2. Ask calls `show_files` with the path `"$WORCA_ASK_OUT/home.png"`, and the image is in the reply.

`$WORCA_ASK_OUT` exists only where `run_command` does: in agent mode. Relay mode and agent isolation have no
`run_command`, so they have no output folder either. `show_files` itself works in every chat that has a thread.

Each file is **copied** into the chat when it is shown. The card keeps working after the original file changes or
is deleted, and it comes back when you reopen the chat.

## Where files may come from

`show_files` takes three kinds of source:

- **`files`**: a path on disk.
  - `$WORCA_ASK_OUT/<name>` names this chat's output folder, and nothing else.
  - Any other path (absolute or relative) must land in one of these folders: the output folder, this chat's
    worktrees, the pinned project, the folders of a run named by `runId` (its store folder and its live worktree or
    checkout), or the folder of a project named by `projectKey`. A relative path with no `runId` or `projectKey` is
    looked up in the output folder, then the chat's worktrees, then the pinned project.
- **`runArtifacts`**: `{ runId, relPath }`, as `list_run_artifacts` names them. The file must stay inside the run
  folder it was found in.
- **`attachmentIds`**: ids of this chat's own attachments. These are shown without a new copy.

Always refused:

- anything outside those folders, after symlinks are resolved. A symlink in the output folder that points outside is
  refused.
- the system temp folder, network (UNC) paths, and paths with a `..` segment.
- credential files by name (`.env*`, `*.pem`, `*.key`, `id_*`, `.netrc`, `.npmrc`, `*.tfstate*`,
  `*.p12`, `*.kdbx`, `credentials.json`, worca's own database, and the rest of the secure guardrail set's protected
  paths) and anything inside `.ssh/`, `.aws/`, `.gnupg/`, `.kube/`, `.docker/`, `.azure/`, `.git/`, `.worca-cc/`,
  `.config/gh/` or `.config/gcloud/` below the folder the file was found in. Side effect: a Keynote `.key` file and
  `id_rsa.pub` are refused too.
- folders, empty files, and files over their kind's size cap.

When some files pass and some do not, the passing files are shown and the card ends with a short "Not shown" note
naming each refused file and why. When nothing passes, there is no card, and Ask gets the reasons.

## Kinds and how each is shown

The kind comes from the file's bytes (magic numbers), not from its name. A name only refines a text body into
markdown, a table or HTML.

| Kind | Types | Shown as | Size cap |
| --- | --- | --- | --- |
| Image | PNG, JPEG, GIF, WebP, AVIF | an inline tile; the viewer zooms | 25 MiB |
| SVG | SVG | an inline tile, drawn only through `<img>`: its scripts never run | 1 MiB |
| PDF | PDF | a row; the viewer's PDF view | 50 MiB |
| Video | MP4, WebM | a row; the viewer's player | 100 MiB |
| Audio | MP3, WAV, Ogg | a row; the viewer's player | 50 MiB |
| Markdown | text named `.md` / `.markdown` | a row; rendered Markdown | 1 MiB |
| Table | text named `.csv` / `.tsv` | a row; a table | 1 MiB |
| HTML | text named `.html` / `.htm` | a row; highlighted **source**, never a rendered page | 1 MiB |
| JSON | a JSON body | a row; highlighted JSON | 1 MiB |
| Diff | a unified diff body | a row; a diff view | 1 MiB |
| Text | any other clean UTF-8 text | a row; plain text, or highlighted code when the name has a known language | 1 MiB |

Any other type is refused. A card item of a kind the browser does not know shows as a download row, and the viewer
offers **Download** only.

When an SVG copy is opened in its own tab, it is served with `Content-Security-Policy: sandbox; default-src 'none'`.
An HTML copy is stored as text and served as `text/plain` with `nosniff`.

## Show in folder

**Show in folder** opens the file manager on the folder the file was shown from, with the file selected (Finder and
Explorer select it; a Linux file manager opens the folder). It opens the **original** file, not worca's copy: for a
screenshot that is `$WORCA_ASK_OUT`, for a project file the project folder, for a run artifact the run's folder.

- The original path stays on the server (`ask_attachments.source_path`). The card only knows that the file has one.
- A file found under a run's checkout or a project's folder also keeps where it came from: the run, the project (for
  a workspace run, the member's project) and its path below that folder (`source_run_id`, `source_project_key`,
  `source_rel`, server-only too).
- A run's worktree is removed or cleaned once the run ends. When the original is gone, the button opens the same
  relative path inside the project's registered folder, if that file is there. That path is realpath'd and must stay
  inside the project folder (case-insensitive on Windows and macOS); a `..` or a symlink out of it opens nothing.
- If neither is there, the button says so and opens nothing: "The run's folder was cleaned up after the run" for a
  run's file, "it was moved or deleted after it was shown" otherwise (and for copies shown before this was recorded).
  The copy in the chat still opens and downloads.
- Files you uploaded, and attachments Ask showed by id, have no original folder, so they have no button.
- The folder opens on the machine worca runs on. The button is never shown on a hosted worca, to a caller that may
  be an agent, or where no file manager was found (a container, a Linux machine with no display).

## Limits and redaction

- At most 12 files per card.
- At most 100 MiB of new copies per card.
- At most 500 MiB per chat. This counts **all** of the chat's attachments, your uploads included. It only stops
  `show_files`; your uploads are never blocked by it.
- The per-kind caps in the table above.

Every text kind is redacted when it is copied, with the same patterns as the rest of Chat. This is best effort:
redaction is pattern-based, and binary files (images, PDFs, media) cannot be redacted, so they are shown as they
are. SVG is shown as an image and is not redacted.

## Who sees the files

The copies are kept with the chat. Whoever can open the chat can open its files: with a shared sign-in, only the
chat's owner (a chat with no owner is visible to everyone). The copies are not uploads: they are not offered in the
run card's `@` picker, and they do not take a slot in the earlier-attachments line Ask reads. Deleting the chat
deletes them.

## Adding a file type

For contributors, a new type is two entries:

1. One entry in `SHOW_FILE_KINDS` (`src/core/ask/show-files.mjs`): the sniffed mimes (and, for a text body, the
   extensions), the kind, how it is stored and its size cap.
2. One `registerFileRenderer(kind, { preview, label, thumb? })` call (`ui/public/chat/files-card.mjs`): which viewer
   preview opens it, and optionally how to draw its inline tile. `preview` must be one of the viewer's preview kinds;
   `html` is not one, so no renderer can frame a file the chat shows.

There is no plugin hook for file kinds yet. Worca plugins ship no browser code, and the plugin manifest has no UI
key. A later version may add a data-only `fileKinds` manifest block that maps extra sniff rules to an existing
renderer, for example a `.ipynb` file shown as JSON. A renderer with its own drawing code would first need a render
seam in the viewer and a separate decision on letting plugin code run in the page.
