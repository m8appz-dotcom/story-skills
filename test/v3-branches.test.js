import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { replaceFrontmatter } from "../src/frontmatter.js";
import { checkStateSnapshots, findSnapshot, resolveCurrentSnapshot } from "../src/state.js";
import { checkRelationships } from "../src/relationships.js";
import { checkEpistemicGraph } from "../src/epistemic.js";
import { checkArcs, checkCausalChains, constraintsForChapter } from "../src/arcs.js";
import { buildRenderPacket } from "../src/render-packet.js";
import { checkTransactions } from "../src/transactions.js";
import {
  createCandidate,
  createEntity,
  createStoryProject,
  formatKnowledgeReport,
  formatStateReport,
  knowledgeReport,
  scanProject,
  sealArc,
  stateReport
} from "../src/story.js";
import { makeTempDir, writeMarkdown } from "./helpers.js";

// Error and reporting branches that the happy-path suites never reach. The
// repository holds src/ at 100% line and function coverage, so every branch
// needs a case that says what it is for.

function project(title) {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title, force: false }).root;
}

function snapshot(root, id, frontmatter, body = "# Snapshot\n") {
  writeMarkdown(path.join(root, "continuity", "state", `${id}.md`), frontmatter.join("\n"), body);
}

function errorsOf(result) {
  return result.errors.join("\n");
}

// A scanned project is the input every pure checker takes.
function scan(root) {
  return scanProject(root);
}

describe("state report formatting", () => {
  test("says so when there is no snapshot at all", () => {
    const root = project("No Snapshots");
    fs.rmSync(path.join(root, "continuity", "state"), { recursive: true, force: true });
    expect(formatStateReport(stateReport(root))).toContain("No state snapshots yet");
  });

  test("prints story time, objects, relationships, threads and provisional status", () => {
    const root = project("Rich Snapshot");
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
    createEntity(root, { kind: "location", name: "Harbor House", type: "building" });
    createEntity(root, { kind: "artifact", name: "Silver Key", type: "object" });
    createEntity(root, { kind: "character", name: "Robert", role: "antagonist" });
    createEntity(root, { kind: "relationship", name: "Pair", character: ["sarah", "robert"] });
    createEntity(root, { kind: "chapter", name: "One", number: 1 });

    snapshot(root, "chapter-01", [
      "type: state-snapshot",
      "chapter: chapter-01",
      "sequence: 1",
      "provisional: true",
      "story-time:",
      "  date: 1891-04-02",
      "  time: dusk",
      "characters:",
      "  - id: sarah",
      "    location: harbor-house",
      "    emotional: guarded",
      "objects:",
      "  - id: silver-key",
      "    owner: sarah",
      "relationships:",
      "  - id: robert-sarah",
      "    trust: low",
      "active-threads:",
      "  - sarah-suspects-robert"
    ]);

    const printed = formatStateReport(stateReport(root));
    expect(printed).toContain("Provisional: reconstructed at migration");
    expect(printed).toContain("Story time: date 1891-04-02, time dusk");
    expect(printed).toContain("Characters:");
    expect(printed).toContain("Objects:");
    expect(printed).toContain("Relationships:");
    expect(printed).toContain("Active threads: sarah-suspects-robert");
    expect(printed).toContain("1 provisional");

    const trajectory = formatStateReport(stateReport(root, { character: "sarah" }));
    expect(trajectory).toContain("Trajectory of sarah");
    expect(trajectory).toContain("emotional=guarded");
  });

  test("finds a snapshot by chapter, and resolves the latest", () => {
    const root = project("Lookups");
    const scanned = scan(root);
    expect(findSnapshot(scanned, "chapter-99")).toBeNull();
    expect(resolveCurrentSnapshot(scanned).id).toBe("chapter-00");
    expect(resolveCurrentSnapshot({ stateSnapshots: [] })).toBeNull();
  });
});

describe("knowledge report formatting", () => {
  test("says so when nothing is recorded", () => {
    expect(formatKnowledgeReport({ records: [] })).toContain("No knowledge records yet");
  });

  test("says so when a character holds nothing", () => {
    const root = project("Empty Record");
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
    createEntity(root, { kind: "knowledge", name: "sarah" });
    expect(formatKnowledgeReport(knowledgeReport(root))).toContain("(no tracked facts)");
  });
});

