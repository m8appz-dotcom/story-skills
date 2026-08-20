import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { buildArcSimulation } from "../src/arc-simulation.js";
import { replaceFrontmatter } from "../src/frontmatter.js";
import {
  checkProjectContinuity,
  createEntity,
  createStoryProject,
  recordKnowledge,
  scanProject
} from "../src/story.js";
import { makeTempDir } from "./helpers.js";

function seedArc(title, plan = {}) {
  const cwd = makeTempDir();
  const root = createStoryProject({ cwd, title, force: false }).root;

  createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
  createEntity(root, { kind: "character", name: "Robert", role: "antagonist" });
  createEntity(root, { kind: "fact", name: "Robert drowned Elizabeth", "truth-status": "true", "established-in": "pre-story" });
  createEntity(root, { kind: "fact", name: "The house was left to Sarah", "established-in": "pre-story" });

  recordKnowledge(root, { character: "robert", fact: "robert-drowned-elizabeth", status: "knows", "learned-in": "pre-story" });
  recordKnowledge(root, { character: "sarah", fact: "the-house-was-left-to-sarah", status: "knows", "learned-in": "pre-story" });

  createEntity(root, { kind: "arc", name: "The Drowning", type: "main", character: ["sarah", "robert"] });
  writePlan(root, {
    chapters: ["chapter-01", "chapter-02", "chapter-03", "chapter-04"],
    "dramatic-objective": "Sarah moves from grief to suspicion",
    "hard-constraints": [{
      constraint: "Sarah must not learn the truth yet",
      kind: "knowledge",
      character: "sarah",
      fact: "robert-drowned-elizabeth",
      until: "chapter-04"
    }],
    ...plan
  });

  return root;
}

function writePlan(root, extra) {
  const arcPath = path.join(root, "plot", "arcs", "the-drowning.md");
  const arc = scanProject(root).arcs.find((item) => item.id === "the-drowning");
  fs.writeFileSync(arcPath, replaceFrontmatter(fs.readFileSync(arcPath, "utf8"), {
    ...arc.rawData,
    ...extra
  }), "utf8");
}

function brief(root) {
  return buildArcSimulation(scanProject(root), { arc: "the-drowning" });
}

function knows(character) {
  return (character["knowledge-at-arc-start"].knows ?? []).map((entry) => entry.fact);
}

describe("arc simulation brief", () => {
  test("briefs each character from their own epistemic position", () => {
    const built = brief(seedArc("Per Character Knowledge"));

    const robert = built.characters.find((item) => item.id === "robert");
    const sarah = built.characters.find((item) => item.id === "sarah");

    expect(knows(robert)).toEqual(["robert-drowned-elizabeth"]);
    expect(knows(sarah)).toEqual(["the-house-was-left-to-sarah"]);

    // The antagonist's secret is not in the protagonist's block.
    expect(knows(sarah)).not.toContain("robert-drowned-elizabeth");
  });

  test("carries goal, pressure, resources, and offscreen action", () => {
    const root = seedArc("Character Briefs", {
      "arc-characters": [{
        id: "robert",
        goal: "keep the inquest closed",
        pressure: "the surveyor is asking about the rope",
        resources: "the harbor office",
        "likely-actions": "move the ledger",
        "offscreen-actions": "visits the boatyard between chapter-02 and chapter-03"
      }]
    });

    const robert = brief(root).characters.find((item) => item.id === "robert");
    expect(robert.goal).toBe("keep the inquest closed");
    expect(robert.pressure).toBe("the surveyor is asking about the rope");
    expect(robert["offscreen-actions"]).toContain("boatyard");
  });

  test("does not brief a deceased character as an agent", () => {
    const root = seedArc("Deceased Character");
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, {
      kind: "character",
      name: "Elizabeth",
      role: "supporting",
      status: "deceased",
      "died-in": "chapter-01"
    });
    writePlan(root, { characters: ["sarah", "robert", "elizabeth"] });

    const elizabeth = brief(root).characters.find((item) => item.id === "elizabeth");

    // Present, because the arc is often about them, but never as an actor.
    expect(elizabeth).toBeDefined();
    expect(elizabeth.status).toBe("deceased");
    expect(elizabeth["simulation-note"]).toContain("Takes no new action");
    expect(elizabeth.goal).toBeUndefined();
    expect(elizabeth["offscreen-actions"]).toBeUndefined();

    // A living character is still briefed normally.
    expect(brief(root).characters.find((item) => item.id === "robert")["offscreen-actions"]).toBeDefined();
  });

  test("still briefs a missing character as an agent", () => {
    const root = seedArc("Missing Character");
    createEntity(root, { kind: "character", name: "Nell", role: "supporting", status: "missing" });
    writePlan(root, { characters: ["sarah", "nell"] });

    // A missing character is very often acting, just not where the reader sees.
    const nell = brief(root).characters.find((item) => item.id === "nell");
    expect(nell["simulation-note"]).toBeUndefined();
    expect(nell["offscreen-actions"]).toBeDefined();
  });

  test("states the simulation contract, including offscreen action", () => {
    const built = brief(seedArc("Guidance"));

    expect(built.guidance["hard-constraints"]).toContain("Mandatory");
    expect(built.guidance["offscreen-actions"]).toContain("keep acting while the POV is elsewhere");
    expect(built.guidance["not-a-beat-sheet"]).toContain("not an outline");
  });

  test("carries the arc objective and its obligations", () => {
    const built = brief(seedArc("Objective"));

    expect(built.objective["dramatic-objective"]).toBe("Sarah moves from grief to suspicion");
    expect(built["hard-constraints"]).toHaveLength(1);
    expect(built.chapters).toEqual(["chapter-01", "chapter-02", "chapter-03", "chapter-04"]);
  });

  test("surfaces open questions and unpaid promises as arc pressure", () => {
    const root = seedArc("Open Threads");
    createEntity(root, { kind: "question", name: "Who moved the boat", introduced: "chapter-01" });
    createEntity(root, { kind: "promise", name: "The rope will matter", status: "planted", planted: "chapter-01" });
    createEntity(root, { kind: "chapter", name: "One", number: 1 });

    const built = brief(root);
    expect(built["open-questions"].map((item) => item.id)).toContain("who-moved-the-boat");
    expect(built["unpaid-promises"].map((item) => item.id)).toContain("the-rope-will-matter");
  });

  test("refuses to simulate an arc with no chapters", () => {
    const root = seedArc("No Chapters");
    writePlan(root, { chapters: [] });

    expect(() => brief(root)).toThrow("has no chapters; add a chapters list before simulating");
  });

  test("rejects an unknown arc", () => {
    const root = seedArc("Unknown Arc");
    expect(() => buildArcSimulation(scanProject(root), { arc: "nope" })).toThrow("Unknown arc: nope");
  });
});

