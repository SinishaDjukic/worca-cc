# Secrets and the vault

Worca keeps provider and model keys, MCP and plugin secrets and the corporate proxy login on your machine. With the
`secretVault` flag on (Labs, experimental), they go into one encrypted file, the vault, and the key that opens it is
kept in your operating system's key store. This page covers how to turn it on, what it protects, and how to go back.

## Turning the vault on

Turn on **Secret vault** in Settings › Labs, or run `worca flags on secretVault`. At the next start of the Worca
app (or the next `worca models`, `worca proxy`, `worca container` or pipeline run in a terminal), Worca moves the
secrets you saved before into the vault, once:

- The migration first proves the OS store with a test record: it writes random bytes to a throwaway item, reads them
  back, compares and deletes them. Only when that passes, and the vault key reads back the same, does anything move.
- Each secret is written into the vault, read back and compared before its config file is changed. The file then
  holds a `worca:vault:v1:…` reference instead of the value.
- The migration never writes a secret back into a JSON file on its own. A failed or interrupted migration leaves every
  secret it did not move where it was, in its config file, and tries again at the next start.

Settings › About shows the backend, and `worca secrets status` says whether the vault can be read and how many
entries it holds. `worca secrets status --check` runs the same test-record round trip without moving anything.

## Backends

| Machine | Where the vault key is kept |
| --- | --- |
| macOS | macOS Keychain (login keychain) |
| Windows | Windows Credential Manager |
| Linux | Secret Service (GNOME Keyring, KWallet) |
| WSL2 without a Secret Service | Windows DPAPI, wrapped in `worca-vault.key` beside the vault |

There is one key item per Worca home. Without any usable key store, nothing is vaulted and keys stay in the config files, as
before; `worca secrets status` and Settings › About say so.

## The macOS Keychain access prompt

The first time Worca reads its key, macOS may ask whether `node` may use the "worca-cc" item. Choose **Always Allow**
so later starts do not ask again. If you deny it, the store reads as locked: the vault stays closed and saved keys do
not resolve until you allow access and start Worca again.

## Export and downgrade

`worca secrets export` writes every vaulted secret back into its own config file (each file mode 0600
on macOS and Linux), deletes the vault file and its OS key item, turns the `secretVault` flag off and drops the
message about moved secrets. It asks first; pass `--yes` when not in a terminal. Run it in your own terminal: it
refuses while the Worca app runs for the same home, while `WORCA_FLAGS` sets the flag, and when an agent runs it.
There is no web route for it.

Entries no setting uses any more (a replaced key not yet cleaned up) are deleted with the vault. A secret that cannot
be read from the vault stops the export with its name and nothing changed: clear it in Settings, then run export
again. If the OS key item cannot be removed, the values are already back in the config files and the flag stays on: run export
again. When the flag is on and no vault file exists, export checks the OS store for a leftover key item, bounded by
the store time limit (10 s), and removes it.

The only two ways back to config-file storage are `worca secrets export` and turning the flag off, which covers new keys only:
with the flag off, keys you save go to the config file again, but the ones already in the vault stay there until you export.

Moved-aside vault copies (`worca-vault.enc.unreadable-…`) are not removed by export. Delete them by hand once you no
longer need them.

## The one-time message

After a migration that moved at least one secret, Worca lists the moved keys by name (never a
value), with the backend:

- in the terminal, on stderr, at each `worca models`, `worca proxy`, `worca container` or pipeline start;
- in Settings › About, under Secrets.

Run `worca secrets ack` or press **Got it** in Settings to dismiss it. Either one clears the message for both places.

## A locked store

A locked key store (a locked keychain, a Secret Service that asks for a password, or one that does not answer within
10 s) keeps the vault closed: saved keys do not resolve, and once something is vaulted, saves are refused rather than
written to the config file.
Unlock the store, then run `worca secrets status` again or reopen Settings.

## A lost key item and `worca secrets reset`

If the OS key item is deleted, or the vault was written with another key, the vault cannot be read. `worca secrets
reset` moves the unreadable vault aside (`worca-vault.enc.unreadable-…`) so a new one can start; it asks first and
keeps the OS item. The secrets in the moved file are lost: enter them again.

## What file theft does and does not cover

The vault protects your secrets when someone copies Worca's files without the OS key store: a backup, a synced folder,
a stolen disk image. It does not protect them from a program running as you on the same machine: that program can ask
the key store just as Worca does. Agents that Worca runs are kept away from the vault files and the key store commands
by their deny rules, which guard against mistakes, not against a determined attacker.

## The accepted risk of an older vault file

A vault file restored from an older backup opens with the same key and brings back the secrets it held then,
including keys you have since rotated or removed. Worca accepts that risk. A file changed outside Worca, or one
encrypted with another key, is refused and never used.

## The WSL2 DPAPI path

On WSL2 without a Secret Service, the vault key is wrapped by Windows DPAPI for your Windows user through Windows
PowerShell at its fixed path. The key travels only on the child's standard input, never on its command line. This path
is unverified on real hardware: report anything that does not work.

## Turning the flag off after a migration

Turning the flag off does not strand your keys. While the vault file exists, Worca still reads every vaulted key, at
start too, and a key you remove or replace is still cleaned out of the vault. New keys you save go to the config file.
`worca secrets status` and `worca doctor` say the vault is still in use and name `worca secrets export`. Turning the
flag off while a migration runs stops it before its next step: what it already moved stays readable, the rest stays
in the config files.