describe("snapshot ordering and contents", () => {
  test("rejects a non-integer sequence", () => {
    const root = project("Bad Sequence");
    snapshot(root, "chapter-01", ["type: state-snapshot", "chapter: chapter-01", "sequence: -2"]);
    expect(errorsOf(checkStateSnapshots(scan(root)))).toContain("sequence must be a non-negative integer");
  });

  test("rejects a duplicated sequence", () => {
    const root = project("Duplicate Sequence");
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    snapshot(root, "chapter-01", ["type: state-snapshot", "chapter: chapter-01", "sequence: 1"]);
    snapshot(root, "chapter-01b", ["type: state-snapshot", "chapter: chapter-01", "sequence: 1"]);
    expect(errorsOf(checkStateSnapshots(scan(root)))).toContain("duplicates or precedes an earlier snapshot");
  });

  test("rejects a history that does not start at zero", () => {
    const root = project("No Zero");
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    fs.rmSync(path.join(root, "continuity", "state", "chapter-00.md"));
    snapshot(root, "chapter-01", ["type: state-snapshot", "chapter: chapter-01", "sequence: 1"]);
    expect(errorsOf(checkStateSnapshots(scan(root)))).toContain("does not start at sequence 0");
  });

  test("rejects a pre-story snapshot that names a chapter", () => {
    const root = project("Named Pre Story");
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    snapshot(root, "chapter-00", ["type: state-snapshot", "chapter: chapter-01", "sequence: 0"]);
    expect(errorsOf(checkStateSnapshots(scan(root)))).toContain("must not name a chapter");
  });

  test("rejects a snapshot with no chapter, a second one, and a mismatched sequence", () => {
    const root = project("Binding");
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "chapter", name: "Two", number: 2 });

    snapshot(root, "chapter-01", ["type: state-snapshot", "chapter: \"\"", "sequence: 1"]);
    expect(errorsOf(checkStateSnapshots(scan(root)))).toContain("is missing chapter");

    snapshot(root, "chapter-01", ["type: state-snapshot", "chapter: chapter-01", "sequence: 1"]);
    snapshot(root, "chapter-01-again", ["type: state-snapshot", "chapter: chapter-01", "sequence: 2"]);
    expect(errorsOf(checkStateSnapshots(scan(root)))).toContain("is a second snapshot for chapter-01");

    fs.rmSync(path.join(root, "continuity", "state", "chapter-01-again.md"));
    snapshot(root, "chapter-02", ["type: state-snapshot", "chapter: chapter-02", "sequence: 2"]);
    snapshot(root, "chapter-01", ["type: state-snapshot", "chapter: chapter-02", "sequence: 1"]);
    expect(errorsOf(checkStateSnapshots(scan(root)))).toContain("does not match chapter number");
  });

  test("rejects unresolvable references inside a snapshot", () => {
    const root = project("Bad Contents");
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    snapshot(root, "chapter-01", [
      "type: state-snapshot",
      "chapter: chapter-01",
      "sequence: 1",
      "characters:",
      "  - id: nobody",
      "    location: nowhere",
      "objects:",
      "  - id: no-artifact",
      "    owner: nobody",
      "    location: nowhere",
      "relationships:",
      "  - trust: low"
    ]);

    const errors = errorsOf(checkStateSnapshots(scan(root)));
    expect(errors).toContain("references missing character nobody");
    expect(errors).toContain("references missing location nowhere");
    expect(errors).toContain("references missing artifact no-artifact");
    expect(errors).toContain("references missing owner nobody");
    expect(errors).toContain("is missing id");
  });

  test("rejects a non-mapping entry", () => {
    const root = project("Not A Mapping");
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    snapshot(root, "chapter-01", [
      "type: state-snapshot", "chapter: chapter-01", "sequence: 1",
      "characters:", "  - sarah"
    ]);
    expect(errorsOf(checkStateSnapshots(scan(root)))).toContain("must be a mapping");
  });

  test("rejects a current pointer with the wrong source, and a missing one", () => {
    const root = project("Pointer");
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    snapshot(root, "chapter-01", ["type: state-snapshot", "chapter: chapter-01", "sequence: 1"]);

    const currentPath = path.join(root, "continuity", "state", "current.md");
    writeMarkdown(currentPath, [
      "type: state-current",
      "chapter: chapter-01",
      "sequence: 1",
      "source: chapter-00.md"
    ].join("\n"), "# Current\n");
    expect(errorsOf(checkStateSnapshots(scan(root)))).toContain("source chapter-00.md is not chapter-01.md");

    fs.rmSync(currentPath);
    expect(errorsOf(checkStateSnapshots(scan(root)))).toContain("is missing; it must point at chapter-01");
  });

  test("rejects a current pointer with no snapshots behind it", () => {
    const root = project("Orphan Pointer");
    for (const name of fs.readdirSync(path.join(root, "continuity", "state"))) {
      if (name !== "current.md" && name !== "_index.md") {
        fs.rmSync(path.join(root, "continuity", "state", name));
      }
    }
    expect(errorsOf(checkStateSnapshots(scan(root)))).toContain("exists but there are no state snapshots");
  });
});

