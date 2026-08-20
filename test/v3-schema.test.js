import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter, stringifyFrontmatter } from "../src/frontmatter.js";
import {
  checkProjectContinuity,
  createEntity,
  createStoryProject,
  knowledgeReport,
  migrateProject,
  recordKnowledge,
  scanProject,
  stateReport,
  validateProject
} from "../src/story.js";
import { makeTempDir, writeMarkdown } from "./helpers.js";

// Builds a project, downgrades it to v2, and optionally seeds v2 durable state.
// This is the fixture the migration tests exercise.
function makeV2Project(title, knowledgeState = "") {
  const cwd = makeTempDir();
  const created = createStoryProject({ cwd, title, force: false });
  const storyPath = path.join(created.root, "story.md");
  fs.writeFileSync(
    storyPath,
    fs.readFileSync(storyPath, "utf8").replace("schema-version: 3", "schema-version: 2"),
    "utf8"
  );

  if (knowledgeState) {
    const statePath = path.join(created.root, "continuity", "state.md");
    fs.writeFileSync(
      statePath,
      fs.readFileSync(statePath, "utf8").replace("knowledge-state: []", knowledgeState),
      "utf8"
    );
  }

  return created;
}

function makeV3Project(title) {
  const created = makeV2Project(title);
  migrateProject(created.root);
  return created;
}

function errorText(result) {
  return result.errors.join("\n");
}

describe("frontmatter nested mappings", () => {
  test("parses a nested block mapping into an object", () => {
    const parsed = parseFrontmatter("---\nstory-time:\n  date: 1891-04-02\n  time: dawn\n---\nbody");
    expect(parsed.data["story-time"]).toEqual({ date: "1891-04-02", time: "dawn" });
  });

  test("round-trips mappings, lists of objects, and empty values together", () => {
    const data = {
      id: "chapter-01",
      "story-time": { date: "1891-04-02", elapsed: "3 days" },
      characters: [{ id: "sarah", location: "pier" }],
      tags: [],
      blank: ""
    };

    expect(parseFrontmatter(`${stringifyFrontmatter(data)}body`).data).toEqual(data);
  });

  test("keeps an empty mapping distinct from an empty list", () => {
    const rendered = stringifyFrontmatter({ state: {}, tags: [] });
    expect(rendered).toContain("state: {}");
    expect(rendered).toContain("tags: []");

    const parsed = parseFrontmatter(`${rendered}body`).data;
    expect(parsed.state).toEqual({});
    expect(parsed.tags).toEqual([]);
  });

  test("refuses to serialize nesting deeper than one level", () => {
    expect(() => stringifyFrontmatter({ state: { inner: { deep: 1 } } }))
      .toThrow("Frontmatter mapping state.inner must be a scalar");
  });

  test("still parses v2 list-of-object frontmatter unchanged", () => {
    const parsed = parseFrontmatter("---\nrelationships:\n  - character: ada\n    type: sibling\n---\nbody");
    expect(parsed.data.relationships).toEqual([{ character: "ada", type: "sibling" }]);
  });
});

