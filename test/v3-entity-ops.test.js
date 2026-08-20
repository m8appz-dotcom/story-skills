import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  createEntity,
  createStoryProject,
  exportManuscript,
  formatDoctorReport,
  formatProjectReport,
  projectActions,
  projectReport,
  removeEntity,
  renameEntity,
  scanProject
} from "../src/story.js";
import { makeTempDir, writeMarkdown } from "./helpers.js";

// Entity operations against a project that actually references the entity being
// moved: renaming and removing only do interesting work when something points
// at the thing.

function project(title) {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title, force: false }).root;
}

describe("renaming and removing referenced entities", () => {
  test("rewrites every reference to a renamed character", () => {
    const root = project("Rename Referenced");
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
    createEntity(root, { kind: "location", name: "Harbor House", type: "building", character: ["sarah"] });
    createEntity(root, { kind: "chapter", name: "One", number: 1, character: ["sarah"], pov: "sarah" });
    createEntity(root, { kind: "arc", name: "The Arc", type: "main", character: ["sarah"] });

    const result = renameEntity(root, { kind: "character", id: "sarah", name: "Sarah Vane" });
    expect(result.id).toBe("sarah-vane");

    const scanned = scanProject(root);
    expect(scanned.chapters[0].characters).toContain("sarah-vane");
    expect(scanned.arcs[0].characters).toContain("sarah-vane");
    expect(scanned.locations[0].notableCharacters).toContain("sarah-vane");
  });

  test("scrubs every reference to a removed character", () => {
    const root = project("Remove Referenced");
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
    createEntity(root, { kind: "character", name: "Robert", role: "antagonist" });
    createEntity(root, { kind: "chapter", name: "One", number: 1, character: ["sarah", "robert"] });
    createEntity(root, { kind: "faction", name: "Harbor Watch", type: "government", member: ["sarah", "robert"] });

    removeEntity(root, { kind: "character", id: "robert" });

    const scanned = scanProject(root);
    expect(scanned.characters.map((item) => item.id)).toEqual(["sarah"]);
    expect(scanned.chapters[0].characters).toEqual(["sarah"]);
    expect(scanned.factions[0].members).toEqual(["sarah"]);
  });

  test("numbers a new scene after the ones the chapter already has", () => {
    const root = project("Scene Numbering");
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "scene", name: "Opening", chapter: "chapter-01", scene: 1, pov: "sarah" });
    createEntity(root, { kind: "scene", name: "Second", chapter: "chapter-01", scene: 2, pov: "sarah" });

    // No scene number given: it continues from the highest already recorded.
    const third = createEntity(root, { kind: "scene", name: "Third", chapter: "chapter-01", pov: "sarah" });
    expect(third.id).toBe("chapter-01-scene-03");
  });
});

describe("reports and exports over a populated project", () => {
  test("summarises a project that has one of everything", () => {
    const root = project("Populated");
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
    createEntity(root, { kind: "location", name: "Harbor House", type: "building" });
    createEntity(root, { kind: "system", name: "Reciprocity", type: "custom" });
    createEntity(root, { kind: "faction", name: "Harbor Watch", type: "government" });
    createEntity(root, { kind: "artifact", name: "Silver Key", type: "object" });
    createEntity(root, { kind: "arc", name: "The Arc", type: "main" });
    createEntity(root, { kind: "term", name: "Ember Burn", category: "concept" });
    createEntity(root, { kind: "question", name: "Who knows" });
    createEntity(root, { kind: "promise", name: "A setup" });

    writeMarkdown(path.join(root, "chapters", "chapter-01.md"),
      ["title: One", "number: 1", "status: draft", "word-count: 4", "pov: sarah"].join("\n"),
      "## Chapter Text\n\nFour words go here.\n");

    const report = formatProjectReport(projectReport(root), { actionable: true });
    expect(report).toContain("Glossary terms: 1");
    expect(report).toContain("Systems: 1");
    expect(report).toContain("Next Actions:");
  });

  test("reports health and repair steps together", () => {
    const root = project("Doctor");
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
    createEntity(root, { kind: "chapter", name: "One", number: 1, character: ["sarah"], pov: "sarah" });

    const doctor = formatDoctorReport(projectActions(root));
    expect(doctor).toContain("Story Doctor");
    expect(doctor).toContain("Checks:");
    expect(doctor).toContain("Validate:");
  });

  test("exports the chapters to a named file", () => {
    const root = project("Export Named");
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"),
      ["title: One", "number: 1", "status: draft", "word-count: 3"].join("\n"),
      "## Chapter Text\n\nThree words here.\n");
    writeMarkdown(path.join(root, "chapters", "chapter-02.md"),
      ["title: Two", "number: 2", "status: draft", "word-count: 3"].join("\n"),
      "## Chapter Text\n\nThree more words.\n");

    const result = exportManuscript(root, { out: "manuscript.md" });
    expect(result.chapters).toBe(2);
    expect(fs.readFileSync(result.outFile, "utf8")).toContain("Three more words");
  });
});
