# Noteflow - functional spec

A VS Code extension that keeps a folder of Markdown notes in the side bar and syncs it between every VS Code the user signs in to with Settings Sync.

- Extension id: `jamacio.noteflow`, display name **Noteflow - Synced Markdown Notes**, version `2.0.0`, license **MIT** (author: jamacio).
- Every command, setting, view and context key uses the `noteflow` prefix.
- Icons: `resources/icon.png` (extension icon), `resources/noteflow.svg` (Activity Bar). Use built-in codicons (`$(...)`) for every other icon.

## Side bar

An Activity Bar container **Noteflow** with two tree views:

| View              | Shows                                                                          | Visible                                              |
| ----------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------- |
| **My Notes**      | the folder in `noteflow.folder`                                                | always                                               |
| **Project Notes** | the folder in `noteflow.projectFolder`, relative to the first workspace folder | only when a workspace is open and that folder exists |

Trees list folders first, then files, sorted by `noteflow.sort`. Hidden entries (starting with `.`) are not shown. Only files allowed by `noteflow.fileTypes` are shown. Clicking a note opens it in the editor; folders expand.

Welcome content (`viewsWelcome`) for **My Notes**:

- folder not set: text + button **Choose Notes Folder**
- folder set but missing: text + buttons **Create Folder**, **Choose Notes Folder**
- folder empty: text + buttons **New Note**, **New Folder**

For **Project Notes** when empty: **New Note**, **New Folder**.

A command **Set Up Project Notes** creates `.notes` in the first workspace folder (or the configured `noteflow.projectFolder`) so the view appears.

## Settings

| Setting                     | Type / default                                                | Meaning                                                                                                  |
| --------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `noteflow.folder`           | string, `""`, scope `machine-overridable`                     | Folder for My Notes. `~` expands to the home folder.                                                     |
| `noteflow.projectFolder`    | string, `".notes"`                                            | Folder for Project Notes, relative to the first workspace folder (absolute also allowed).                |
| `noteflow.defaultExtension` | string, `"md"`                                                | Extension given to a new note when the typed name has none.                                              |
| `noteflow.newNoteName`      | string, `""`                                                  | Name pre-filled when creating a note. Tokens: `{yyyy}` `{mm}` `{dd}` `{HH}` `{MM}`. Empty = empty input. |
| `noteflow.fileTypes`        | string, `"*"`                                                 | Comma-separated extensions shown and synced, or `*` for all.                                             |
| `noteflow.sort`             | enum `name` \| `name-desc` \| `modified` \| `created`, `name` | Order of notes in both views and in Quick Open.                                                          |
| `noteflow.sync`             | boolean, `true`, scope `application`                          | Sync My Notes through Settings Sync.                                                                     |
| `noteflow.refreshSeconds`   | number, `5`, min 2, max 60                                    | Polling interval for outside changes while a view is visible.                                            |

Settings changes apply immediately, no reload.

## Commands

All commands are in the category **Noteflow**. Commands that need a tree item (rename, delete, move, new note in folder, ...) are hidden from the Command Palette.

| Command                        | Behaviour                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **New Note** (`Alt+N`)         | Ask for a name (pre-filled from `noteflow.newNoteName`). From a folder's context menu, create there; from a view's title bar, create at that view's root; from the palette, ask My Notes vs Project Notes when both exist. Add `noteflow.defaultExtension` when no extension was typed. Refuse names with path separators or that already exist. Create the file and open it. |
| **New Folder**                 | Same targeting rules, creates a folder.                                                                                                                                                                                                                                                                                                                                       |
| **Quick Open Notes** (`Alt+L`) | Quick pick of every note in both views (recursively), recently opened notes first, then by `noteflow.sort`. Shows the folder path as description. Typing a name that matches nothing and pressing Enter creates that note in My Notes.                                                                                                                                        |
| **Rename**                     | Input box with the current name selected without its extension.                                                                                                                                                                                                                                                                                                               |
| **Delete**                     | Confirm with a modal dialog, then move to the OS trash (`vscode.workspace.fs.delete` with `useTrash: true`). Close open editors of deleted files. Works on multiple selected items.                                                                                                                                                                                           |
| **Move To...**                 | Quick pick of every folder in both views (plus their roots); move the selected items there. Drag and drop in the trees does the same, also between the two views. Refuse moving a folder into itself.                                                                                                                                                                         |
| **Search Notes**               | Open VS Code's search view limited to the notes folder (both views, one view, or one folder from its context menu).                                                                                                                                                                                                                                                           |
| **Sort By...**                 | Quick pick that updates `noteflow.sort`.                                                                                                                                                                                                                                                                                                                                      |
| **Refresh**                    | Refresh both trees.                                                                                                                                                                                                                                                                                                                                                           |
| **Open Preview**               | For Markdown notes only: `markdown.showPreview`.                                                                                                                                                                                                                                                                                                                              |
| **Reveal in File Explorer**    | `revealFileInOS`; hidden in remote windows other than WSL.                                                                                                                                                                                                                                                                                                                    |
| **Choose Notes Folder**        | Folder picker, saves `noteflow.folder` in user settings.                                                                                                                                                                                                                                                                                                                      |
| **Create Folder**              | Creates the missing `noteflow.folder`.                                                                                                                                                                                                                                                                                                                                        |
| **Set Up Project Notes**       | See above.                                                                                                                                                                                                                                                                                                                                                                    |
| **Sync Now**                   | Runs a sync immediately and shows a short status bar message.                                                                                                                                                                                                                                                                                                                 |
| **Clear Recent Notes**         | Empties the recent list used by Quick Open.                                                                                                                                                                                                                                                                                                                                   |

