import * as path from "path";

// '~' expands to the home folder, for noteflow.folder
export function expandHome(folder: string, home: string): string {
  if (folder === "~") {
    return home;
  }
  if (folder.startsWith("~/") || folder.startsWith("~\\")) {
    return path.join(home, folder.slice(2));
  }
  return folder;
}

// noteflow.fileTypes is '*' or a comma separated list of extensions, without the dot
export function isAllowedFile(name: string, fileTypes: string): boolean {
  if (name.startsWith(".")) {
    return false;
  }
  const spec = fileTypes.trim();
  if (spec === "" || spec === "*") {
    return true;
  }
  const ext = path.extname(name).slice(1).toLowerCase();
  const allowed = spec
    .split(",")
    .map((entry) => entry.trim().replace(/^\./, "").toLowerCase())
    .filter(Boolean);
  return allowed.includes(ext);
}

// noteflow.newNoteName tokens: {yyyy} {mm} {dd} {HH} {MM}
export function applyNameTemplate(template: string, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return template
    .replace(/\{yyyy\}/g, String(now.getFullYear()))
    .replace(/\{mm\}/g, pad(now.getMonth() + 1))
    .replace(/\{dd\}/g, pad(now.getDate()))
    .replace(/\{HH\}/g, pad(now.getHours()))
    .replace(/\{MM\}/g, pad(now.getMinutes()));
}

// adds noteflow.defaultExtension when the typed name has none
export function ensureExtension(
  name: string,
  defaultExtension: string,
): string {
  if (path.extname(name)) {
    return name;
  }
  const ext = defaultExtension.replace(/^\./, "");
  return ext ? `${name}.${ext}` : name;
}

// names with path separators are refused
export function hasPathSeparator(name: string): boolean {
  return name.includes("/") || name.includes("\\");
}

export interface SortableEntry {
  name: string;
  isFolder: boolean;
  modified: number;
  created: number;
}

// folders first, then files, ordered by noteflow.sort
export function compareEntries(
  sort: string,
  a: SortableEntry,
  b: SortableEntry,
): number {
  if (a.isFolder !== b.isFolder) {
    return a.isFolder ? -1 : 1;
  }
  switch (sort) {
    case "name-desc":
      return b.name.localeCompare(a.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    case "modified":
      return b.modified - a.modified;
    case "created":
      return b.created - a.created;
    default:
      return a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
  }
}

// up to 50 most recently opened notes, newest first
export function addRecent(
  recent: string[],
  notePath: string,
  limit = 50,
): string[] {
  return [notePath, ...recent.filter((p) => p !== notePath)].slice(0, limit);
}

export function removeRecent(recent: string[], notePath: string): string[] {
  return recent.filter((p) => p !== notePath);
}

// keeps a renamed/moved note's place in the recent list
export function renameRecent(
  recent: string[],
  from: string,
  to: string,
): string[] {
  return recent.map((p) => (p === from ? to : p));
}

// everything under a renamed/moved folder moves with it
export function renameRecentFolder(
  recent: string[],
  from: string,
  to: string,
): string[] {
  return recent.map((p) =>
    p === from || p.startsWith(from + "/") ? to + p.slice(from.length) : p,
  );
}