describe("relationship and epistemic branches", () => {
  test("rejects a relationship whose declared id disagrees with its filename", () => {
    const root = project("Declared Id");
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
    createEntity(root, { kind: "character", name: "Robert", role: "antagonist" });
    writeMarkdown(path.join(root, "continuity", "relationships", "robert-sarah.md"), [
      "type: relationship",
      "id: something-else",
      "participants:",
      "  - robert",
      "  - sarah"
    ].join("\n"), "# Relationship\n");

    expect(errorsOf(checkRelationships(scan(root)))).toContain("declares id something-else");
  });

  test("rejects a fact whose declared id disagrees, duplicates, or resolves early", () => {
    const root = project("Fact Branches");
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "chapter", name: "Two", number: 2 });

    writeMarkdown(path.join(root, "continuity", "facts", "a-fact.md"), [
      "type: fact",
      "id: another-id",
      "statement: A fact",
      "truth-status: sideways",
      "established-in: chapter-02",
      "resolved-in: chapter-01"
    ].join("\n"), "# Fact\n");

    const errors = errorsOf(checkEpistemicGraph(scan(root)));
    expect(errors).toContain("declares id another-id");
    expect(errors).toContain("truth-status sideways is not one of");
    expect(errors).toContain("resolves in chapter-01 before it is established in chapter-02");
  });

  test("rejects a fact with no statement and warns when it has no established-in", () => {
    const root = project("Bare Fact");
    writeMarkdown(path.join(root, "continuity", "facts", "bare.md"), [
      "type: fact",
      "statement: \"\""
    ].join("\n"), "# Fact\n");

    const result = checkEpistemicGraph(scan(root));
    expect(errorsOf(result)).toContain("is missing statement");
    expect(result.warnings.join("\n")).toContain("has no established-in chapter");
  });

  test("rejects a knowledge record that misnames its character or its entries", () => {
    const root = project("Knowledge Branches");
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
    createEntity(root, { kind: "fact", name: "A fact", "established-in": "pre-story" });

    writeMarkdown(path.join(root, "continuity", "knowledge", "sarah.md"), [
      "type: knowledge-record",
      "character: someone-else",
      "facts:",
      "  - fact: a-fact",
      "    status: knows",
      "    learned-in: pre-story",
      "    confidence: enormous",
      "  - fact: a-fact",
      "    status: knows",
      "  - status: knows"
    ].join("\n"), "# Knowledge\n");

    const errors = errorsOf(checkEpistemicGraph(scan(root)));
    expect(errors).toContain("declares character someone-else");
    expect(errors).toContain("confidence enormous is not one of");
    expect(errors).toContain("duplicates fact a-fact");
    expect(errors).toContain("references missing fact (unset)");
  });

  test("rejects an entry that is not a mapping, and one with no status", () => {
    const root = project("Entry Shapes");
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
    createEntity(root, { kind: "fact", name: "A fact", "established-in": "pre-story" });
    writeMarkdown(path.join(root, "continuity", "knowledge", "sarah.md"), [
      "type: knowledge-record",
      "character: sarah",
      "facts:",
      "  - a-fact",
      "  - fact: a-fact"
    ].join("\n"), "# Knowledge\n");

    const errors = errorsOf(checkEpistemicGraph(scan(root)));
    expect(errors).toContain("must be a mapping");
    expect(errors).toContain("is missing status");
  });
});