describe("v2 to v3 migration", () => {
  test("creates v3 directories and seeds the pre-story snapshot", () => {
    const created = makeV2Project("Migrate Layout");
    migrateProject(created.root);

    for (const relative of [
      path.join("continuity", "facts", "_index.md"),
      path.join("continuity", "knowledge", "_index.md"),
      path.join("continuity", "relationships", "_index.md"),
      path.join("continuity", "state", "_index.md"),
      path.join("continuity", "state", "chapter-00.md"),
      path.join("continuity", "state", "current.md")
    ]) {
      expect(fs.existsSync(path.join(created.root, relative))).toBe(true);
    }

    expect(scanProject(created.root).story.data["schema-version"]).toBe(3);
  });

  test("lifts v2 knowledge-state into facts and knowledge without inventing content", () => {
    const created = makeV2Project("Migrate Knowledge", [
      "knowledge-state:",
      "  - character: robert-vane",
      "    knows: Robert killed Elizabeth",
      "    learned-in: pre-story"
    ].join("\n"));
    createEntity(created.root, { kind: "character", name: "Robert Vane", role: "antagonist" });

    migrateProject(created.root);
    const project = scanProject(created.root);
    const fact = project.facts.find((item) => item.id === "robert-killed-elizabeth");

    // The exact authored wording survives, and truth is left for a human to decide.
    expect(fact.statement).toBe("Robert killed Elizabeth");
    expect(fact.truthStatus).toBe("undetermined");
    expect(fact.tags).toContain("needs-review");

    const record = project.knowledge.find((item) => item.character === "robert-vane");
    expect(record.facts).toEqual([{ fact: "robert-killed-elizabeth", status: "knows", "learned-in": "pre-story" }]);
  });

  test("does not propagate a chapter reference that already does not resolve", () => {
    // A v2 project may carry a broken reference. Copying it into the derived
    // fact and knowledge record would turn one authoring mistake into three
    // errors, two of them in files the author never wrote.
    const created = makeV2Project("Migrate Broken Reference", [
      "knowledge-state:",
      "  - character: robert-vane",
      "    knows: Which page names the firestarter",
      "    learned-in: chapter-99"
    ].join("\n"));
    createEntity(created.root, { kind: "character", name: "Robert Vane", role: "antagonist" });

    migrateProject(created.root);
    const project = scanProject(created.root);

    const fact = project.facts.find((item) => item.id === "which-page-names-the-firestarter");
    expect(fact.establishedIn).toBe("");

    const entry = project.knowledge.find((item) => item.character === "robert-vane").facts[0];
    expect(entry["learned-in"]).toBeUndefined();
    expect(entry.notes).toContain("could not resolve learned-in chapter-99");

    // Migration introduces no error of its own beyond the one already present.
    const errors = checkProjectContinuity(created.root).errors.join("\n");
    expect(errors).toContain("continuity");
    expect(errors).not.toContain("continuity/facts");
    expect(errors).not.toContain("continuity\\facts");
    expect(errors).not.toContain("continuity/knowledge");
    expect(errors).not.toContain("continuity\\knowledge");
  });

  test("carries a learned-in chapter forward when it does resolve", () => {
    const created = makeV2Project("Migrate Good Reference", [
      "knowledge-state:",
      "  - character: robert-vane",
      "    knows: The ledger was forged",
      "    learned-in: chapter-01"
    ].join("\n"));
    createEntity(created.root, { kind: "character", name: "Robert Vane", role: "antagonist" });
    createEntity(created.root, { kind: "chapter", name: "One", number: 1 });

    migrateProject(created.root);
    const entry = scanProject(created.root).knowledge
      .find((item) => item.character === "robert-vane").facts[0];

    expect(entry["learned-in"]).toBe("chapter-01");
    expect(entry.notes).toBeUndefined();
  });

  test("leaves chapter prose byte-for-byte identical", () => {
    const created = makeV2Project("Migrate Prose");
    const chapterPath = path.join(created.root, "chapters", "chapter-01.md");
    writeMarkdown(chapterPath, [
      "title: The Pier",
      "number: 1",
      "status: draft",
      "word-count: 9"
    ].join("\n"), "## Chapter Text\n\nThe tide came in and took the pier with it.\n");

    const before = fs.readFileSync(chapterPath, "utf8");
    migrateProject(created.root);
    expect(fs.readFileSync(chapterPath, "utf8")).toBe(before);
  });

  test("seeds provisional snapshots so a mid-draft project can accept chapters", () => {
    const created = makeV2Project("Migrate Mid Draft", [
      "knowledge-state: []",
      "character-state:",
      "  - character: jonas-reed",
      "    physical: smoke-scarred hands"
    ].join("\n"));
    createEntity(created.root, { kind: "character", name: "Jonas Reed", role: "protagonist" });
    for (const number of [1, 2, 3]) {
      createEntity(created.root, { kind: "chapter", name: `Chapter ${number}`, number });
    }

    migrateProject(created.root);
    const project = scanProject(created.root);

    // Gapless history, so the acceptance sequence check can be satisfied.
    expect(project.stateSnapshots.map((item) => item.sequence)).toEqual([0, 1, 2, 3]);
    expect(project.stateSnapshots.filter((item) => item.provisional).map((item) => item.chapter))
      .toEqual(["chapter-01", "chapter-02", "chapter-03"]);

    // v2 durable state is relocated onto the latest chapter, not invented onto all.
    const latest = project.stateSnapshots.at(-1);
    expect(latest.characters).toEqual([{ id: "jonas-reed", physical: "smoke-scarred hands" }]);
    expect(project.stateSnapshots[1].characters).toEqual([]);

    expect(project.currentState.data.chapter).toBe("chapter-03");
    expect(checkProjectContinuity(created.root).ok).toBe(true);
  });

  test("relocates recorded object state onto the latest chapter", () => {
    const created = makeV2Project("Migrate Objects", [
      "knowledge-state: []",
      "object-state:",
      "  - artifact: silver-key",
      "    owner: jonas-reed",
      "    location: the-mill-row",
      "    status: hidden"
    ].join("\n"));
    createEntity(created.root, { kind: "character", name: "Jonas Reed", role: "protagonist" });
    createEntity(created.root, { kind: "location", name: "The Mill Row", type: "settlement" });
    createEntity(created.root, { kind: "artifact", name: "Silver Key", type: "object", status: "hidden" });
    createEntity(created.root, { kind: "chapter", name: "One", number: 1 });

    migrateProject(created.root);
    const latest = scanProject(created.root).stateSnapshots.at(-1);

    // The v2 rows were real data, so they land on the chapter they described.
    expect(latest.objects).toEqual([
      { id: "silver-key", owner: "jonas-reed", location: "the-mill-row", status: "hidden" }
    ]);
  });

  test("collapses two legacy rows for the same character into one record", () => {
    const created = makeV2Project("Migrate Two Rows", [
      "knowledge-state:",
      "  - character: jonas-reed",
      "    knows: The mill was burned",
      "    learned-in: pre-story",
      "  - character: jonas-reed",
      "    knows: The ledger names a name",
      "    learned-in: pre-story",
      "  - character: jonas-reed",
      "    knows: The mill was burned"
    ].join("\n"));
    createEntity(created.root, { kind: "character", name: "Jonas Reed", role: "protagonist" });

    migrateProject(created.root);
    const project = scanProject(created.root);
    const record = project.knowledge.find((item) => item.character === "jonas-reed");

    // One record, one entry per fact: the repeated row is not tied twice.
    expect(project.knowledge).toHaveLength(1);
    expect(record.facts.map((entry) => entry.fact).sort()).toEqual([
      "the-ledger-names-a-name",
      "the-mill-was-burned"
    ]);
  });

  test("does not seed snapshots when chapter numbering has a gap", () => {
    const created = makeV2Project("Migrate Gap");
    createEntity(created.root, { kind: "chapter", name: "One", number: 1 });
    createEntity(created.root, { kind: "chapter", name: "Five", number: 5 });

    migrateProject(created.root);

    // Seeding would produce a gap in sequences, which is an error to fix first.
    expect(scanProject(created.root).stateSnapshots.map((item) => item.sequence)).toEqual([0]);
  });

  test("is idempotent", () => {
    const created = makeV2Project("Migrate Twice");
    migrateProject(created.root);
    expect(migrateProject(created.root).changed).toEqual([]);
  });

  test("keeps a v2 project valid without migrating it", () => {
    const created = makeV2Project("Still V2");
    expect(validateProject(created.root).ok).toBe(true);
    expect(scanProject(created.root).facts).toEqual([]);
  });
});

