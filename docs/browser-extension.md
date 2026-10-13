# Browser extension

The Worca browser extension puts Ask Worca in a sidebar next to the page you are reading, in
Chrome, Edge and Firefox. It talks only to the Worca running on your own computer, and only after
you approve it in Worca.

The extension is not part of the `@worca/app` npm package. You build it from this repository and
load it into your browser yourself (see [Install](#install)).

## What it does

- **Sidebar chat.** The same Ask Worca conversation as the Chat page: pick a thread, ask, and watch
  the answer stream in. A card in an answer shows its title and **Open in Worca**, which opens the
  thread in the full UI, where you act on it.
- **Page context.** Every message tells Ask which page you are on: its URL, its title and the text
  you have selected. You can also send the readable text of the whole page, one message at a time.
- **Pinpoint on web pages.** Select text on the page and the Pinpoint toolbar appears, as it does in
  Worca's own chat, artifacts and diffs: **Explain** answers in a popover, and **Send to chat**,
  **Use this**, **Discuss** and **Go deeper** hand the passage to the sidebar.
- **Context menu.** Right-click a selection → **Ask Worca about selection** opens the sidebar with
  the selection quoted.

## Install

Build the three browser targets first:

```bash
npm run ext:build          # extension/dist/chrome, extension/dist/edge, extension/dist/firefox
npm run ext:zip            # the same, plus one zip per browser in extension/dist/
```

- **Chrome / Edge** (116 or later): open `chrome://extensions` (or `edge://extensions`), turn on
  **Developer mode**, click **Load unpacked** and pick `extension/dist/chrome` (or
  `extension/dist/edge`).
- **Firefox** (140 or later): open `about:debugging` → **This Firefox** → **Load Temporary
  Add-on…** and pick `extension/dist/firefox/manifest.json`. Firefox removes a temporary add-on
  when it quits, so load it again after a restart.
- **The zips** in `extension/dist/` are for a manual upload to a browser's extension store. Nothing
  here publishes them.

## Pairing

The extension has no access to Worca until you pair it. Pairing gives it its own token, which works
only on the few routes the sidebar needs.

1. Start Worca (`worca ui`, or `npx @worca/app`).
2. Open the sidebar: click the Worca button in the browser toolbar. It says **Connect to Worca**.
3. Click **Connect**. The sidebar shows **Approve in Worca** and a six-digit code.
4. Every open Worca tab shows **Connect a browser extension?** with the extension's name, its
   browser, its extension id and a code.
5. **Check that the two codes match**, then click **Approve**. If they differ, or you did not just
   click Connect, click **Cancel**. Cancel is the default: Esc and Enter both land on it.
6. The sidebar switches to the chat.

A request expires after 2 minutes. While it is waiting, the sidebar keeps polling for the answer;
if nobody answers it says **The pairing request expired**, and if you click Cancel it says
**Pairing was declined**. Either way you can ask again.

**Under agent isolation** (`WORCA_AGENT_USER` set), approve through Worca's published address, not
from a loopback browser on the same machine. On loopback, a person and an agent running as the
same user look the same to Worca, so the approval is refused with `extension-agent-blocked`, exactly
as Terminal is.

## What goes with a message

The line above the composer, **Sends with your message: …**, always lists what the next message
carries. Each item travels as a text attachment, shown as a pill on the sent message:

| Attachment | When | What is in it | Cap |
|---|---|---|---|
| `page-context.md` | always, once the sidebar can read the tab | the page URL, its title and your selection | title 300 characters, selection 4,000 |
| `page-text.md` | only when you switch the **Page text** chip on | the readable text of the page (no scripts, styles or navigation) | 200,000 characters |
| `page-quote.md` | when you quoted a passage (Pinpoint or the context menu) | the passage and the page it came from | 4,000 characters |

The **Page text** chip turns itself off after each message, so the page text is opt-in per message.
On a page the extension cannot read (a browser page, a store page, or a tab it has no access to
yet), the line says so and nothing about the page is sent.

**Why the quote is not in the message text.** Your message text is only what you typed. Everything
that came from the page, the quote included, is an attachment, because page text can contain
instructions written to manipulate an AI ("ignore your rules and…"). Worca adds a line to the
model's context that names `page-context.md`, `page-text.md` and `page-quote.md` as untrusted data
from a web page, never as instructions. If the quote were pasted into the message, the model could
not tell your words from the page's.

## Pinpoint on web pages

Pinpoint works on a page only while the sidebar is open and showing that tab. The extension has no
standing access to any site: the toolbar button grants access to the current tab (`activeTab`), and
the sidebar then injects Pinpoint into it. Switching tabs moves Pinpoint to the new tab, and closing
the sidebar removes it.

After you navigate a tab to another site, the page chip says **Click the Worca button in the toolbar
to use this page.** Click the button again to grant access to the new site.

- **Chrome and Edge** keep the grant while you stay on the same site.
- **Firefox** revokes `activeTab` on every navigation, so there the button is needed again after
  any navigation, even within one site.

The toolbar lives in a closed shadow root, so the page's own scripts cannot read it, restyle it or
read an Explain answer. It also ignores synthetic clicks and key presses: only your real input
counts.

## Security model

The extension adds a new kind of caller to a local tool that runs agents with shell access. Each
risk below has a specific answer.

**Web pages still cannot reach Worca.** The extension rule applies only to requests from an
extension origin. A request from an ordinary web page gets exactly the treatment it got before:
refused, with no CORS headers.

**The page cannot use the extension to reach Worca.** The script injected into the page holds no
token and can make one request only: a Pinpoint Explain. The extension's background worker rebuilds
that request itself (the surface, and the page address taken from the browser, not from the page)
and answers only for the tab the sidebar is showing, in its top frame. **Send to chat** only adds a
chip to the composer; you still press Send.

**A malicious extension cannot pair on its own.** A person must approve it, with a matching code,
in a prompt that shows the extension id. Deny is the default. A request lives 2 minutes; at most 3
can wait at once, and an extension can make at most 10 requests in 10 minutes. Worca refuses to be
shown inside a frame (`frame-ancestors 'none'`, `X-Frame-Options: DENY`), and a framed Worca never
opens the prompt, so no page or extension can lay a decoy over Approve.

**An agent cannot approve its own pairing**, as long as agent isolation is on. Approve, deny,
revoke and list refuse callers that may be an agent, cross-origin callers and extensions, and the
token goes only to the sidebar that is polling for it. Without agent isolation, an agent running
as your user can call the approve route directly (for example with `curl`, which sends no
`Origin`). That is the same exposure as the rest of Worca's local API.

**The token is narrow.** It works only on the routes the sidebar uses: reading the Ask models,
listing, opening and renaming threads, sending a message and stopping it, Pinpoint, and listing
projects and workspaces. **Cards are not on the list**, so the extension can show a card but never
apply, undo or start one: do that in Worca. An extension's WebSocket receives only chat frames, never
runs, terminals or notifications.

**The token is stored carefully.** Worca keeps only a SHA-256 hash of it, in a file readable only by
you. The extension keeps it in its own `storage.local`, which page scripts cannot read. A pairing is
bound to the extension's origin, so the token is useless from anywhere else. It travels only in the
`Authorization` header and the WebSocket subprotocol, never in a URL.

**Re-pairing rotates the token.** Pairing the same extension again replaces its token, and any
socket opened with the old one is closed. Revoking does the same (see [Revoking](#revoking)).

**Unpaired extensions learn very little.** Any installed extension can find out that Worca is
running (`/api/extension/hello` answers `{worca:true}`) and can ask to pair. Nothing else answers
it, not even `/api/health`.

**A local process could fill the pending slots.** A process on your computer can forge extension
origins and occupy the 3 pending pairing requests, so a real request has to wait for them to expire.
This is low risk: such a process already has loopback access to the whole API.

**Residual risk: prompt injection still reaches an agent with tools.** Attachments are marked as
data, but the model still reads them, and an Ask turn still has its act-then-undo tools. This is the
same exposure as Ask's existing web access. Keep page text off unless you need it; it is opt-in per
message and resets after each send.

**Residual risk: drafted wording.** Pinpoint's **Use this** and **Discuss** put a sentence into the
composer that wraps an alternative the model wrote from page text. You see it in the editable
composer and decide whether to send it, but once sent it travels as your message text, not as an
attachment. The line Worca adds to the model's context says that the message text may include such
wording.

**Unchanged:** a page served from `localhost` can already call Worca's local API, as before.

## Local only

The extension works with a local Worca only. When [remote access](remote-access.md) is on, Worca
refuses pairing (`extension-remote-mode`) and every extension request addressed to a loopback host,
and passes all other requests to its usual Cloudflare Access checks unchanged. The sidebar then shows
**Local Worca only**, and Settings › General › **Browser extension** says that pairing is off.

## Revoking

Settings › General › **Browser extension** lists each paired browser with its name, browser, pairing
date and last use. **Revoke** removes the pairing: the extension's next request is refused and its
open sockets close. The sidebar then shows **Connect to Worca** again.

Changing the Worca address in the sidebar also forgets the token, because a token belongs to the
Worca that issued it.

## Permissions

The extension asks for no host permissions and has no content scripts declared in its manifest. It
asks for:

| Permission | Why |
|---|---|
| `activeTab` | read the current tab's URL, title, selection and text, and inject Pinpoint, only after you click the toolbar button or use the context menu |
| `scripting` | inject the page script into that tab |
| `storage` | keep the Worca address, the token and the theme |
| `contextMenus` | the **Ask Worca about selection** item |
| `sidePanel` (Chrome, Edge) | show the sidebar; Firefox uses `sidebar_action`, which needs no permission |

Firefox's manifest declares that the extension collects no data.

## Troubleshooting

- **"Worca isn't running".** Nothing answers at the address the sidebar uses. Start Worca with
  `worca ui` (or `npx @worca/app`) and try again.
- **Worca runs on another port.** The sidebar uses `http://127.0.0.1:4317` by default. Open
  **Connection settings** at the bottom of the sidebar, enter `http://127.0.0.1:<port>` or
  `http://localhost:<port>` and click **Save**. Only loopback addresses are accepted. Saving
  forgets the token, so pair again.
- **"No Ask model is available in Worca".** Ask has no model to answer with. Set one up in Worca
  under Settings → **Models**.
- **"Worca could not load this chat".** Worca answered with an error; the sidebar shows its text.
- **The page chip says "Click the Worca button…".** The extension has no access to this tab yet,
  or lost it on navigation. Click the toolbar button (see
  [Pinpoint on web pages](#pinpoint-on-web-pages)).
- **The approval is refused with `extension-agent-blocked`.** Agent isolation is on: approve
  through Worca's published address (see [Pairing](#pairing)).

## Safari

Safari is future work. Its route is `xcrun safari-web-extension-converter extension/dist/chrome`,
which wraps the extension in an Xcode project. That step is not automated or tested here.

## Developing

```bash
npm run ext:build                 # build all three browsers into extension/dist/
npm run ext:zip                   # … and zip them
npm run ext:lint:firefox          # web-ext lint on the Firefox build
npm run e2e:firefox-smoke         # load the Firefox build in Firefox and check it starts
npm run e2e:extension             # the Playwright suite (Chromium) in e2e/extension/
npm run e2e:extension:update-linux  # re-render the screenshot baselines in the CI image (needs Docker)
```

The Playwright suite runs against a test build (`--test`), which adds a host permission for its
fixture site and lets the panel be pinned to one tab. Its screenshot baselines in
`e2e/extension/__screenshots__/` are rendered in `mcr.microsoft.com/playwright:<version>-noble`,
the same image CI uses, so fonts match; the image tag must equal the pinned `@playwright/test`
version, and a test checks it. Re-render baselines with `e2e:extension:update-linux`, never on a
Mac.

### The side-panel deviation and the manual check list

Playwright cannot drive a browser's real side panel. The suite opens the sidebar page as an ordinary
tab, pinned to one page tab: the same page, the same background worker and the same messages, but
not the browser's panel chrome. Before a release, run these checks by hand in **Chrome, Edge and
Firefox**, on the **production** build (`npm run ext:build`, no host permissions):

- **The panel.** Open it from the toolbar button. Switching tabs moves Pinpoint to the new tab.
  Closing the panel removes the Pinpoint toolbar from the page. The context menu item opens the
  panel.
- **Switching back to a tab already used.** With the panel open, go tab A → tab B → tab A. The page
  chip and the **Sends with your message** line show tab A's title again.
- **The `activeTab` path.** On a fresh tab of a site never visited before, click the toolbar
  button. The page chip shows the page title, a sent message carries `page-context.md` (visible as
  its pill), and selecting text shows the Pinpoint toolbar. Navigate that tab to another site: the
  chip says **Click the Worca button…** until you click the button again.
- **Pinpoint in the closed shadow root.** A click on **Explain** opens the popover (the toolbar does
  not vanish), the arrow keys move between toolbar buttons, and Esc closes it.
- **Local Network Access** (stable Chrome and Edge only). Pair, send a message and watch the answer
  stream: this proves both `fetch` and the WebSocket to `127.0.0.1` work. The pinned Playwright
  Chromium predates Chrome's loopback restrictions, so the E2E suite cannot show this. If the
  browser shows a prompt, note it here. If it blocks the requests outright, the extension needs
  `optional_host_permissions` for `http://127.0.0.1/*` and `http://localhost/*`, requested on the
  Connect click.

### Simplifications versus Ask Worca

The sidebar is a smaller Ask Worca:

- no thinking orb;
- attached images show as pills, not previews;
- cards are read-only: open the thread in Worca to apply one.
