import { describe, expect, test } from "bun:test";
import { replaceFrontmatter } from "../src/frontmatter.js";
import { buildArcSimulation } from "../src/arc-simulation.js";
import { checkCausalChains } from "../src/arcs.js";
import fs from "node:fs";
import path from "node:path";
import {
  createEntity,
  createStoryProject,
  formatActionReport,
  migrateProject,
  projectActions,
  reindexProject,
  scanProject,
  validateLinks,
  validateProject
} from "../src/story.js";
import { makeTempDir, writeMarkdown } from "./helpers.js";

function project(title) {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title, force: false }).root;
}

describe("migration on projects missing their v2 furniture", () => {
  test("survives a project with no chapters directory", () => {
    const root = project("No Chapters Dir");
    fs.rmSync(path.join(root, "chapters"), { recursive: true, force: true });
    fs.rmSync(path.join(root, "continuity", "state"), { recursive: true, force: true });

    migrateProject(root);
    // The pre-story snapshot is seeded; nothing else can be, and nothing throws.
    expect(scanProject(root).stateSnapshots.map((item) => item.sequence)).toEqual([0]);
  });

  test("survives a project with no legacy state file", () => {
    const root = project("No Legacy State");
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    fs.rmSync(path.join(root, "continuity", "state.md"));
    fs.rmSync(path.join(root, "continuity", "state"), { recursive: true, force: true });

    migrateProject(root);
    const snapshots = scanProject(root).stateSnapshots;
    // The chapter still gets its provisional snapshot; it is simply empty,
    // because there was no recorded state to relocate into it.
    expect(snapshots.map((item) => item.sequence)).toEqual([0, 1]);
    expect(snapshots[1].characters).toEqual([]);
  });

  test("leaves the legacy pointer alone when there is nothing to point at", () => {
    const root = project("No Snapshot To Mirror");
    fs.rmSync(path.join(root, "continuity", "state"), { recursive: true, force: true });
    fs.mkdirSync(path.join(root, "continuity", "state"));

    // reindex has a state directory but no snapshot inside it.
    expect(reindexProject(root).changed.length).toBeGreaterThanOrEqual(0);
    expect(scanProject(root).continuity.data["current-chapter"]).toBe(0);
  });
});

describe("next actions on a broken project", () => {
  test("puts validation and continuity errors at the top", () => {
    const root = project("Broken");
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });

    // A scene pointing at a chapter that does not exist breaks links and
    // continuity at once, and a bad enum breaks validation.
    writeMarkdown(path.join(root, "scenes", "ghost-scene.md"), [
      "title: Ghost",
      "chapter: chapter-77",
      "scene: 1",
      "status: invalid-status"
    ].join("\n"), "# Scene\n");

    writeMarkdown(path.join(root, "continuity", "promises", "impossible.md"), [
      "title: Impossible",
      "status: paid-off",
      'planted: ""',
      'payoff: ""'
    ].join("\n"), "# Promise\n");

    expect(validateProject(root).ok).toBe(false);

    const report = formatActionReport(projectActions(root));
    expect(report).toContain("Fix validation errors");
    expect(report).toContain("Fix continuity contradictions");
  });
});

