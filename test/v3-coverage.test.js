import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { replaceFrontmatter } from "../src/frontmatter.js";
import { checkEpistemicGraph } from "../src/epistemic.js";
import { checkStateSnapshots } from "../src/state.js";
import { checkCausalChains, constraintsForChapter } from "../src/arcs.js";
import { buildRenderPacket } from "../src/render-packet.js";
import { checkTransactions } from "../src/transactions.js";
import { projectContext } from "../src/projection.js";
import {
  contextProjection,
  createEntity,
  createStoryProject,
  formatContextProjection,
  migrateProject,
  scanProject
} from "../src/story.js";
import { makeTempDir, writeMarkdown } from "./helpers.js";

// The last branches: duplicate ids, illegal enum values, chapter ids that do
// not resolve, and the report lines that only print when a section has content.

function project(title) {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title, force: false }).root;
}

function fact(root, id, extra = []) {
  writeMarkdown(path.join(root, "continuity", "facts", `${id}.md`),
    ["type: fact", `id: ${id}`, `statement: ${id}`, "established-in: pre-story", ...extra].join("\n"), "# Fact\n");
}

function knowledge(root, character, entries) {
  writeMarkdown(path.join(root, "continuity", "knowledge", `${character}.md`),
    ["type: knowledge-record", `character: ${character}`, "facts:", ...entries].join("\n"), "# Knowledge\n");
}

function snapshot(root, id, frontmatter) {
  writeMarkdown(path.join(root, "continuity", "state", `${id}.md`), frontmatter.join("\n"), "# Snapshot\n");
}

const errorsOf = (result) => result.errors.join("\n");

describe("epistemic leftovers", () => {
  test("reports two files claiming the same fact id", () => {
    const root = project("Duplicate Fact Id");
    fact(root, "a-secret");
    writeMarkdown(path.join(root, "continuity", "facts", "another-file.md"),
      ["type: fact", "id: another-file", "statement: Same id inside", "established-in: pre-story"].join("\n"), "# Fact\n");

    // Two files, both declaring the id of the first.
    const second = path.join(root, "continuity", "facts", "another-file.md");
    fs.writeFileSync(second, fs.readFileSync(second, "utf8").replace("id: another-file", "id: a-secret"), "utf8");

    const errors = errorsOf(checkEpistemicGraph(scanProject(root)));
    expect(errors).toContain("declares id a-secret");
  });

  test("rejects an illegal epistemic status and a chapter that does not resolve", () => {
    const root = project("Illegal Status");
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
    fact(root, "a-secret");
    knowledge(root, "sarah", [
      "  - fact: a-secret",
      "    status: vibes",
      "    learned-in: chapter-77"
    ]);

    const errors = errorsOf(checkEpistemicGraph(scanProject(root)));
    expect(errors).toContain("status vibes is not one of");
    expect(errors).toContain("learned-in references missing chapter chapter-77");
  });

  test("rejects a status of unknown that still records where it was learned", () => {
    const root = project("Unknown But Learned");
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    fact(root, "a-secret");
    knowledge(root, "sarah", [
      "  - fact: a-secret",
      "    status: unknown",
      "    learned-in: chapter-01"
    ]);

    expect(errorsOf(checkEpistemicGraph(scanProject(root))))
      .toContain("is status unknown but records learned-in chapter-01");
  });
});

