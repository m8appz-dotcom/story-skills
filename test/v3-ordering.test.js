import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { replaceFrontmatter } from "../src/frontmatter.js";
import { checkEpistemicGraph } from "../src/epistemic.js";
import { checkStateSnapshots } from "../src/state.js";
import {
  acceptCandidate,
  createCandidate,
  createEntity,
  createStoryProject,
  knowledgeReport,
  scanProject,
  stateReport
} from "../src/story.js";
import { makeTempDir, writeMarkdown } from "./helpers.js";

// Sorting only happens with something to sort. A delta carrying one of each
// never exercises the comparators that keep committed records in a stable
// order, so this suite carries two of everything.

function seed(title) {
  const cwd = makeTempDir();
  const root = createStoryProject({ cwd, title, force: false }).root;

  for (const name of ["Sarah", "Robert"]) {
    createEntity(root, { kind: "character", name, role: name === "Sarah" ? "protagonist" : "antagonist" });
  }
  for (const name of ["Harbor House", "The Pier"]) {
    createEntity(root, { kind: "location", name, type: "building" });
  }
  for (const name of ["Silver Key", "Brass Ledger"]) {
    createEntity(root, { kind: "artifact", name, type: "object" });
  }
  for (const name of ["The rope was cut", "A door was left open"]) {
    createEntity(root, { kind: "fact", name, "established-in": "pre-story" });
  }
  for (const name of ["The rope will matter", "The ledger will name someone"]) {
    createEntity(root, { kind: "promise", name });
  }
  for (const name of ["Who cut the rope", "Who opened the door"]) {
    createEntity(root, { kind: "question", name });
  }
  createEntity(root, { kind: "relationship", name: "Pair", character: ["sarah", "robert"] });
  // A faction, so the owner checks that scan factions actually iterate one.
  createEntity(root, { kind: "faction", name: "Harbor Watch", type: "government", member: "sarah" });
  createEntity(root, { kind: "system", name: "Reciprocity", type: "custom" });

  return root;
}

function accept(root, chapter, number, data) {
  const result = createCandidate(root, { chapter, title: `Chapter ${number}`, number, pov: "sarah" });
  const scaffolded = scanProject(root).candidates.find((item) => item.file === result.file);
  const merged = { ...scaffolded.rawData, number, ...data };
  fs.writeFileSync(result.file,
    `${replaceFrontmatter(scaffolded.rawMarkdown, merged).split("## Chapter Text")[0]}## Chapter Text\n\nWords for ${chapter}.\n`,
    "utf8");
  return acceptCandidate(root, { chapter, candidate: result.candidate });
}

describe("committed records keep a stable order", () => {
  test("sorts two of everything in one delta", () => {
    const root = seed("Two Of Everything");

    accept(root, "chapter-01", 1, {
      "story-time": { date: "day one", time: "dawn", elapsed: "" },
      // Deliberately reverse-alphabetical going in.
      "state-characters": [
        { id: "sarah", location: "the-pier", emotional: "guarded" },
        { id: "robert", location: "harbor-house", emotional: "careful" }
      ],
      "state-objects": [
        { id: "silver-key", owner: "sarah", status: "active" },
        { id: "brass-ledger", owner: "robert", status: "hidden" }
      ],
      "state-relationships": [{ id: "robert-sarah", trust: "low" }],
      "knowledge-delta": [
        { character: "sarah", fact: "the-rope-was-cut", status: "suspects", "learned-in": "chapter-01" },
        { character: "sarah", fact: "a-door-was-left-open", status: "knows", "learned-in": "chapter-01" }
      ],
      "promise-delta": [
        { promise: "the-rope-will-matter", status: "planted", planted: "chapter-01" },
        { promise: "the-ledger-will-name-someone", status: "planted", planted: "chapter-01" }
      ],
      "question-delta": [
        { question: "who-cut-the-rope", status: "open", introduced: "chapter-01" },
        { question: "who-opened-the-door", status: "open", introduced: "chapter-01" }
      ],
      "active-threads": ["the-rope", "the-door"]
    });

    const snapshot = stateReport(root).snapshot;
    expect(snapshot.characters.map((entry) => entry.id)).toEqual(["robert", "sarah"]);
    expect(snapshot.objects.map((entry) => entry.id)).toEqual(["brass-ledger", "silver-key"]);

    // One record per character, its facts in a stable order.
    const sarah = knowledgeReport(root, { character: "sarah" }).records[0];
    expect(sarah.facts.map((entry) => entry.fact)).toEqual(["a-door-was-left-open", "the-rope-was-cut"]);

    const project = scanProject(root);
    expect(project.promises.every((promise) => promise.status === "planted")).toBe(true);
    expect(project.questions.every((question) => question.introduced === "chapter-01")).toBe(true);
  });

  test("merges a second delta into a snapshot that already holds two of each", () => {
    const root = seed("Merge Into Two");

    accept(root, "chapter-01", 1, {
      "story-time": { date: "day one", time: "dawn", elapsed: "" },
      "state-characters": [
        { id: "sarah", location: "the-pier" },
        { id: "robert", location: "harbor-house" }
      ],
      "state-objects": [
        { id: "silver-key", owner: "sarah" },
        { id: "brass-ledger", owner: "robert" }
      ]
    });

    accept(root, "chapter-02", 2, {
      "state-characters": [{ id: "robert", location: "the-pier" }],
      "knowledge-delta": [
        { character: "robert", fact: "the-rope-was-cut", status: "knows", "learned-in": "chapter-02" }
      ]
    });

    const snapshot = stateReport(root).snapshot;
    expect(snapshot.characters).toHaveLength(2);
    // Sarah is carried forward untouched; Robert moved.
    expect(snapshot.characters.find((entry) => entry.id === "sarah").location).toBe("the-pier");
    expect(snapshot.characters.find((entry) => entry.id === "robert").location).toBe("the-pier");
    expect(snapshot.objects).toHaveLength(2);
  });
});

describe("checks over projects holding several of each record", () => {
  test("validates a knowledge record carrying several facts", () => {
    const root = seed("Several Facts");
    writeMarkdown(path.join(root, "continuity", "knowledge", "sarah.md"), [
      "type: knowledge-record",
      "character: sarah",
      "facts:",
      "  - fact: the-rope-was-cut",
      "    status: knows",
      "    learned-in: pre-story",
      "  - fact: a-door-was-left-open",
      "    status: suspects",
      "    learned-in: pre-story",
      "    confidence: low"
    ].join("\n"), "# Knowledge\n");

    expect(checkEpistemicGraph(scanProject(root)).errors).toEqual([]);
  });

  test("validates a snapshot chain several links long", () => {
    const root = seed("Several Snapshots");
    for (const number of [1, 2, 3]) {
      createEntity(root, { kind: "chapter", name: `Chapter ${number}`, number });
      writeMarkdown(path.join(root, "continuity", "state", `chapter-0${number}.md`), [
        "type: state-snapshot",
        `chapter: chapter-0${number}`,
        `sequence: ${number}`,
        "characters:",
        "  - id: sarah",
        "    location: the-pier",
        "  - id: robert",
        "    location: harbor-house"
      ].join("\n"), "# Snapshot\n");
    }

    writeMarkdown(path.join(root, "continuity", "state", "current.md"), [
      "type: state-current",
      "chapter: chapter-03",
      "sequence: 3",
      "source: chapter-03.md"
    ].join("\n"), "# Current\n");

    expect(checkStateSnapshots(scanProject(root)).errors).toEqual([]);
    expect(stateReport(root, { character: "sarah" }).trajectory).toHaveLength(1);
  });
});
