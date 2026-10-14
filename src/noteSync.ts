import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

// the notes, kept in the extension's global state, which Settings Sync carries to every VS Code
// signed in to the same account
export const SYNC_KEY = "noteflow.syncedNotes";
// what this machine had at its last sync, never synced: it tells a note deleted here from one it never had
const BASE_KEY = "noteflow.syncBase";

// Settings Sync is meant for small data, larger or binary files stay on this machine
export const MAX_NOTE_BYTES = 256 * 1024;
// how long a deleted note is remembered, so other machines delete it too
const TOMBSTONE_DAYS = 30;

// a note in the synced state, by its path relative to the notes location, always with '/'
export interface SyncedNote {
  content?: string;
  updated: number;
  deleted?: boolean;
}
export type SyncStore = Record<string, SyncedNote>;

// the hash of each note at the last sync, for one location
export interface SyncBase {
  location: string;
  hashes: Record<string, string>;
}

export interface LocalNote {
  content: string;
  modified: number;
}

export type SyncAction =
  | { kind: "push"; path: string; content: string; updated: number }
  | { kind: "pushDelete"; path: string }
  | { kind: "write"; path: string; content: string }
  | { kind: "delete"; path: string };

// true when the folder exists and is a directory
export function folderExists(folder: string): boolean {
  try {
    return (
      !!folder && path.isAbsolute(folder) && fs.statSync(folder).isDirectory()
    );
  } catch {
    return false;
  }
}

// true when target is folder itself or somewhere below it
export function isWithin(target: string, folder: string): boolean {
  const relative = path.relative(folder, target);
  return (
    relative !== ".." &&
    !relative.startsWith(".." + path.sep) &&
    !path.isAbsolute(relative)
  );
}

export function hashContent(content: string): string {
  return crypto.createHash("sha1").update(content).digest("hex");
}

// 'a/todo.md' becomes 'a/todo (conflict 2026-10-14).md'
export function conflictPath(notePath: string, now: Date): string {
  const ext = path.posix.extname(notePath);
  const base = notePath.slice(0, notePath.length - ext.length);
  return `${base} (conflict ${now.toISOString().slice(0, 10)})${ext}`;
}

// what to do to bring the notes on this machine and the synced notes together
// a side changed a note if its content differs from the last sync; a change on one side wins,
// and when both changed, the newest wins and the other is kept as a conflict copy
export function planSync(
  local: Record<string, LocalNote>,
  remote: SyncStore,
  base: Record<string, string>,
  now: Date,
): SyncAction[] {
  const actions: SyncAction[] = [];
  const paths = new Set([
    ...Object.keys(local),
    ...Object.keys(remote),
    ...Object.keys(base),
  ]);

  for (const notePath of paths) {
    const l = local[notePath];
    const r =
      remote[notePath] && !remote[notePath].deleted
        ? remote[notePath]
        : undefined;
    const lh = l ? hashContent(l.content) : undefined;
    const rh = r ? hashContent(r.content ?? "") : undefined;
    if (lh === rh) {
      // the same on both sides, or gone from both
      continue;
    }

    const localChanged = lh !== base[notePath];
    const remoteChanged = rh !== base[notePath];
    const push = (note: LocalNote) =>
      actions.push({
        kind: "push",
        path: notePath,
        content: note.content,
        updated: note.modified,
      });

    if (localChanged && !remoteChanged) {
      if (l) {
        push(l);
      } else {
        actions.push({ kind: "pushDelete", path: notePath });
      }
    } else if (!localChanged && remoteChanged) {
      actions.push(
        r
          ? { kind: "write", path: notePath, content: r.content ?? "" }
          : { kind: "delete", path: notePath },
      );
    } else if (!l) {
      // deleted here, edited elsewhere: keep the edit
      actions.push({
        kind: "write",
        path: notePath,
        content: r!.content ?? "",
      });
    } else if (!r) {
      // edited here, deleted elsewhere: keep the edit
      push(l);
    } else {
      // edited on both sides: the newest stays, the other becomes a copy next to it
      const copy = conflictPath(notePath, now);
      const [winner, loser] =
        l.modified >= r.updated
          ? [l.content, r.content ?? ""]
          : [r.content ?? "", l.content];
      if (winner === l.content) {
        push(l);
      } else {
        actions.push({ kind: "write", path: notePath, content: winner });
      }
      actions.push(
        { kind: "write", path: copy, content: loser },
        { kind: "push", path: copy, content: loser, updated: now.getTime() },
      );
    }
  }
  return actions;
}

