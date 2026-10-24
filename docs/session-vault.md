# Session Vault

The Session Vault encrypts what PromptOps stores on your device: sessions,
workspaces, prompts, notes, preferences, saved SSH and database connections,
and the terminal history kept to restore sessions. This page describes the format so
you can review it, and what it does and does not protect against.

Code: [`vault.rs`](../apps/desktop/src-tauri/src/vault.rs) (encryption),
[`local_store.rs`](../apps/desktop/src-tauri/src/local_store.rs) (storage).

## Format

The store is a JSON file, `local-store.json`:

```json
{
  "v": 1,
  "records": {
    "sessions": {
      "01jb3x…": { "v": 1, "alg": "A256GCM", "kid": "25cb0762909ed2e1", "n": "…", "ct": "…" }
    }
  }
}
```

Each record is sealed on its own, as an envelope:

| Field | Meaning |
|---|---|
| `v` | Envelope format version (1) |
| `alg` | `A256GCM`: AES-256-GCM |
| `kid` | Key id: the first 8 bytes of SHA-256 over a fixed label and the key, hex encoded. It tells keys apart without revealing them |
| `n` | 96-bit nonce, random for every write, base64 |
| `ct` | Ciphertext with the 128-bit authentication tag, base64 |

The additional authenticated data is `promptops/vault/v1|<collection>|<id>`.
An envelope copied to another record, or to another collection, fails
authentication instead of decrypting.

A fixed test vector in `vault.rs` (`known_answer_vector`) is cross-checked
with Python's `cryptography` package, so other implementations can verify
compatibility.

## Keys

- The key is 256 random bits, created on first start.
- It is stored in the OS keychain (macOS Keychain, Windows Credential
  Manager, Secret Service on Linux), under a service name derived from the
  app identifier, so PromptOps and PromptOps Desktop never share a key.
- Without a keychain, it is stored in `vault.key` next to the store, with
  owner-only permissions (0600 on macOS and Linux), and the app logs it.
  Development builds always use `vault.key` (a copy of the keychain key, if
  there is one), so a rebuilt binary does not ask for keychain access again.
- Each envelope names its key (`kid`), so records written with an earlier
  key of this device (the keychain key or `vault.key`) stay readable.
- The key never leaves the device.

Terminal history is sealed the same way (kind `parked-buffer`, id of the
session) and written to its own file, one per session.

Writes go to a temporary file that is flushed to disk and atomically
replaces the store. A record that fails to decrypt is kept on disk, skipped
and logged, never deleted. A store file that cannot be read at all
(truncated, not JSON) is never overwritten: it is moved aside as
`local-store.json.corrupt-<time>` and the app starts empty and says so. A
file written by a newer version, or already in use by another running copy
of the app, is opened read-only.

## Backups

The vault key never leaves the device, so the store file alone cannot be
moved to another computer, and it cannot be opened if the keychain entry is
lost. **Settings → Backup & restore** writes an encrypted copy that you can.

Code: [`local_backup.rs`](../apps/desktop/src-tauri/src/local_backup.rs).

### What a backup holds

Every record the device can open, from every collection of the store:
sessions, workspaces, session profiles, agent profiles, recent workspace
folders, sidebar folders, prompts with their versions, categories, tags and
stars, notes, shortcuts, action buttons, your profile and UI preferences,
saved SSH connections and database connections
**with their passwords and keys**, and the API keys saved in the app (Groq,
the PromptOps CLI provider key). Secrets are never written in clear: like
everything else in the file, they are encrypted under your passphrase.

Not included:

- terminal history (`parked-buffer` files): it only restores scrollback and
  is rebuilt as you work;
- plugins and plugin secrets: plugin secrets live in their own files
  ([`plugins/secrets.rs`](../apps/desktop/src-tauri/src/plugins/secrets.rs));
  reinstall the plugins and enter their tokens again;
- records this device cannot open (sealed with a key it no longer has): the
  export reports how many were left out;
- the vault key itself. A backup does not depend on it.

### Format

A binary file, extension `.pobackup`, integers little endian:

| Offset | Size | Field |
|---|---|---|
| 0 | 8 | Magic `POBACKUP` |
| 8 | 1 | Format version (1) |
| 9 | 1 | KDF id: 1 = Argon2id, version 0x13 |
| 10 | 4 | Argon2 memory cost, KiB |
| 14 | 4 | Argon2 time cost (passes) |
| 18 | 4 | Argon2 parallelism (lanes) |
| 22 | 1 | Salt length (16) |
| 23 | 16 | Salt, random for every export |
| 39 | 12 | AES-GCM nonce, random for every export |
| 51 | … | AES-256-GCM ciphertext followed by the 128-bit tag |

- The key is **Argon2id** over the UTF-8 passphrase and the salt, 32 bytes.
  New backups use m = 64 MiB, t = 3, p = 4 (RFC 9106, second recommended
  option). The parameters are in the header, so they can be raised later
  without a new format; on import, values above 1 GiB, 16 passes or 16 lanes
  are refused, so a crafted file cannot exhaust memory.
- The 51 header bytes are the additional authenticated data: changing the
  version, the KDF parameters, the salt or the nonce makes decryption fail.
- The plaintext is JSON:
  `{"format":"promptops-local-backup","v":1,"created_at":"…","app_version":"…","collections":{"<collection>":{"<id>":<record>}}}`.
- Passphrases must have at least 12 characters. There is no recovery: a
  forgotten passphrase means the backup cannot be opened.

### Restoring

The file is verified and decrypted first; nothing changes if the passphrase
is wrong or the file was altered (AES-GCM cannot tell the two apart, so the
app reports them together). Then, depending on the mode:

- **Replace**: the store becomes exactly what the backup holds.
- **Merge**: records missing on this device are added, records already here
  are kept as they are. For the saved SSH and database connection lists,
  connections with a new id are added to the local list. Records with the
  same id but different contents stay local and are counted in the result;
  numbered records (prompts, notes, tags…) created separately on two devices
  can share an id, so prefer Replace when moving to a new computer.

Every record is sealed again with **this device's** vault key, so a restored
store looks like one created here. Before the new store replaces the old one
atomically (temporary file and rename), the current file, if there is one, is
copied, still encrypted, to `local-store.pre-import-<id>.json` in the same
folder (the five newest copies are kept, older ones are deleted); to undo an
import, quit the app and put that file back as `local-store.json`. Files larger
than 256 MiB are refused before they are read.
The app reloads its data after an import. The log records only counts and
error codes, never contents or passphrases.

### Threat model of a backup file

- Protects against anyone who gets the file without the passphrase: a cloud
  folder, a USB stick, a mail attachment. Each guess costs one Argon2id run
  with 64 MiB of memory, which makes offline guessing slow, but a short or
  common passphrase can still be guessed: use a long, unique one.
- Detects changes to any byte of the file.
- Does not hide that the file is a PromptOps backup, its approximate size or
  the KDF settings.
- Does not protect a passphrase typed on a compromised computer, or the data
  once restored (from then on the Session Vault applies).

## What it protects against

- Someone reading the files: another user account, a backup, a synced or
  shared folder, a lost disk without the keychain.
- Records being moved or altered: tampering fails authentication.

## What it does not protect against

- Software running as your user account. It can ask the keychain for the key,
  as PromptOps does.
- Metadata in clear: collection names, record ids (random ULIDs or numbers),
  how many records there are and roughly how large they are.
- Data that leaves through other programs: the AI agents you run, plugins
  with network permissions, your shell history.

## Reporting a problem

See [SECURITY.md](../SECURITY.md).
