import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { commitWrites, createStoryProject } from "../src/story.js";
import { makeTempDir } from "./helpers.js";

// Phase B, driven directly. Acceptance cannot reach a mid-write failure — the
// scan and the capture pass refuse a malformed project before the first write —
// so the recovery this promises is only provable from here.

function project(title) {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title, force: false }).root;
}

describe("transactional commit", () => {
  test("applies every write and reports what it touched", () => {
    const root = project("All Or Nothing");
    const first = path.join(root, "continuity", "facts", "one.md");
    const second = path.join(root, "continuity", "facts", "two.md");

    const written = commitWrites(root, [
      { file: first, contents: "one" },
      { file: second, contents: "two" }
    ]);

    expect(written).toEqual([first, second]);
    expect(fs.readFileSync(first, "utf8")).toBe("one");
    expect(fs.readFileSync(second, "utf8")).toBe("two");
  });

  test("removes files it created when a later write fails", () => {
    const root = project("Rollback New");
    const created = path.join(root, "continuity", "facts", "created.md");

    // A file where a directory belongs: nothing to capture, and the write fails
    // trying to create the parent.
    const blocker = path.join(root, "continuity", "facts", "blocked");
    fs.writeFileSync(blocker, "not a directory", "utf8");
    const doomed = path.join(blocker, "inside.md");

    expect(() => commitWrites(root, [
      { file: created, contents: "written first" },
      { file: doomed, contents: "never lands" }
    ])).toThrow();

    // The first write is gone again: it did not exist before, so recovery is
    // removal, not restoration.
    expect(fs.existsSync(created)).toBe(false);
  });

  test("restores files it overwrote when a later write fails", () => {
    const root = project("Rollback Existing");
    const existing = path.join(root, "continuity", "facts", "existing.md");
    fs.writeFileSync(existing, "the original bytes", "utf8");

    const blocker = path.join(root, "continuity", "facts", "blocked");
    fs.writeFileSync(blocker, "not a directory", "utf8");

    expect(() => commitWrites(root, [
      { file: existing, contents: "the replacement" },
      { file: path.join(blocker, "inside.md"), contents: "never lands" }
    ])).toThrow();

    // Byte-for-byte what it was, not merely present.
    expect(fs.readFileSync(existing, "utf8")).toBe("the original bytes");
  });

  test("leaves untouched anything the failure never reached", () => {
    const root = project("Untouched");
    const untouched = path.join(root, "continuity", "facts", "later.md");

    const blocker = path.join(root, "continuity", "facts", "blocked");
    fs.writeFileSync(blocker, "not a directory", "utf8");

    expect(() => commitWrites(root, [
      { file: path.join(blocker, "inside.md"), contents: "fails first" },
      { file: untouched, contents: "never attempted" }
    ])).toThrow();

    expect(fs.existsSync(untouched)).toBe(false);
  });
});