describe("epistemic graph", () => {
  function seedGraph(title) {
    const created = makeV3Project(title);
    createEntity(created.root, { kind: "character", name: "Sarah Vane", role: "protagonist" });
    createEntity(created.root, { kind: "character", name: "Robert Vane", role: "antagonist" });
    createEntity(created.root, {
      kind: "fact",
      name: "Robert killed Elizabeth",
      "truth-status": "true",
      "established-in": "pre-story"
    });
    return created;
  }

  test("accepts every legal epistemic status", () => {
    const created = seedGraph("Legal Statuses");
    for (const status of ["knows", "believes", "suspects", "doubts", "misbelieves"]) {
      recordKnowledge(created.root, {
        character: "sarah-vane",
        fact: "robert-killed-elizabeth",
        status,
        "learned-in": "pre-story"
      });
      expect(checkProjectContinuity(created.root).ok).toBe(true);
    }
  });

  test("rejects an unknown character, fact, status, and chapter", () => {
    const created = seedGraph("Bad References");
    const base = { character: "sarah-vane", fact: "robert-killed-elizabeth", status: "knows" };

    expect(() => recordKnowledge(created.root, { ...base, character: "nobody" })).toThrow("Unknown character: nobody");
    expect(() => recordKnowledge(created.root, { ...base, fact: "no-such-fact" })).toThrow("Unknown fact: no-such-fact");
    expect(() => recordKnowledge(created.root, { ...base, status: "vibes" })).toThrow("--status must be one of");
    expect(() => recordKnowledge(created.root, { ...base, "learned-in": "chapter-99" })).toThrow("Unknown chapter: chapter-99");
  });

  test("rejects a learned-in chapter ahead of the accepted state", () => {
    const created = seedGraph("Future Knowledge");
    // chapter-02 exists as canon, but accepted state has only reached pre-story.
    createEntity(created.root, { kind: "chapter", name: "Later", number: 2 });
    writeMarkdown(path.join(created.root, "continuity", "knowledge", "sarah-vane.md"), [
      "type: knowledge-record",
      "character: sarah-vane",
      "facts:",
      "  - fact: robert-killed-elizabeth",
      "    status: knows",
      "    learned-in: chapter-02"
    ].join("\n"), "# Knowledge\n");

    expect(errorText(checkProjectContinuity(created.root)))
      .toContain("is learned-in chapter-02, which is ahead of the current accepted state");
  });

  test("detects a contradictory duplicate entry for the same fact", () => {
    const created = seedGraph("Contradiction");
    writeMarkdown(path.join(created.root, "continuity", "knowledge", "sarah-vane.md"), [
      "type: knowledge-record",
      "character: sarah-vane",
      "facts:",
      "  - fact: robert-killed-elizabeth",
      "    status: knows",
      "    learned-in: pre-story",
      "  - fact: robert-killed-elizabeth",
      "    status: unknown"
    ].join("\n"), "# Knowledge\n");

    expect(errorText(checkProjectContinuity(created.root)))
      .toContain("contradicts an earlier entry for fact robert-killed-elizabeth: knows then unknown");
  });

  test("rejects a status of unknown that also claims a learned-in chapter", () => {
    const created = seedGraph("Unknown With Source");
    expect(() => recordKnowledge(created.root, {
      character: "sarah-vane",
      fact: "robert-killed-elizabeth",
      status: "unknown",
      "learned-in": "pre-story"
    })).toThrow("status unknown cannot record a learned-in chapter");
  });

  test("keeps a character's facts in a stable order as they are recorded", () => {
    const created = seedGraph("Ordered Knowledge");
    createEntity(created.root, { kind: "fact", name: "The rope was cut", "established-in": "pre-story" });

    // Recorded out of order; the record keeps them sorted so a diff stays small.
    recordKnowledge(created.root, {
      character: "sarah-vane", fact: "the-rope-was-cut", status: "knows", "learned-in": "pre-story"
    });
    recordKnowledge(created.root, {
      character: "sarah-vane", fact: "robert-killed-elizabeth", status: "suspects", "learned-in": "pre-story"
    });

    const record = scanProject(created.root).knowledge.find((item) => item.character === "sarah-vane");
    expect(record.facts.map((entry) => entry.fact)).toEqual([
      "robert-killed-elizabeth",
      "the-rope-was-cut"
    ]);
  });

  test("reports what a single character knows", () => {
    const created = seedGraph("Knowledge Report");
    recordKnowledge(created.root, {
      character: "robert-vane",
      fact: "robert-killed-elizabeth",
      status: "knows",
      "learned-in": "pre-story"
    });

    const report = knowledgeReport(created.root, { character: "robert-vane" });
    expect(report.records).toHaveLength(1);
    expect(report.records[0].facts[0]).toMatchObject({
      fact: "robert-killed-elizabeth",
      status: "knows",
      statement: "Robert killed Elizabeth"
    });
  });
});