// the text notes in a folder and its subfolders, by relative path; folders starting with '.' are skipped
export async function readLocalNotes(
  location: string,
  allowed: (name: string) => boolean,
): Promise<Record<string, LocalNote>> {
  const notes: Record<string, LocalNote> = {};
  const walk = async (folder: string, relative: string) => {
    for (const entry of await fs.promises.readdir(folder, {
      withFileTypes: true,
    })) {
      const full = path.join(folder, entry.name);
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".")) {
          await walk(full, rel);
        }
      } else if (entry.isFile() && allowed(entry.name)) {
        const stat = await fs.promises.stat(full);
        if (stat.size > MAX_NOTE_BYTES) {
          continue;
        }
        const content = await fs.promises.readFile(full, "utf8");
        // binary files stay on this machine
        if (!content.includes("\0")) {
          notes[rel] = { content, modified: stat.mtimeMs };
        }
      }
    }
  };
  await walk(location, "");
  return notes;
}

// keeps the Notes location the same in every VS Code signed in to Settings Sync
export class NoteSync implements vscode.Disposable {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private interval: ReturnType<typeof setInterval>;
  private running: Promise<void> | undefined;
  private again = false;

  constructor(
    private state: vscode.Memento & {
      setKeysForSync(keys: readonly string[]): void;
    },
    private getLocation: () => string,
    private allowed: (name: string) => boolean,
    private onChanged: () => void,
  ) {
    state.setKeysForSync([SYNC_KEY]);
    // Settings Sync brings changes from other machines in the background, look for them now and then
    this.interval = setInterval(() => {
      if (vscode.window.state.focused) {
        this.schedule(0);
      }
    }, 8 * 1000);
  }

  static isEnabled(): boolean {
    return vscode.workspace
      .getConfiguration("noteflow")
      .get<boolean>("sync", true);
  }

  // the notes other machines have, not counting deleted ones
  syncedCount(): number {
    return Object.values(this.state.get<SyncStore>(SYNC_KEY, {})).filter(
      (note) => !note.deleted,
    ).length;
  }

  // sync soon, several changes in a row sync once
  schedule(delay = 600): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.sync().catch((err) => console.error("Failed to sync notes:", err));
    }, delay);
  }

  // one sync at a time, a request during a sync runs once more after it
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.run().finally(() => {
      this.running = undefined;
      if (this.again) {
        this.again = false;
        this.schedule(0);
      }
    });
    return this.running;
  }

  private async run(): Promise<void> {
    const location = this.getLocation();
    // without its folder every note would look deleted, so a missing location is never synced
    if (!NoteSync.isEnabled() || !folderExists(location)) {
      return;
    }

    const now = new Date();
    const local = await readLocalNotes(location, this.allowed);
    const remote: SyncStore = { ...this.state.get<SyncStore>(SYNC_KEY, {}) };
    const savedBase = this.state.get<SyncBase | undefined>(BASE_KEY, undefined);
    // another location has nothing in common with the last sync: merge, never delete
    const base = savedBase?.location === location ? savedBase.hashes : {};

    const actions = planSync(local, remote, base, now);
    let changedOnDisk = false;
    for (const action of actions) {
      const full = path.join(location, ...action.path.split("/"));
      // a synced path never leaves the notes location
      if (!isWithin(full, location) || full === location) {
        continue;
      }
      switch (action.kind) {
        case "push":
          remote[action.path] = {
            content: action.content,
            updated: action.updated,
          };
          break;
        case "pushDelete":
          remote[action.path] = { deleted: true, updated: now.getTime() };
          break;
        case "write":
          await fs.promises.mkdir(path.dirname(full), { recursive: true });
          await fs.promises.writeFile(full, action.content, "utf8");
          changedOnDisk = true;
          break;
        case "delete":
          await fs.promises.rm(full, { force: true });
          changedOnDisk = true;
          break;
      }
    }

    // forget deleted notes after a while
    const oldest = now.getTime() - TOMBSTONE_DAYS * 24 * 60 * 60 * 1000;
    for (const [notePath, note] of Object.entries(remote)) {
      if (note.deleted && note.updated < oldest) {
        delete remote[notePath];
      }
    }

    const hashes: Record<string, string> = {};
    for (const [notePath, note] of Object.entries(remote)) {
      if (!note.deleted) {
        hashes[notePath] = hashContent(note.content ?? "");
      }
    }

    if (
      actions.some(
        (action) => action.kind === "push" || action.kind === "pushDelete",
      )
    ) {
      await this.state.update(SYNC_KEY, remote);
    }
    await this.state.update(BASE_KEY, { location, hashes } as SyncBase);
    if (changedOnDisk) {
      this.onChanged();
    }
  }

  dispose(): void {
    clearInterval(this.interval);
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }
}
