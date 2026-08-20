import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { replaceFrontmatter } from "../src/frontmatter.js";
import { planAcceptance, planRejection } from "../src/transactions.js";
import { projectContext } from "../src/projection.js";
import { formatProseReport } from "../src/prose-diagnostics.js";
import { checkRelationships } from "../src/relationships.js";
import {
  createCandidate,
  createEntity,
  createStoryProject,
  proseDiagnostics,
  scanProject
} from "../src/story.js";
import { makeTempDir, writeMarkdown } from "./helpers.js";

// Phase A of acceptance refuses before it stages anything. Each refusal is a
// separate promise to the author, so each gets its own case.

function project(title) {
  const cwd = makeTempDir();
  return createStoryProject({ cwd, title, force: false }).root;
}

function snapshot(root, id, frontmatter) {
  writeMarkdown(path.join(root, "continuity", "state", `${id}.md`), frontmatter.join("\n"), "# Snapshot\n");
}

function chapterFile(root, id, number, body) {
  writeMarkdown(path.join(root, "chapters", `${id}.md`),
    [`title: Chapter ${number}`, `number: ${number}`, "status: draft", "word-count: 0"].join("\n"), body);
}

// A project with everything a delta could legally reference, plus one candidate
// whose frontmatter the caller overrides to trip a single refusal.
function candidateProject(title, data) {
  const root = project(title);
  createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
  createEntity(root, { kind: "location", name: "Harbor House", type: "building" });
  createEntity(root, { kind: "artifact", name: "Silver Key", type: "object" });
  createEntity(root, { kind: "fact", name: "A secret", "established-in": "pre-story" });
  createEntity(root, { kind: "question", name: "Who knows" });

  const result = createCandidate(root, { chapter: "chapter-01", title: "One", pov: "sarah" });
  const scaffolded = scanProject(root).candidates.find((item) => item.file === result.file);
  fs.writeFileSync(result.file,
    replaceFrontmatter(scaffolded.rawMarkdown, { ...scaffolded.rawData, ...data }), "utf8");
  return root;
}

const accept = (root) => () => planAcceptance(scanProject(root), { chapter: "chapter-01", candidate: "candidate-001" });

describe("acceptance refusals in detail", () => {
  test("names the candidate it could not find", () => {
    const root = project("Missing Candidate");
    expect(() => planAcceptance(scanProject(root), { chapter: "chapter-01", candidate: "candidate-001" }))
      .toThrow("No candidate candidate-001 for chapter-01");
    expect(() => planRejection(scanProject(root), {})).toThrow("No candidate (unset) for (unset)");
  });

  test("refuses a chapter number that is not positive", () => {
    expect(accept(candidateProject("Zero Number", { number: 0 }))).toThrow("must declare a positive chapter number");
  });

  test("refuses when there is no state history at all", () => {
    const root = candidateProject("No History", {});
    fs.rmSync(path.join(root, "continuity", "state", "chapter-00.md"));
    expect(accept(root)).toThrow("Project has no state history");
  });

  test("refuses an unknown POV character", () => {
    expect(accept(candidateProject("Bad Pov", { pov: "ghost" }))).toThrow("Unknown POV character: ghost");
  });

  test("refuses an unknown artifact, owner, or object location", () => {
    expect(accept(candidateProject("Bad Artifact", {
      "state-objects": [{ id: "no-such-artifact" }]
    }))).toThrow("Unknown artifact: no-such-artifact");

    expect(accept(candidateProject("Bad Owner", {
      "state-objects": [{ id: "silver-key", owner: "ghost" }]
    }))).toThrow("Unknown owner: ghost");

    expect(accept(candidateProject("Bad Object Location", {
      "state-objects": [{ id: "silver-key", location: "nowhere" }]
    }))).toThrow("Unknown location: nowhere");
  });

  test("refuses illegal epistemic values in the delta", () => {
    expect(accept(candidateProject("Bad Status", {
      "knowledge-delta": [{ character: "sarah", fact: "a-secret", status: "vibes" }]
    }))).toThrow("Unknown epistemic status: vibes");

    expect(accept(candidateProject("Bad Confidence", {
      "knowledge-delta": [{ character: "sarah", fact: "a-secret", status: "knows", confidence: "vast" }]
    }))).toThrow("Unknown confidence: vast");

    expect(accept(candidateProject("Unknown With Source", {
      "knowledge-delta": [{ character: "sarah", fact: "a-secret", status: "unknown", "learned-in": "chapter-01" }]
    }))).toThrow("cannot be unknown on a-secret and record learned-in");
  });

  test("refuses an unknown question in the delta", () => {
    expect(accept(candidateProject("Bad Question", {
      "question-delta": [{ question: "no-such-question", status: "open" }]
    }))).toThrow("Unknown question: no-such-question");
  });

  test("refuses to reject a candidate that was already accepted", () => {
    const root = candidateProject("Already Accepted", { status: "accepted" });
    expect(() => planRejection(scanProject(root), { chapter: "chapter-01", candidate: "candidate-001" }))
      .toThrow("was already accepted");
  });

  test("carries a knowledge source through into the committed record", () => {
    const root = candidateProject("Source Carried", {
      "knowledge-delta": [{
        character: "sarah", fact: "a-secret", status: "suspects",
        "learned-in": "chapter-01", source: "the coiled rope"
      }]
    });

    const plan = planAcceptance(scanProject(root), { chapter: "chapter-01", candidate: "candidate-001" });
    const write = plan.writes.find((item) => item.file.includes("knowledge"));
    expect(write.contents).toContain("source: the coiled rope");
  });
});