describe("state snapshots", () => {
  function snapshot(root, id, frontmatter) {
    writeMarkdown(path.join(root, "continuity", "state", `${id}.md`), frontmatter.join("\n"), "# Snapshot\n");
  }

  test("detects a gap in the snapshot sequence", () => {
    const created = makeV3Project("Sequence Gap");
    createEntity(created.root, { kind: "chapter", name: "One", number: 1 });
    createEntity(created.root, { kind: "chapter", name: "Two", number: 2 });
    snapshot(created.root, "chapter-02", ["type: state-snapshot", "chapter: chapter-02", "sequence: 2"]);

    expect(errorText(checkProjectContinuity(created.root)))
      .toContain("sequence 2 skips 1; state history has a gap");
  });

  test("detects a snapshot for a chapter that is not canon", () => {
    const created = makeV3Project("Orphan Snapshot");
    snapshot(created.root, "chapter-01", ["type: state-snapshot", "chapter: chapter-01", "sequence: 1"]);

    expect(errorText(checkProjectContinuity(created.root)))
      .toContain("a snapshot may only exist for a canonical chapter");
  });

  test("detects a current pointer that lags the latest snapshot", () => {
    const created = makeV3Project("Stale Pointer");
    createEntity(created.root, { kind: "chapter", name: "One", number: 1 });
    snapshot(created.root, "chapter-01", ["type: state-snapshot", "chapter: chapter-01", "sequence: 1"]);
    // current.md still points at the pre-story snapshot.

    expect(errorText(checkProjectContinuity(created.root)))
      .toContain("is not the latest accepted chapter chapter-01");
  });

  test("warns when a canonical chapter has no snapshot", () => {
    const created = makeV3Project("Missing Snapshot");
    createEntity(created.root, { kind: "chapter", name: "One", number: 1 });

    expect(checkProjectContinuity(created.root).warnings.join("\n"))
      .toContain("is canonical but has no state snapshot");
  });

  test("reindex points current.md at the latest snapshot", () => {
    const created = makeV3Project("Pointer Refresh");
    createEntity(created.root, { kind: "chapter", name: "One", number: 1 });
    snapshot(created.root, "chapter-01", ["type: state-snapshot", "chapter: chapter-01", "sequence: 1"]);

    // createEntity reindexes, which regenerates the pointer.
    createEntity(created.root, { kind: "character", name: "Pointer Nudge", role: "minor" });
    const report = stateReport(created.root);
    expect(report.snapshot.id).toBe("chapter-01");
    expect(report.history).toHaveLength(2);
  });

  test("exposes an ordered history and a chapter lookup", () => {
    const created = makeV3Project("History");
    createEntity(created.root, { kind: "chapter", name: "One", number: 1 });
    snapshot(created.root, "chapter-01", ["type: state-snapshot", "chapter: chapter-01", "sequence: 1"]);

    expect(stateReport(created.root, { chapter: "chapter-01" }).snapshot.sequence).toBe(1);
    expect(stateReport(created.root).history.map((item) => item.sequence)).toEqual([0, 1]);
    expect(() => stateReport(created.root, { chapter: "chapter-09" })).toThrow("No state snapshot for chapter-09");
  });
});