describe("chapter-shaped fields that do not resolve", () => {
  test("a knowledge record survives a project with no accepted state", () => {
    const root = project("No State");
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
    fact(root, "a-secret");
    knowledge(root, "sarah", ["  - fact: a-secret", "    status: knows", "    learned-in: pre-story"]);
    fs.rmSync(path.join(root, "continuity", "state", "chapter-00.md"));
    fs.rmSync(path.join(root, "continuity", "state", "current.md"));

    // currentStatePosition has nothing to compare against, so nothing is ahead of it.
    expect(checkEpistemicGraph(scanProject(root)).errors).toEqual([]);
  });

  test("projection reads a chapter number out of an id that is not canon yet", () => {
    const root = project("Future Chapter Id");
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
    fact(root, "a-secret", ["resolved-in: chapter-40"]);
    knowledge(root, "sarah", ["  - fact: a-secret", "    status: knows", "    learned-in: pre-story"]);

    const projection = projectContext(scanProject(root), { chapter: "chapter-12", pov: "sarah" });
    expect(projection.knowledge.knows).toHaveLength(1);
  });

  test("an arc constraint expires against a chapter that is not canon yet", () => {
    const root = project("Future Expiry");
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
    createEntity(root, { kind: "arc", name: "The Arc", type: "main" });

    const arcPath = path.join(root, "plot", "arcs", "the-arc.md");
    const arc = scanProject(root).arcs[0];
    fs.writeFileSync(arcPath, replaceFrontmatter(fs.readFileSync(arcPath, "utf8"), {
      ...arc.rawData,
      chapters: ["chapter-05"],
      "hard-constraints": [{ constraint: "Expired", kind: "other", until: "chapter-02" }]
    }), "utf8");

    // chapter-02 is not canon, so its number comes from the id: expired by five.
    expect(constraintsForChapter(scanProject(root), "chapter-05", 5)).toEqual([]);
  });

  test("a causal step naming a canonical chapter resolves by its number", () => {
    const root = project("Chain Chapter Number");
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "arc", name: "The Arc", type: "main" });
    fact(root, "a-secret");

    const arcPath = path.join(root, "plot", "arcs", "the-arc.md");
    const arc = scanProject(root).arcs[0];
    fs.writeFileSync(arcPath, replaceFrontmatter(fs.readFileSync(arcPath, "utf8"), {
      ...arc.rawData,
      chapters: ["chapter-01"],
      "hard-constraints": [{ constraint: "Not yet", kind: "knowledge", fact: "a-secret", until: "chapter-01" }],
      "causal-chain": [{ step: 1, chapter: "chapter-01", character: "sarah", cause: "a", effect: "b", learns: "a-secret" }]
    }), "utf8");

    // The step happens exactly when the constraint expires, so it is allowed.
    expect(checkCausalChains(scanProject(root)).errors).toEqual([]);
  });
});

describe("render packet and snapshot leftovers", () => {
  test("passes a knowledge constraint through when the POV already holds the fact", () => {
    const root = project("Constraint Passthrough");
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "arc", name: "The Arc", type: "main" });
    fact(root, "a-secret");
    knowledge(root, "sarah", ["  - fact: a-secret", "    status: knows", "    learned-in: pre-story"]);

    const arcPath = path.join(root, "plot", "arcs", "the-arc.md");
    const arc = scanProject(root).arcs[0];
    fs.writeFileSync(arcPath, replaceFrontmatter(fs.readFileSync(arcPath, "utf8"), {
      ...arc.rawData,
      chapters: ["chapter-01"],
      "hard-constraints": [{ constraint: "She must act on what she knows", kind: "reveal", fact: "a-secret" }]
    }), "utf8");

    const packet = buildRenderPacket(scanProject(root), { chapter: "chapter-01", pov: "sarah" });
    // Nothing to redact: she holds it, so the constraint reads as written.
    expect(packet["hard-constraints"]["forbidden-outcomes"]).toContain("She must act on what she knows");
  });

  test("falls back to the first scene when none is named", () => {
    const root = project("First Scene");
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "scene", name: "Opening", chapter: "chapter-01", scene: 1, pov: "sarah" });
    createEntity(root, { kind: "scene", name: "Later", chapter: "chapter-01", scene: 2, pov: "sarah" });

    const packet = buildRenderPacket(scanProject(root), { chapter: "chapter-01", pov: "sarah" });
    expect(packet.scene).toBe("chapter-01-scene-01");
  });

  test("warns about a snapshot relationship with no record behind it", () => {
    const root = project("Unbacked Relationship");
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
    createEntity(root, { kind: "character", name: "Robert", role: "antagonist" });
    createEntity(root, { kind: "relationship", name: "Pair", character: ["sarah", "robert"] });
    createEntity(root, { kind: "chapter", name: "One", number: 1 });

    snapshot(root, "chapter-01", [
      "type: state-snapshot", "chapter: chapter-01", "sequence: 1",
      "relationships:", "  - id: sarah-and-someone-else", "    trust: low"
    ]);

    expect(checkStateSnapshots(scanProject(root)).warnings.join("\n"))
      .toContain("references relationship sarah-and-someone-else with no record");
  });
});

