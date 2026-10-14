import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { compareEntries, isAllowedFile } from "./notesLogic";

export type NoteKind = "folder" | "note-md" | "note";

export class NoteItem extends vscode.TreeItem {
  constructor(
    public readonly fullPath: string,
    public readonly relativePath: string,
    public readonly isFolder: boolean,
    public readonly rootLocation: string,
  ) {
    super(
      path.basename(fullPath),
      isFolder
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    this.resourceUri = vscode.Uri.file(fullPath);
    this.contextValue = isFolder
      ? "folder"
      : fullPath.toLowerCase().endsWith(".md")
        ? "note-md"
        : "note";
    if (!isFolder) {
      this.command = {
        command: "vscode.open",
        title: "Open Note",
        arguments: [this.resourceUri],
      };
    }
  }
}

// one tree view's worth of notes rooted at a single folder
export class NotesProvider
  implements vscode.TreeDataProvider<NoteItem>, vscode.Disposable
{
  private readonly emitter = new vscode.EventEmitter<NoteItem | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private watcher: vscode.FileSystemWatcher | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private visible = false;

  constructor(
    public readonly viewId: string,
    private getRoot: () => string | undefined,
    private fileTypes: () => string,
    private sort: () => string,
    private refreshSeconds: () => number,
  ) {
    this.watch();
  }

  root(): string | undefined {
    return this.getRoot();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.updatePolling();
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }

  // re-creates the watcher when the root folder changes
  watch(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
    const root = this.getRoot();
    if (root) {
      this.watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(root, "**/*"),
      );
      this.watcher.onDidCreate(() => this.scheduleRefresh());
      this.watcher.onDidDelete(() => this.scheduleRefresh());
      this.watcher.onDidChange(() => this.scheduleRefresh());
    }
    this.updatePolling();
  }

  private scheduleRefresh(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.refresh();
    }, 400);
  }

  private updatePolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    if (this.visible && this.getRoot()) {
      this.pollTimer = setInterval(
        () => this.scheduleRefresh(),
        this.refreshSeconds() * 1000,
      );
    }
  }

  getTreeItem(element: NoteItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: NoteItem): Promise<NoteItem[]> {
    const folder = element ? element.fullPath : this.getRoot();
    if (!folder) {
      return [];
    }
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(folder, { withFileTypes: true });
    } catch {
      return [];
    }

    const fileTypes = this.fileTypes();
    const items = await Promise.all(
      entries
        .filter((entry) => !entry.name.startsWith("."))
        .filter(
          (entry) =>
            entry.isDirectory() || isAllowedFile(entry.name, fileTypes),
        )
        .map(async (entry) => {
          const full = path.join(folder, entry.name);
          const stat = await fs.promises.stat(full);
          return {
            entry,
            full,
            stat,
            relative: element
              ? `${element.relativePath}/${entry.name}`
              : entry.name,
          };
        }),
    );

    const root = element ? element.rootLocation : folder;
    const sort = this.sort();
    items.sort((a, b) =>
      compareEntries(
        sort,
        {
          name: a.entry.name,
          isFolder: a.entry.isDirectory(),
          modified: a.stat.mtimeMs,
          created: a.stat.birthtimeMs,
        },
        {
          name: b.entry.name,
          isFolder: b.entry.isDirectory(),
          modified: b.stat.mtimeMs,
          created: b.stat.birthtimeMs,
        },
      ),
    );

    return items.map(
      ({ entry, full, relative }) =>
        new NoteItem(full, relative, entry.isDirectory(), root),
    );
  }

  // every note under this root, recursively, for Quick Open and Move To...
  async allEntries(): Promise<
    { fullPath: string; relativePath: string; isFolder: boolean }[]
  > {
    const root = this.getRoot();
    if (!root) {
      return [];
    }
    const results: {
      fullPath: string;
      relativePath: string;
      isFolder: boolean;
    }[] = [];
    const fileTypes = this.fileTypes();
    const walk = async (folder: string, relative: string) => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(folder, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith(".")) {
          continue;
        }
        const full = path.join(folder, entry.name);
        const rel = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          results.push({ fullPath: full, relativePath: rel, isFolder: true });
          await walk(full, rel);
        } else if (isAllowedFile(entry.name, fileTypes)) {
          results.push({ fullPath: full, relativePath: rel, isFolder: false });
        }
      }
    };
    await walk(root, "");
    return results;
  }

  dispose(): void {
    this.watcher?.dispose();
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.emitter.dispose();
  }
}