describe("frontmatter contract leftovers", () => {
  test("rejects a died-in that is not a scalar", () => {
    const root = project("Died In Shape");
    writeMarkdown(path.join(root, "characters", "sarah.md"), [
      "name: Sarah",
      "role: protagonist",
      "status: deceased",
      "died-in:",
      "  - chapter-01"
    ].join("\n"), "# Sarah\n");

    expect(validateProject(root).errors.join("\n")).toContain("died-in must be a scalar");
  });

  test("rejects the wrong type on every v3 record", () => {
    const root = project("Wrong Types");
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });

    writeMarkdown(path.join(root, "continuity", "facts", "a-fact.md"),
      ["type: not-a-fact", "statement: Something"].join("\n"), "# Fact\n");
    writeMarkdown(path.join(root, "continuity", "knowledge", "sarah.md"),
      ["type: not-a-record", "character: sarah", "facts: []"].join("\n"), "# Knowledge\n");
    writeMarkdown(path.join(root, "continuity", "relationships", "sarah-x.md"),
      ["type: not-a-relationship", "id: sarah-x", "participants:", "  - sarah"].join("\n"), "# Relationship\n");

    const errors = validateProject(root).errors.join("\n");
    expect(errors).toContain("type must be fact");
    expect(errors).toContain("type must be knowledge-record");
    expect(errors).toContain("type must be relationship");
  });

  test("rejects the wrong type on a snapshot and on the current pointer", () => {
    const root = project("Wrong State Types");
    createEntity(root, { kind: "chapter", name: "One", number: 1 });

    writeMarkdown(path.join(root, "continuity", "state", "chapter-01.md"),
      ["type: not-a-snapshot", "chapter: chapter-01", "sequence: 1"].join("\n"), "# Snapshot\n");
    writeMarkdown(path.join(root, "continuity", "state", "current.md"),
      ["type: not-a-pointer", "chapter: chapter-01", "sequence: 1"].join("\n"), "# Current\n");

    const errors = validateProject(root).errors.join("\n");
    expect(errors).toContain("type must be state-snapshot");
    expect(errors).toContain("type must be state-current");
  });
});

describe("relationship inverses", () => {
  test("names the backlink type a kinship should have carried", () => {
    const root = project("Inverse");
    // Sarah is Robert's parent, so Robert's side should say child. It says
    // sibling, and the error names what it expected.
    writeMarkdown(path.join(root, "characters", "sarah.md"), [
      "name: Sarah",
      "role: protagonist",
      "status: alive",
      "relationships:",
      "  - character: robert",
      "    type: parent"
    ].join("\n"), "# Sarah\n");

    writeMarkdown(path.join(root, "characters", "robert.md"), [
      "name: Robert",
      "role: supporting",
      "status: alive",
      "relationships:",
      "  - character: sarah",
      "    type: sibling"
    ].join("\n"), "# Robert\n");

    expect(validateLinks(root).errors.join("\n"))
      .toContain("expects backlink type child, got sibling");
  });
});

describe("arc simulation and constraint leftovers", () => {
  function arcWithPlan(title, plan) {
    const root = project(title);
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "fact", name: "A secret", "established-in": "pre-story" });
    createEntity(root, { kind: "arc", name: "The Arc", type: "main" });

    const arcPath = path.join(root, "plot", "arcs", "the-arc.md");
    const arc = scanProject(root).arcs[0];
    fs.writeFileSync(arcPath, replaceFrontmatter(fs.readFileSync(arcPath, "utf8"), { ...arc.rawData, ...plan }), "utf8");
    return root;
  }

  test("carries a living character's interior state into the brief", () => {
    const root = arcWithPlan("Interior", { chapters: ["chapter-01"], "arc-characters": [{ id: "sarah", goal: "find out" }] });

    // Simulation is the one place interior state is in scope for everyone.
    const sarahPath = path.join(root, "characters", "sarah.md");
    const sarah = scanProject(root).characters[0];
    fs.writeFileSync(sarahPath, replaceFrontmatter(fs.readFileSync(sarahPath, "utf8"), {
      name: sarah.name,
      role: sarah.role,
      status: sarah.status,
      fear: "that she already knows",
      "internal-need": "to be believed"
    }), "utf8");

    const brief = buildArcSimulation(scanProject(root), { arc: "the-arc" });
    expect(brief.characters[0]).toMatchObject({
      fear: "that she already knows",
      "internal-need": "to be believed"
    });
  });

  test("allows a causal step with no chapter of its own", () => {
    const root = arcWithPlan("Undated Step", {
      chapters: ["chapter-01"],
      "hard-constraints": [{ constraint: "Not yet", kind: "knowledge", fact: "a-secret", until: "chapter-01" }],
      "causal-chain": [{ step: 1, character: "sarah", cause: "somewhere in here", effect: "she learns it", learns: "a-secret" }]
    });

    // Without a chapter there is no position to compare against the constraint,
    // so the step stands and the author is left to place it.
    expect(checkCausalChains(scanProject(root)).errors).toEqual([]);
  });
});
