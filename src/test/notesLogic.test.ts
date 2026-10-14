import * as assert from "assert";
import {
  addRecent,
  applyNameTemplate,
  compareEntries,
  ensureExtension,
  expandHome,
  hasPathSeparator,
  isAllowedFile,
  removeRecent,
  renameRecent,
  renameRecentFolder,
} from "../notesLogic";

suite("Notes Logic", () => {
  test("expandHome replaces a leading ~", () => {
    assert.strictEqual(expandHome("~", "/home/me"), "/home/me");
    assert.strictEqual(expandHome("~/notes", "/home/me"), "/home/me/notes");
    assert.strictEqual(expandHome("/abs/notes", "/home/me"), "/abs/notes");
  });

  test("isAllowedFile hides dotfiles and respects fileTypes", () => {
    assert.strictEqual(isAllowedFile(".hidden.md", "*"), false);
    assert.strictEqual(isAllowedFile("todo.md", "*"), true);
    assert.strictEqual(isAllowedFile("todo.md", "md,txt"), true);
    assert.strictEqual(isAllowedFile("todo.txt", "md"), false);
  });

  test("applyNameTemplate fills in date tokens", () => {
    const now = new Date("2026-01-05T09:03:00");
    assert.strictEqual(
      applyNameTemplate("{yyyy}-{mm}-{dd} {HH}{MM}", now),
      "2026-01-05 0903",
    );
  });

  test("ensureExtension only adds an extension when missing", () => {
    assert.strictEqual(ensureExtension("todo", "md"), "todo.md");
    assert.strictEqual(ensureExtension("todo.txt", "md"), "todo.txt");
  });

  test("hasPathSeparator detects both kinds of separator", () => {
    assert.strictEqual(hasPathSeparator("a/b"), true);
    assert.strictEqual(hasPathSeparator("a\\b"), true);
    assert.strictEqual(hasPathSeparator("ab"), false);
  });

  test("compareEntries puts folders first then sorts by name", () => {
    const file = (name: string) => ({
      name,
      isFolder: false,
      modified: 0,
      created: 0,
    });
    const folder = (name: string) => ({
      name,
      isFolder: true,
      modified: 0,
      created: 0,
    });
    assert.strictEqual(compareEntries("name", folder("z"), file("a")), -1);
    assert.ok(compareEntries("name", file("a"), file("b")) < 0);
    assert.ok(compareEntries("name-desc", file("a"), file("b")) > 0);
  });

  test("recent list keeps newest first and the newest instance when re-added", () => {
    let recent = addRecent([], "a.md");
    recent = addRecent(recent, "b.md");
    recent = addRecent(recent, "a.md");
    assert.deepStrictEqual(recent, ["a.md", "b.md"]);
    assert.deepStrictEqual(removeRecent(recent, "b.md"), ["a.md"]);
  });

  test("renaming updates the recent list, including notes inside a renamed folder", () => {
    assert.deepStrictEqual(renameRecent(["a.md", "b.md"], "a.md", "c.md"), [
      "c.md",
      "b.md",
    ]);
    assert.deepStrictEqual(
      renameRecentFolder(["dir/a.md", "other.md"], "dir", "dir2"),
      ["dir2/a.md", "other.md"],
    );
  });
});