describe("projection edge cases", () => {
  test("requires a chapter, and refuses one it cannot resolve", () => {
    const root = project("Chapter Required");
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
    const scanned = scanProject(root);

    expect(() => projectContext(scanned, { pov: "sarah" })).toThrow("A chapter id is required");
    expect(() => projectContext(scanned, { chapter: "prologue", pov: "sarah" })).toThrow("Unknown chapter: prologue");
  });

  test("passes through a location the project has no record for", () => {
    const root = project("Ghost Location");
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    snapshot(root, "chapter-01", [
      "type: state-snapshot", "chapter: chapter-01", "sequence: 1",
      "characters:", "  - id: sarah", "    location: unrecorded-place"
    ]);

    const projection = projectContext(scanProject(root), { chapter: "chapter-02", pov: "sarah" });
    expect(projection.location).toEqual({ id: "unrecorded-place" });
  });
});

describe("prose report output", () => {
  test("prints every kind of signal it found", () => {
    const root = project("Prose Signals");
    const runs = [
      "She opened the ledger.", "She counted the pages.", "She closed it again.",
      "The room was cold and quiet now.", "The lamp had burned down to nothing.",
      "The door stayed shut against the wind.", "The clock had stopped at half past.",
      "He set the lantern down on the cold stone step.",
      "Later he set the lantern down on the cold stone step."
    ].join(" ");

    chapterFile(root, "chapter-01", 1,
      `## Chapter Text\n\n${runs}\n\n"Where were you?" she said.\n\nAnd then he knew.\n`);
    chapterFile(root, "chapter-02", 2,
      "## Chapter Text\n\nHe set the lantern down on the cold stone step.\n\nAnd then he knew.\n");

    const printed = formatProseReport(proseDiagnostics(root));
    expect(printed).toContain("sentences in a row open with");
    expect(printed).toContain("sentences in a row of");
    expect(printed).toContain("dialogue:");
    expect(printed).toContain("across chapters:");
    expect(printed).toContain("both end starting");
  });

  test("notes runs of identical paragraph shape", () => {
    const root = project("Paragraph Shape");
    const paragraph = "He waited. She did not come.";
    chapterFile(root, "chapter-01", 1,
      `## Chapter Text\n\n${[paragraph, paragraph, paragraph, paragraph].join("\n\n")}\n`);

    expect(formatProseReport(proseDiagnostics(root))).toContain("paragraphs in a row of");
  });
});

describe("relationship leftovers", () => {
  test("rejects a single participant and a missing chapter reference", () => {
    const root = project("Relationship Leftovers");
    createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
    createEntity(root, { kind: "character", name: "Robert", role: "antagonist" });

    writeMarkdown(path.join(root, "continuity", "relationships", "sarah.md"), [
      "type: relationship", "id: sarah", "participants:", "  - sarah"
    ].join("\n"), "# Relationship\n");

    writeMarkdown(path.join(root, "continuity", "relationships", "robert-sarah.md"), [
      "type: relationship", "id: robert-sarah", "participants:", "  - robert", "  - sarah",
      "last-major-change: chapter-77"
    ].join("\n"), "# Relationship\n");

    const errors = checkRelationships(scanProject(root)).errors.join("\n");
    expect(errors).toContain("must list at least two participants");
    expect(errors).toContain("last-major-change references missing chapter chapter-77");
  });
});
