# Noteflow — Synced Markdown Notes

Keep a folder of Markdown notes in the side bar of VS Code, and have it follow you to every machine where you sign in to Settings Sync.

## What it is

Noteflow adds a **My Notes** tree, backed by any folder on disk, plus an optional **Project Notes** tree for notes that live inside the current workspace (`.notes` by default). Create, rename, move, delete and search notes without leaving the side bar.

## Why

| | A notes extension without sync | Noteflow |
| --- | --- | --- |
| Works on one machine | Yes | Yes |
| Follows you to another machine | No, manual copy | Yes, automatic |
| Needs a cloud account | Sometimes | No — reuses Settings Sync |
| Keeps edits made on two machines | N/A | Yes, newest wins, the other kept as a conflict copy |

## How sync works

```
 Machine A                 Settings Sync                Machine B
┌──────────┐      syncedNotes (global state)      ┌──────────┐
│ My Notes │ ───────────────────────────────────▶ │ My Notes │
│ (disk)   │ ◀─────────────────────────────────── │ (disk)   │
└──────────┘                                       └──────────┘
```

- Sync runs a couple of seconds after the extension starts, after a note inside My Notes is saved, after every create/rename/move/delete you make through Noteflow, when `noteflow.folder` or `noteflow.sync` changes, and when the window regains focus.
- A change on one side is pushed; if both sides changed the same note, the newest wins and the other is kept next to it as `name (conflict YYYY-MM-DD).md`.
- Deletes made on one machine are applied on the others.
- Only the folder configured in `noteflow.folder` (My Notes) is synced. Project Notes never leave the workspace.

## Set up on your first computer

1. Install Noteflow.
2. Turn on Settings Sync with **Extensions** checked.
3. Choose a notes folder for My Notes.

## Set up on another computer

1. Turn on Settings Sync, signed in to the same account, with the same Noteflow version installed.
2. Open VS Code: once your synced notes arrive, Noteflow offers to use `~/Noteflow` or to choose a folder.

## What is and isn't synced

- Only **My Notes**, not Project Notes.
- Text files up to 256 KB.
- Hidden files (starting with `.`) and binary files never sync, and stay local only.

## Features

- Two side bar views: My Notes and Project Notes.
- Create, rename, move (drag and drop or **Move To...**), and delete notes and folders.
- Quick Open across both views, most recently opened first.
- Search scoped to your notes.
- Sort by name, modified or created date.
- Markdown preview, reveal in file explorer.
- Automatic refresh when files change outside VS Code.

## Shortcuts

| Shortcut | Command |
| --- | --- |
| `Alt+N` | New Note |
| `Alt+L` | Quick Open Notes |

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `noteflow.folder` | `""` | Folder for My Notes. `~` expands to the home folder. |
| `noteflow.projectFolder` | `.notes` | Folder for Project Notes, relative to the first workspace folder. |
| `noteflow.defaultExtension` | `md` | Extension added to a new note when none was typed. |
| `noteflow.newNoteName` | `""` | Name pre-filled when creating a note. Tokens: `{yyyy}` `{mm}` `{dd}` `{HH}` `{MM}`. |
| `noteflow.fileTypes` | `*` | Comma-separated extensions shown and synced, or `*` for all. |
| `noteflow.sort` | `name` | `name`, `name-desc`, `modified` or `created`. |
| `noteflow.sync` | `true` | Sync My Notes through Settings Sync. |
| `noteflow.refreshSeconds` | `5` | Polling interval for outside changes while a view is visible. |

## FAQ / troubleshooting

**My notes from another machine never showed up.** Make sure Settings Sync is on with **Extensions** included, and that both machines are signed in to the same account with the same Noteflow version.

**A note is missing after syncing.** Check it wasn't larger than 256 KB, binary, or inside a hidden folder — those never sync.

**I see a `(conflict ...)` file.** The note was edited on two machines before they synced; the newest version kept its name, the other was kept as a copy so nothing is lost.

## License

MIT
