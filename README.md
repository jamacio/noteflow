# Noteflow - Synced Markdown Notes

[**Get it from the Visual Studio Marketplace**](https://marketplace.visualstudio.com/items?itemName=JamacioRocha.noteflow)

Keep a folder of Markdown notes in the side bar of VS Code, and have it follow you to every machine where you sign in to Settings Sync.

## What it is

Noteflow adds a **My Notes** tree, backed by any folder on disk, plus an optional **Project Notes** tree for notes that live inside the current workspace (`.notes` by default). Create, rename, move, delete and search notes without leaving the side bar.

## Why

|                                  | A notes extension without sync | Noteflow                                            |
| -------------------------------- | ------------------------------ | --------------------------------------------------- |
| Works on one machine             | Yes                            | Yes                                                 |
| Follows you to another machine   | No, manual copy                | Yes, automatic                                      |
| Needs a cloud account            | Sometimes                      | No, reuses Settings Sync                            |
| Keeps edits made on two machines | N/A                            | Yes, newest wins, the other kept as a conflict copy |

## How sync works

```
  Machine A                      Machine B
┌───────────┐                  ┌───────────┐
│ My Notes  │                  │ My Notes  │
│  (disk)   │                  │  (disk)   │
└─────┬─────┘                  └─────┬─────┘
      │                              │
      └───▶ Settings Sync ◀──────────┘
               (noteflow.syncedNotes)
```

Noteflow doesn't talk to any server of its own. It stores the content of every note in a bit of
`globalState` (`noteflow.syncedNotes`) that is marked with `setKeysForSync`, so **VS Code's own
Settings Sync** carries it to every machine signed in to the same account, the same mechanism
that syncs your settings and keybindings.

**What a sync does, step by step:**

1. Read every note currently on disk in the My Notes folder (skipping hidden files/folders,
   anything outside `noteflow.fileTypes`, and anything over 256 KB or binary).
2. Compare that to the synced copy (`syncedNotes`) and to a local "base" snapshot of hashes saved
   after the previous sync on this machine.
3. For each note, work out what changed since that base, on this machine and/or on another one:
   - **Only here changed** → push this machine's content (or push a delete) to the synced copy.
   - **Only elsewhere changed** → write that content to disk here (or delete the local file).
   - **Unchanged everywhere** → nothing to do.
   - **Changed on both sides** → the newest edit (by modified time) keeps the file name; the
     older one is written next to it as `name (conflict YYYY-MM-DD).md` and pushed too, so nothing
     is silently lost.
   - A brand-new machine (empty local base) never deletes anything; it just merges both sides.
4. Deletes are remembered as a "tombstone" for 30 days (long enough for every machine to come
   online and see it), then forgotten.
5. Save the new base snapshot for next time.

**When a sync happens:**

- ~2 seconds after the extension activates.
- Right after you save a note that lives inside My Notes.
- After every create, rename, move or delete you make through Noteflow.
- When `noteflow.folder` or `noteflow.sync` changes.
- Whenever the window regains focus (this is also when Settings Sync tends to have just delivered
  changes from another machine in the background).
- Every 30 seconds in the background while the window is focused, as a safety net.
- On demand via **Sync Now**.

Multiple triggers in a row are coalesced: a sync request is debounced ~1.5 seconds, and only one
sync runs at a time (a request made while one is running queues a single follow-up run).

Only the folder configured in `noteflow.folder` (My Notes) is ever synced. Project Notes live
inside the workspace and never leave it.

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

| Shortcut | Command          |
| -------- | ---------------- |
| `Alt+N`  | New Note         |
| `Alt+L`  | Quick Open Notes |

## Settings

| Setting                     | Default  | Meaning                                                                             |
| --------------------------- | -------- | ----------------------------------------------------------------------------------- |
| `noteflow.folder`           | `""`     | Folder for My Notes. `~` expands to the home folder.                                |
| `noteflow.projectFolder`    | `.notes` | Folder for Project Notes, relative to the first workspace folder.                   |
| `noteflow.defaultExtension` | `md`     | Extension added to a new note when none was typed.                                  |
| `noteflow.newNoteName`      | `""`     | Name pre-filled when creating a note. Tokens: `{yyyy}` `{mm}` `{dd}` `{HH}` `{MM}`. |
| `noteflow.fileTypes`        | `*`      | Comma-separated extensions shown and synced, or `*` for all.                        |
| `noteflow.sort`             | `name`   | `name`, `name-desc`, `modified` or `created`.                                       |
| `noteflow.sync`             | `true`   | Sync My Notes through Settings Sync.                                                |
| `noteflow.refreshSeconds`   | `5`      | Polling interval for outside changes while a view is visible.                       |

## FAQ / troubleshooting

**My notes from another machine never showed up.** Make sure Settings Sync is on with **Extensions** included, and that both machines are signed in to the same account with the same Noteflow version.

**A note is missing after syncing.** Check it wasn't larger than 256 KB, binary, or inside a hidden folder; those never sync.

**I see a `(conflict ...)` file.** The note was edited on two machines before they synced; the newest version kept its name, the other was kept as a copy so nothing is lost.

## License

MIT