View title buttons: New Note, New Folder, Search, Sort By (navigation group); Refresh, Reveal, Choose Notes Folder, Sync Now in the `...` menu. Context menu on notes: Open Preview (Markdown), Rename, Delete, Move To..., Reveal. On folders: New Note, New Folder, Rename, Delete, Move To..., Search in Folder, Reveal.

Remember the 50 most recently opened notes (from anywhere in VS Code, when the file is inside a notes folder) in `globalState`, updating paths on rename/move and dropping deleted ones.

## Outside changes

Trees refresh on their own when files are created, deleted or renamed outside VS Code: use a `FileSystemWatcher` and also poll every `noteflow.refreshSeconds` while a view is visible (some synced or network folders never send events). Debounce refreshes.

## Sync (already written - `src/noteSync.ts`)

`src/noteSync.ts` and `src/test/noteSync.test.ts` are finished and tested; keep their logic, adjust only names/imports if needed. The module exports `NoteSync`, `planSync`, `readLocalNotes`, `conflictPath`, `hashContent`, `folderExists`, `isWithin`, `SYNC_KEY`, `MAX_NOTE_BYTES`. It reads the setting `noteflow.syncNotes`: rename that to `noteflow.sync`.

Wire it up in `activate`:

- `new NoteSync(context.globalState, getMyNotesFolder, isAllowedFile, refreshTrees)`.
- `schedule()` after a note inside My Notes is saved, after every create/rename/move/delete done by the extension, when `noteflow.folder` or `noteflow.sync` changes, when the window gains focus, and 2 seconds after activation.
- **New machine onboarding**: when My Notes is not set or its folder is missing and `syncedCount() > 0`, show once per window: "N synced notes from your other VS Code are ready." with buttons **Use ~/Noteflow** (create the folder, set `noteflow.folder` to `~/Noteflow`) / **Choose Folder**; when set-but-missing: **Restore Notes** (create the folder, sync). Check at activation (after 3 s) and on window focus, since Settings Sync can deliver the data after activation.

## Project layout and tooling

- TypeScript (`strict: true`), bundled with **esbuild** into `dist/extension.js`; `engines.vscode` `^1.87.0`; activation is implicit (no `activationEvents` needed beyond contributions).
- Pure logic (path helpers, name templates, sorting, recent list, sync planning) in modules that don't import `vscode`, unit tested with **mocha** in plain Node (a tiny `vscode` stub is fine for `noteSync.ts`). `npm test` runs them.
- `npm run build`, `npm run watch`, `npm run lint` (eslint with typescript-eslint), `npm run package` (`npx -y @vscode/vsce package`).
- `Makefile` with `build`, `test`, `package`, `install` (install the .vsix into `code`), `publish`.
- `.vscode/launch.json` (Run Extension, Run Extension with a temporary clean profile, tests) and `.vscode/tasks.json` (esbuild watch as background task).
- `.vscodeignore` that ships only `dist/`, `resources/`, `README.md`, `CHANGELOG.md`, `LICENSE`, `package.json`.
- `LICENSE`: MIT, © 2026 jamacio.
- `README.md` (English, for Marketplace users): sync between machines is the headline. Sections: what it is, why (comparison table vs a notes extension without sync), how sync works (ASCII diagram, when it syncs, conflicts as `name (conflict YYYY-MM-DD).md`, deletes, safety), set up on the first and other computers (Settings Sync on, **Extensions** checked, same Noteflow version), what is and isn't synced (only My Notes, text files ≤ 256 KB, no hidden/binary files), features, shortcuts, settings table, FAQ / troubleshooting, license.
- `CHANGELOG.md` with `2.0.0 - rewritten from scratch`.
- `git init` with a first commit.