describe("arc branches", () => {
  function arcProject(title, plan) {
    const root = project(title);
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
    createEntity(root, { kind: "fact", name: "A secret", "established-in": "pre-story" });
    createEntity(root, { kind: "arc", name: "The Arc", type: "main", character: "sarah" });

    const arcPath = path.join(root, "plot", "arcs", "the-arc.md");
    const arc = scan(root).arcs[0];
    fs.writeFileSync(arcPath, replaceFrontmatter(fs.readFileSync(arcPath, "utf8"), { ...arc.rawData, ...plan }), "utf8");
    return root;
  }

  test("rejects a constraint that is not a mapping and one with no text", () => {
    const root = arcProject("Constraint Shapes", { "hard-constraints": ["just a string", { kind: "other" }] });
    const errors = errorsOf(checkArcs(scan(root)));
    expect(errors).toContain("must be a mapping");
    expect(errors).toContain("is missing constraint");
  });

  test("rejects a sealed plan whose arc is gone, and one with no version", () => {
    const root = arcProject("Sealed Orphan", {});
    writeMarkdown(path.join(root, "plot", "arcs", "sealed", "ghost-v1.md"), [
      "type: sealed-arc-plan",
      "arc: ghost-arc",
      "plan-version: 0"
    ].join("\n"), "# Sealed\n");

    const errors = errorsOf(checkArcs(scan(root)));
    expect(errors).toContain("seals arc ghost-arc, which no longer exists");
    expect(errors).toContain("must declare a positive plan-version");
  });

  test("rejects an arc pointing at a sealed version that does not exist", () => {
    const root = arcProject("Missing Sealed", { "sealed-version": "the-arc-v9" });
    expect(errorsOf(checkArcs(scan(root)))).toContain("derives from sealed plan the-arc-v9");
  });

  test("rejects a causal chain that is not a mapping, and duplicate arc characters", () => {
    const root = arcProject("Chain Shapes", {
      chapters: ["chapter-01"],
      "arc-characters": ["not a mapping", { id: "ghost" }],
      "causal-chain": ["also not a mapping"]
    });

    const errors = errorsOf(checkCausalChains(scan(root)));
    expect(errors).toContain("must be a mapping");
    expect(errors).toContain("references missing character ghost");
  });

  test("keeps a constraint with no expiry active at every chapter", () => {
    const root = arcProject("No Expiry", {
      chapters: ["chapter-01"],
      "hard-constraints": [{ constraint: "Always", kind: "other" }]
    });
    expect(constraintsForChapter(scan(root), "chapter-01", 1)).toHaveLength(1);
  });
});

describe("render packet branches", () => {
  function packetProject(title) {
    const root = project(title);
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
    createEntity(root, { kind: "character", name: "Robert", role: "antagonist" });
    createEntity(root, { kind: "chapter", name: "One", number: 1, character: ["sarah", "robert"], pov: "sarah" });
    return root;
  }

  test("carries misbeliefs as forbidden outcomes and a reveal budget", () => {
    const root = packetProject("Misbelief");
    createEntity(root, { kind: "fact", name: "The rope was cut", "established-in": "pre-story", "resolved-in": "chapter-01" });
    writeMarkdown(path.join(root, "continuity", "knowledge", "sarah.md"), [
      "type: knowledge-record",
      "character: sarah",
      "facts:",
      "  - fact: the-rope-was-cut",
      "    status: misbelieves",
      "    learned-in: pre-story"
    ].join("\n"), "# Knowledge\n");

    const packet = buildRenderPacket(scan(root), { chapter: "chapter-01", pov: "sarah" });
    expect(packet["hard-constraints"]["forbidden-outcomes"].join(" ")).toContain("must not discover that this is false");
    expect(packet["reveal-budget"][0].fact).toBe("the-rope-was-cut");
  });

  test("uses a scene contract and its soft beats when one exists", () => {
    const root = packetProject("Scene Contract");
    createEntity(root, { kind: "scene", name: "The Pier", chapter: "chapter-01", scene: 1, pov: "sarah" });
    const scenePath = path.join(root, "scenes", "chapter-01-scene-01.md");
    fs.writeFileSync(scenePath, fs.readFileSync(scenePath, "utf8").replace("status: outline", [
      "status: outline",
      "objective: Get inside",
      "opposition: The guard",
      "turn: He agrees",
      "exit-consequence: She owes him",
      "hard-constraints:",
      "  - The lantern stays lit",
      "soft-beats:",
      "  - the crown could be warm"
    ].join("\n")), "utf8");

    const packet = buildRenderPacket(scan(root), { chapter: "chapter-01", pov: "sarah", scene: 1 });
    expect(packet["scene-contract"].objective).toBe("Get inside");
    expect(packet["hard-constraints"]["continuity-requirements"]).toContain("The lantern stays lit");
    expect(packet["possible-beats"]).toContain("the crown could be warm");
  });

  test("says plainly when there is no scene record", () => {
    const packet = buildRenderPacket(scan(packetProject("No Scene")), { chapter: "chapter-01", pov: "sarah" });
    expect(packet["scene-contract"].note).toContain("No scene record found");
  });
});