describe("transaction leftovers", () => {
  test("warns about a canonical chapter with no acceptance transaction", () => {
    const root = project("No Transaction");
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    writeMarkdown(path.join(root, "work", "chapters", "chapter-02", "candidate-001.md"), [
      "type: chapter-candidate", "chapter: chapter-02", "candidate: candidate-001",
      "title: Two", "number: 2", "status: pending"
    ].join("\n"), "## Chapter Text\n\nWords.\n");

    expect(checkTransactions(scanProject(root)).warnings.join("\n"))
      .toContain("is canonical but has no acceptance transaction");
  });

  test("reports a rejected candidate that a transaction records as accepted", () => {
    const root = project("Rejected But Recorded");
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    const chapter = scanProject(root).chapters[0];

    writeMarkdown(path.join(root, "work", "chapters", "chapter-01", "candidate-001.md"), [
      "type: chapter-candidate", "chapter: chapter-01", "candidate: candidate-001",
      "title: One", "number: 1", "status: rejected"
    ].join("\n"), "## Chapter Text\n\nWords.\n");

    fs.mkdirSync(path.join(root, "transactions"), { recursive: true });
    fs.writeFileSync(path.join(root, "transactions", "chapter-01.json"), JSON.stringify({
      chapter: "chapter-01",
      candidate: "candidate-001",
      "body-sha256": "deliberately-wrong",
      "state-after": "chapter-01"
    }), "utf8");

    const errors = errorsOf(checkTransactions(scanProject(root)));
    expect(errors).toContain("is rejected but a transaction records it as accepted");
    expect(chapter.id).toBe("chapter-01");
  });
});

describe("context report sections", () => {
  test("prints location, present cast, objects, and every knowledge group", () => {
    const root = project("Full Context");
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
    createEntity(root, { kind: "character", name: "Robert", role: "antagonist" });
    createEntity(root, { kind: "location", name: "Harbor House", type: "building" });
    createEntity(root, { kind: "artifact", name: "Silver Key", type: "object" });
    createEntity(root, { kind: "chapter", name: "One", number: 1, character: ["sarah", "robert"], pov: "sarah" });

    for (const id of ["known", "believed", "suspected"]) {
      fact(root, id);
    }
    knowledge(root, "sarah", [
      "  - fact: known", "    status: knows", "    learned-in: pre-story",
      "  - fact: believed", "    status: believes", "    learned-in: pre-story",
      "  - fact: suspected", "    status: suspects", "    learned-in: pre-story"
    ]);

    snapshot(root, "chapter-01", [
      "type: state-snapshot", "chapter: chapter-01", "sequence: 1",
      "characters:", "  - id: sarah", "    location: harbor-house",
      "  - id: robert", "    location: harbor-house",
      "objects:", "  - id: silver-key", "    owner: sarah", "    status: active"
    ]);

    const printed = formatContextProjection(contextProjection(root, { chapter: "chapter-02", pov: "sarah" }));
    expect(printed).toContain("Location: Harbor House");
    expect(printed).toContain("knows:");
    expect(printed).toContain("believes:");
    expect(printed).toContain("suspects:");
    expect(printed).toContain("Present: Robert");
    expect(printed).toContain("Objects: Silver Key");
    expect(printed).toContain("Withheld: 0 fact");
  });
});

describe("migration on sparse projects", () => {
  test("migrates a project with no chapters and no legacy state file", () => {
    const root = project("Sparse");
    fs.rmSync(path.join(root, "continuity", "state.md"));
    for (const name of fs.readdirSync(path.join(root, "chapters"))) {
      if (name !== "_index.md") {
        fs.rmSync(path.join(root, "chapters", name));
      }
    }
    fs.rmSync(path.join(root, "continuity", "state"), { recursive: true, force: true });

    migrateProject(root);
    const scanned = scanProject(root);
    expect(scanned.stateSnapshots).toHaveLength(1);
    expect(scanned.facts).toEqual([]);
  });

  test("skips a knowledge row whose statement has no id in it", () => {
    const root = project("Unnameable Fact");
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });

    const statePath = path.join(root, "continuity", "state.md");
    fs.writeFileSync(statePath, fs.readFileSync(statePath, "utf8").replace("knowledge-state: []", [
      "knowledge-state:",
      "  - character: sarah",
      "    knows: \"!!!\""
    ].join("\n")), "utf8");

    fs.rmSync(path.join(root, "continuity", "facts"), { recursive: true, force: true });
    migrateProject(root);
    expect(scanProject(root).facts).toEqual([]);
  });
});
