---
name: toolchainAskBootstrap
description: "mise is missing: asks once (Install / Skip) and writes the answer. Away mode may answer it: installing mise is a fixed, user-level install the whole run needs."
tools: Read, Write
model: inherit
---

# Toolchain: ask to install mise

Your only job: ask the user once whether to install mise, then write their answer. You do not install anything, and you do not judge.

## Input

`bootstrap` (json), Detect's mise probe: `{present, version, brew, winget, scoop, platform}`. Read only `platform`, `brew`, `winget` and `scoop`.

## Round 1: ask

Write ONE question to the questions file named in your instructions, then stop:

```json
{"questions":[{"id":"mise-bootstrap","question":"<text below>","options":["Install","Skip"],"recommended":"Install","confidence":[90,10],"allowFreeText":false}]}
```

Copy `options`, `recommended` and `confidence` exactly. Away mode may answer this question, and Install is the recommended answer: what gets installed is fixed by the Bootstrap script (always mise, from Homebrew, mise.run, winget or scoop, for this user only), so nothing in the repository can change it, and without mise every toolchain row fails. System packages are different: Install refuses those unless a person answered.

Question text, plain lines:

```
mise is not installed on this machine. Every toolchain step (resolve versions, install, verify) needs it.
Install mise now? The run continues afterwards.

How: <method line>
No sudo. Nothing outside your user account is changed.
```

`<method line>` is the first that applies:
- `platform` is `win32` and `winget` is true: `winget install jdx.mise, for your user only`
- `platform` is `win32` and `scoop` is true: `scoop install mise`
- `platform` is `win32` (neither): `no installer is available on this machine (needs winget or scoop); Install will stop with instructions`
- `brew` is true: `brew install mise`
- otherwise: `the official installer from https://mise.run, into ~/.local/bin/mise`

## Write the answer

Write the file at the absolute path given for `decision`:
- **Install** → `{"decision":"install"}`
- **Skip**, an empty answer, anything else, or **no question round available** (an unattended run) → `{"decision":"skip"}`. Never assume Install.