describe("write-side refusals", () => {
  test("refuses to scaffold a candidate twice over the same file", () => {
    const root = project("Duplicate Candidate");
    createCandidate(root, { chapter: "chapter-01", title: "One" });
    // A file sitting on the next id without being a candidate itself: the
    // counter steps to candidate-002 and finds the name already taken.
    writeMarkdown(path.join(root, "work", "chapters", "chapter-01", "candidate-002.md"),
      "type: note", "# Not a candidate\n");
    expect(() => createCandidate(root, { chapter: "chapter-01", title: "One" })).toThrow("already exists");
  });

  test("refuses a candidate for a chapter id that is not kebab-case", () => {
    const root = project("Bad Chapter Id");
    expect(() => createCandidate(root, { chapter: "Chapter One" })).toThrow("must be a kebab-case id");
  });

  test("refuses to seal over an existing sealed file", () => {
    const root = project("Seal Collision");
    createEntity(root, { kind: "arc", name: "The Arc", type: "main" });
    // No plan-version, so it counts as version 0 and the next seal is v1 —
    // the name this file already occupies.
    writeMarkdown(path.join(root, "plot", "arcs", "sealed", "the-arc-v1.md"), [
      "type: sealed-arc-plan",
      "arc: the-arc"
    ].join("\n"), "# Sealed\n");

    expect(() => sealArc(root, { arc: "the-arc" })).toThrow("already exists");
  });
});

describe("transaction integrity branches", () => {
  test("rejects a transaction filed under the wrong chapter and one with no chapter", () => {
    const root = project("Transaction Shapes");
    fs.mkdirSync(path.join(root, "transactions"), { recursive: true });
    fs.writeFileSync(path.join(root, "transactions", "chapter-01.json"),
      JSON.stringify({ chapter: "chapter-02", "body-sha256": "x", "state-after": "chapter-01" }), "utf8");

    const errors = errorsOf(checkTransactions(scan(root)));
    expect(errors).toContain("records chapter chapter-02 but is filed as chapter-01");
    expect(errors).toContain("has no canonical chapter chapter-01");
  });

  test("rejects a transaction whose state-after has no snapshot", () => {
    const root = project("No Snapshot For After");
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const chapterPath = path.join(root, "chapters", "chapter-01.md");
    const prose = fs.readFileSync(chapterPath, "utf8");

    fs.mkdirSync(path.join(root, "transactions"), { recursive: true });
    fs.writeFileSync(path.join(root, "transactions", "chapter-01.json"), JSON.stringify({
      chapter: "chapter-01",
      "body-sha256": require("node:crypto").createHash("sha256")
        .update(prose.slice(prose.indexOf("## Chapter Text") + 15).replace(/\r\n/g, "\n").trim(), "utf8")
        .digest("hex"),
      "state-after": "chapter-01"
    }), "utf8");

    expect(errorsOf(checkTransactions(scan(root)))).toContain("state-after chapter-01 has no state snapshot");
  });
});
