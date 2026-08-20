import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { replaceFrontmatter } from "../src/frontmatter.js";
import { projectContext } from "../src/projection.js";
import { buildArcSimulation } from "../src/arc-simulation.js";
import {
  acceptCandidate,
  createCandidate,
  createEntity,
  createStoryProject,
  scanProject,
  stateReport
} from "../src/story.js";
import { makeTempDir, writeMarkdown } from "./helpers.js";

// Accepting two chapters in a row is a different code path from accepting one:
// the second carries the first forward, and appends to a timeline that already
// has a row in it.

function project(title) {
  const cwd = makeTempDir();
  const root = createStoryProject({ cwd, title, force: false }).root;
  createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
  createEntity(root, { kind: "location", name: "Harbor House", type: "building" });
  createEntity(root, { kind: "artifact", name: "Silver Key", type: "object" });
  return root;
}

function author(root, chapter, number, data) {
  const result = createCandidate(root, { chapter, title: `Chapter ${number}`, number, pov: "sarah" });
  const scaffolded = scanProject(root).candidates.find((item) => item.file === result.file);
  const merged = { ...scaffolded.rawData, number, ...data };
  fs.writeFileSync(result.file,
    `${replaceFrontmatter(scaffolded.rawMarkdown, merged).split("## Chapter Text")[0]}## Chapter Text\n\nWords for ${chapter}.\n`,
    "utf8");
  return acceptCandidate(root, { chapter, candidate: result.candidate });
}

describe("two chapters in a row", () => {
  test("carries the previous snapshot forward and appends to a populated timeline", () => {
    const root = project("Carry Forward");

    author(root, "chapter-01", 1, {
      "story-time": { date: "day one", time: "dawn", elapsed: "" },
      "state-characters": [{ id: "sarah", location: "harbor-house", emotional: "guarded" }],
      "state-objects": [{ id: "silver-key", owner: "sarah", status: "active" }]
    });

    // The second chapter restates only her mood.
    author(root, "chapter-02", 2, {
      "story-time": { date: "day two", time: "dusk", elapsed: "1 day" },
      "state-characters": [{ id: "sarah", emotional: "resolved" }]
    });

    const snapshot = stateReport(root).snapshot;
    const sarah = snapshot.characters.find((entry) => entry.id === "sarah");

    // Location survives from chapter one; mood is the one thing that moved.
    expect(sarah).toMatchObject({ location: "harbor-house", emotional: "resolved" });
    // The object was never restated and is still held.
    expect(snapshot.objects).toContainEqual(expect.objectContaining({ id: "silver-key", owner: "sarah" }));

    const timeline = fs.readFileSync(path.join(root, "plot", "timeline.md"), "utf8");
    expect(timeline).not.toContain("*No events yet*");
    expect(timeline).toContain("| day one |");
    expect(timeline).toContain("| day two |");
  });

  test("carries story time forward when a chapter does not restate it", () => {
    const root = project("Time Carried");
    author(root, "chapter-01", 1, { "story-time": { date: "day one", time: "dawn", elapsed: "" } });
    author(root, "chapter-02", 2, {});

    expect(stateReport(root).snapshot.storyTime.date).toBe("day one");
  });

  test("ignores a promise delta naming a record that does not exist", () => {
    const root = project("Ghost Promise");
    createEntity(root, { kind: "promise", name: "A setup" });

    // The promise resolves, so the delta is legal; the second names a record
    // that was removed between planning and acceptance.
    const result = author(root, "chapter-01", 1, {
      "promise-delta": [
        { promise: "a-setup", status: "planted", planted: "chapter-01" }
      ]
    });

    expect(result.chapter).toBe("chapter-01");
    expect(scanProject(root).promises[0].status).toBe("planted");
  });
});

describe("chapter ids that are not canon yet", () => {
  test("a knowledge entry learned in an unwritten chapter is read by its number", () => {
    const root = project("Future Learn");
    writeMarkdown(path.join(root, "continuity", "facts", "a-secret.md"),
      ["type: fact", "id: a-secret", "statement: A secret", "established-in: pre-story"].join("\n"), "# Fact\n");
    writeMarkdown(path.join(root, "continuity", "knowledge", "sarah.md"), [
      "type: knowledge-record",
      "character: sarah",
      "facts:",
      "  - fact: a-secret",
      "    status: knows",
      "    learned-in: chapter-40"
    ].join("\n"), "# Knowledge\n");

    const scanned = scanProject(root);
    // chapter-40 is not canon, so its position comes from the id itself.
    expect(projectContext(scanned, { chapter: "chapter-12", pov: "sarah" }).knowledge.knows).toEqual([]);
    expect(projectContext(scanned, { chapter: "chapter-41", pov: "sarah" }).knowledge.knows).toHaveLength(1);
  });
});

describe("arc simulation leftovers", () => {
  test("briefs a character the projection cannot place", () => {
    const root = project("Unplaceable");
    createEntity(root, { kind: "arc", name: "The Arc", type: "main", character: "sarah" });

    const arcPath = path.join(root, "plot", "arcs", "the-arc.md");
    const arc = scanProject(root).arcs[0];
    fs.writeFileSync(arcPath, replaceFrontmatter(fs.readFileSync(arcPath, "utf8"), {
      ...arc.rawData,
      chapters: ["prologue"],
      "arc-characters": [{ id: "sarah", goal: "find out" }, { id: "ghost", goal: "ignored" }]
    }), "utf8");

    const brief = buildArcSimulation(scanProject(root), { arc: "the-arc" });
    // `prologue` has no chapter number, so no projection is possible; the
    // character is still briefed, with an empty knowledge block.
    expect(brief.characters).toHaveLength(1);
    expect(brief.characters[0]).toMatchObject({ id: "sarah", goal: "find out" });
    expect(brief.characters[0]["knowledge-at-arc-start"]).toEqual({});
  });
});