describe("relationships", () => {
  test("creates a relationship keyed by sorted participants", () => {
    const created = makeV3Project("Relationship Id");
    createEntity(created.root, { kind: "character", name: "Sarah Vane", role: "protagonist" });
    createEntity(created.root, { kind: "character", name: "Robert Vane", role: "antagonist" });

    const result = createEntity(created.root, {
      kind: "relationship",
      name: "Sarah and Robert",
      character: ["sarah-vane", "robert-vane"]
    });

    expect(result.id).toBe("robert-vane-sarah-vane");
    expect(checkProjectContinuity(created.root).ok).toBe(true);
  });

  test("rejects fewer than two participants", () => {
    const created = makeV3Project("Lonely Relationship");
    createEntity(created.root, { kind: "character", name: "Sarah Vane", role: "protagonist" });

    expect(() => createEntity(created.root, {
      kind: "relationship",
      name: "Only Sarah",
      character: ["sarah-vane"]
    })).toThrow("A relationship needs at least two --character values");
  });

  test("rejects a participant who is not a character", () => {
    const created = makeV3Project("Ghost Participant");
    createEntity(created.root, { kind: "character", name: "Sarah Vane", role: "protagonist" });
    writeMarkdown(path.join(created.root, "continuity", "relationships", "ghost-sarah-vane.md"), [
      "type: relationship",
      "id: ghost-sarah-vane",
      "participants:",
      "  - ghost",
      "  - sarah-vane"
    ].join("\n"), "# Relationship\n");

    expect(errorText(checkProjectContinuity(created.root))).toContain("references missing character ghost");
  });

  test("detects two files describing the same pair", () => {
    const created = makeV3Project("Duplicate Pair");
    createEntity(created.root, { kind: "character", name: "Sarah Vane", role: "protagonist" });
    createEntity(created.root, { kind: "character", name: "Robert Vane", role: "antagonist" });

    for (const id of ["robert-vane-sarah-vane", "sarah-and-robert"]) {
      writeMarkdown(path.join(created.root, "continuity", "relationships", `${id}.md`), [
        "type: relationship",
        `id: ${id}`,
        "participants:",
        "  - robert-vane",
        "  - sarah-vane"
      ].join("\n"), "# Relationship\n");
    }

    expect(errorText(checkProjectContinuity(created.root))).toContain("duplicates the participants of");
  });
});
