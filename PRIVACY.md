# Privacy

The open-source edition of PromptOps runs on your computer. It has no
account, no sign-in and no PromptOps server behind it. This page lists
everything it stores and every network connection it can make, so you can
check it against the code once it is published in this repository. The
last section covers PromptOps Desktop, the ready-to-run app you download
from the releases of this repository, which works differently.

## What stays on your device

Everything you create in the app:

- sessions, workspaces, session profiles and sidebar folders;
- your prompt library, with versions, categories and tags;
- notes, to-dos, shortcuts and action buttons;
- saved SSH connections and database connections, with their passwords and keys;
- your display name and UI preferences.

These live in one file, `local-store.json`, in the app data folder
(`~/Library/Application Support/promptops-oss` on macOS, `%APPDATA%\promptops-oss`
on Windows, `~/.local/share/promptops-oss` on Linux).

Each record in that file is encrypted on its own with **AES-256-GCM** (the
Session Vault). The key is created on your device and kept in the OS
keychain. When no keychain is available (some Linux setups), the key is
stored in `vault.key` next to the store, readable only by your user account,
and the app says so in its log.

Terminal history that PromptOps keeps to restore a session after a restart is
encrypted with the same key, in separate files. Prompts handed to an agent CLI
for a one-off task go through a temporary file readable only by your user
account, deleted right after.

The app data folder and every file PromptOps writes in it are readable only
by your user account (0700 and 0600 on macOS and Linux).

Code: `local_store.rs`,
`vault.rs`.

PromptOps never sends terminal output, agent conversations or your prompts
anywhere by itself. The agents you run send what you give them to their own
providers, and the AI helper features listed below do the same through one of
your agent CLIs.

## How the interface reads your data

The interface never uses the network for your data. It reads and writes
through one interface, `DataBackend`
(`data-backend.ts`), with a
fixed list of methods
(`data-methods.ts`). In this
edition that interface calls a single desktop command, `local_call`, which
reads and writes the encrypted local store
(`local_data.rs` and
`local_data_more.rs`).

Environment variables in session settings and the text of prompts sent to
agents are removed before a session is stored.

## Network connections

PromptOps itself contacts the network only in these cases:

| When | Where | What is sent |
|---|---|---|
| You open the plugin catalog | `raw.githubusercontent.com` (public index of official plugins) and `github.com` (avatars of plugin authors) | Plain downloads, with no credentials or identifiers |
| You have plugins installed from the catalog: at start and every 6 hours | Same public index | Same download, to see updates and revoked plugins |
| You install or update a plugin | `raw.githubusercontent.com`, pinned to a commit | A plain download; the bundle hash is verified |
| A plugin you installed uses a host it declares in its manifest (`net:` permission) | That host only | What the plugin sends, inside its sandbox |
| First use of voice input | `huggingface.co` | Download of the local Whisper model; after that, audio is transcribed on your device |
| Voice input while the local model is not ready (or fails), if you added a Groq or OpenAI key | `api.groq.com` or `api.openai.com` | The recorded audio, under your account |
| Same case on macOS with no key, in a language without an on-device model | Apple's speech service, through macOS | The recorded audio; with an on-device model it stays on the Mac |
| You open the Browser page | Google Chrome, started by PromptOps with its own profile, opens the address you type (the start page is google.com) | What any browser sends to the sites you visit |
| You import an asset from a URL | The address you paste | A plain download of that file |
| You set up and test a custom model endpoint for the PromptOps CLI (OpenRouter, Ollama, LM Studio, another OpenAI-compatible server) | The endpoint you entered | A short test request, with the key you entered |
| You use a feature that asks an AI for help: commit messages, prompt enhancement, plain-language database queries, AI Git Writer, agent evaluations | One of your agent CLIs, run in the background; it talks to its own provider | The text the feature needs (for example the diff or your prompt), under your account with that provider |
| You click a link | Your browser opens it | Nothing from the app |

Not listed because PromptOps does not do it: telemetry, analytics, crash
uploads, update checks, ads, tracking pixels. Crash reports are written to
the app log folder without any message content and deleted after 7 days.

The AI agents you run (Claude Code, Codex, Gemini CLI and others) are separate
programs. They connect to their own providers under their own terms;
PromptOps does not proxy or read that traffic.

## PromptOps Desktop, the hosted edition

Teams, the ranking, community prompts, news, mobile access and sync across
devices need a server, so they are part of PromptOps Desktop, which you can
download from [promptoperations.ai](https://www.promptoperations.ai/). In this
edition they are shown with a lock and run no code.

PromptOps Desktop encrypts session names, paths and settings in its database
with the same algorithm (AES-256-GCM). The difference is where the key lives:
here it is on your device; in the hosted edition it is held by our servers,
so your sessions can follow you across devices.

Unlike the open-source edition, PromptOps Desktop:

- needs an account and signs in to PromptOps servers;
- checks GitHub Releases for updates and installs only builds signed with
  the PromptOps release key;
- sends your sessions' state to PromptOps servers so it can follow you
  across devices;
- records your active time and online presence, used by Teams and the
  ranking;
- sends usage signals for in-app announcements, interface experiments and
  plugin statistics.

The [PromptOps privacy policy](https://www.promptoperations.ai/legal/privacy/)
covers this data in full.

## Check it yourself

- Block the app's network access: everything listed under "What stays on your
  device" keeps working.
- Search the code, once it is published here: `data-backend.ts` is the only
  way the interface reaches your data, and `local_data.rs` is where it is
  stored.
- Questions or findings: open an issue, or follow [SECURITY.md](SECURITY.md)
  for anything sensitive.