describe("causal chain checks", () => {
  test("catches a step that learns a fact a hard constraint withholds", () => {
    const root = seedArc("Constraint Violation", {
      "causal-chain": [{
        step: 1,
        chapter: "chapter-02",
        character: "sarah",
        cause: "Sarah reads the moved ledger",
        effect: "she understands what her uncle did",
        learns: "robert-drowned-elizabeth"
      }]
    });

    expect(checkProjectContinuity(root).errors.join("\n"))
      .toContain("has sarah learn robert-drowned-elizabeth in chapter-02, but a hard constraint withholds it until chapter-04");
  });

  test("allows the same step once the constraint has expired", () => {
    const root = seedArc("Constraint Satisfied", {
      "causal-chain": [{
        step: 1,
        chapter: "chapter-04",
        character: "sarah",
        cause: "Sarah reads the ledger",
        effect: "she understands",
        learns: "robert-drowned-elizabeth"
      }]
    });

    expect(checkProjectContinuity(root).errors).toEqual([]);
  });

  test("does not apply another character's constraint to this one", () => {
    const root = seedArc("Constraint Scoping", {
      "causal-chain": [{
        step: 1,
        chapter: "chapter-02",
        character: "robert",
        cause: "Robert reviews what he did",
        effect: "he decides to move the ledger",
        learns: "robert-drowned-elizabeth"
      }]
    });

    // The constraint names sarah. Robert already holds this fact.
    expect(checkProjectContinuity(root).errors).toEqual([]);
  });

  test("requires the chain to be an ordered sequence", () => {
    const root = seedArc("Out Of Order", {
      "causal-chain": [
        { step: 2, chapter: "chapter-01", character: "sarah", cause: "a", effect: "b" },
        { step: 1, chapter: "chapter-02", character: "sarah", cause: "c", effect: "d" }
      ]
    });

    expect(checkProjectContinuity(root).errors.join("\n"))
      .toContain("step 1 must increase; the chain is an ordered sequence");
  });

  test("rejects a step outside the arc", () => {
    const root = seedArc("Outside Arc", {
      "causal-chain": [{ step: 1, chapter: "chapter-09", character: "sarah", cause: "a", effect: "b" }]
    });

    expect(checkProjectContinuity(root).errors.join("\n"))
      .toContain("happens in chapter-09, which is outside this arc");
  });

  test("rejects unknown characters and facts in the chain", () => {
    const root = seedArc("Bad Refs", {
      "causal-chain": [
        { step: 1, chapter: "chapter-01", character: "nobody", cause: "a", effect: "b" },
        { step: 2, chapter: "chapter-01", character: "sarah", cause: "c", effect: "d", learns: "no-such-fact" }
      ]
    });

    const errors = checkProjectContinuity(root).errors.join("\n");
    expect(errors).toContain("references missing character nobody");
    expect(errors).toContain("references missing fact no-such-fact");
  });

  test("rejects a duplicated character in arc-characters", () => {
    const root = seedArc("Duplicate Character", {
      "arc-characters": [
        { id: "robert", goal: "one" },
        { id: "robert", goal: "two" }
      ]
    });

    expect(checkProjectContinuity(root).errors.join("\n")).toContain("duplicates character robert");
  });

  test("warns about a step recording neither cause nor effect", () => {
    const root = seedArc("Empty Step", {
      "causal-chain": [{ step: 1, chapter: "chapter-01", character: "sarah" }]
    });

    expect(checkProjectContinuity(root).warnings.join("\n")).toContain("records neither cause nor effect");
  });
});
