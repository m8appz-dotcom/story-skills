import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { replaceFrontmatter } from "../src/frontmatter.js";
import {
  acceptCandidate,
  checkProjectContinuity,
  createCandidate,
  createEntity,
  createStoryProject,
  knowledgeReport,
  listCandidates,
  readTransactionRecord,
  recordKnowledge,
  rejectCandidate,
  scanProject,
  stateReport,
  validateLinks,
  validateProject
} from "../src/story.js";
import { hashBody } from "../src/transactions.js";
import { makeTempDir } from "./helpers.js";

const PROSE = [
  "## Chapter Text",
  "",
  "The tide had taken the lower steps again. Sarah stood where the water stopped",
  "and watched her uncle work the rope.",
  ""
].join("\n");

// A v3 project with the Sarah/Robert epistemic split from the specification:
// Robert knows he killed Elizabeth, Sarah does not.
function seedStory(title) {
  const cwd = makeTempDir();
  const created = createStoryProject({ cwd, title, force: false });

  createEntity(created.root, { kind: "character", name: "Sarah", role: "protagonist" });
  createEntity(created.root, { kind: "character", name: "Robert", role: "antagonist" });
  createEntity(created.root, { kind: "location", name: "Harbor House", type: "building" });
  createEntity(created.root, { kind: "arc", name: "The Drowning", type: "main", character: "sarah" });
  createEntity(created.root, {
    kind: "fact",
    name: "Robert killed Elizabeth",
    "truth-status": "true",
    "established-in": "pre-story"
  });

  recordKnowledge(created.root, {
    character: "robert",
    fact: "robert-killed-elizabeth",
    status: "knows",
    "learned-in": "pre-story"
  });
  recordKnowledge(created.root, {
    character: "sarah",
    fact: "robert-killed-elizabeth",
    status: "unknown"
  });

  return created.root;
}

// Writes a candidate carrying a state delta, a knowledge delta, and prose.
function authorCandidate(root, options = {}) {
  const result = createCandidate(root, {
    chapter: options.chapter ?? "chapter-01",
    title: "The Tide Line",
    pov: "sarah",
    character: ["sarah", "robert"],
    location: ["harbor-house"],
    arc: ["the-drowning"]
  });

  const scaffolded = scanProject(root).candidates.find((item) => item.file === result.file);
  const data = { ...scaffolded.rawData, ...(options.data ?? {}) };

  fs.writeFileSync(
    result.file,
    replaceFrontmatter(scaffolded.rawMarkdown, data).replace(/## Chapter Text[\s\S]*$/, PROSE),
    "utf8"
  );

  return result;
}

function fullDelta() {
  return {
    "story-time": { date: "1891-04-02", time: "dusk", elapsed: "1 day" },
    "state-characters": [{
      id: "sarah",
      location: "harbor-house",
      physical: "soaked",
      emotional: "suspicious"
    }],
    "knowledge-delta": [{
      character: "sarah",
      fact: "robert-killed-elizabeth",
      status: "suspects",
      "learned-in": "chapter-01",
      confidence: "low"
    }],
    "active-threads": ["sarah-suspects-robert"]
  };
}

describe("candidate lifecycle", () => {
  test("a candidate does not touch canon or state", () => {
    const root = seedStory("Candidate Inert");
    const before = stateReport(root).snapshot.id;

    authorCandidate(root);

    expect(fs.existsSync(path.join(root, "chapters", "chapter-01.md"))).toBe(false);
    expect(stateReport(root).snapshot.id).toBe(before);
    expect(knowledgeReport(root, { character: "sarah" }).records[0].facts[0].status).toBe("unknown");
    expect(listCandidates(root).candidates[0]).toMatchObject({ id: "candidate-001", status: "pending", canonical: false });
  });

  test("rejection changes nothing but the candidate", () => {
    const root = seedStory("Rejection Inert");
    authorCandidate(root, { data: fullDelta() });

    const stateBefore = fs.readFileSync(path.join(root, "continuity", "state", "chapter-00.md"), "utf8");
    const timelineBefore = fs.readFileSync(path.join(root, "plot", "timeline.md"), "utf8");

    rejectCandidate(root, { chapter: "chapter-01", candidate: "candidate-001", reason: "Voice too flat" });

    expect(fs.existsSync(path.join(root, "chapters", "chapter-01.md"))).toBe(false);
    expect(fs.existsSync(path.join(root, "continuity", "state", "chapter-01.md"))).toBe(false);
    expect(fs.existsSync(path.join(root, "transactions", "chapter-01.json"))).toBe(false);
    expect(fs.readFileSync(path.join(root, "continuity", "state", "chapter-00.md"), "utf8")).toBe(stateBefore);
    expect(fs.readFileSync(path.join(root, "plot", "timeline.md"), "utf8")).toBe(timelineBefore);
    expect(knowledgeReport(root, { character: "sarah" }).records[0].facts[0].status).toBe("unknown");
    expect(listCandidates(root).candidates[0].status).toBe("rejected");
  });

  test("a rejected candidate cannot be accepted", () => {
    const root = seedStory("Rejected Final");
    authorCandidate(root, { data: fullDelta() });
    rejectCandidate(root, { chapter: "chapter-01", candidate: "candidate-001" });

    expect(() => acceptCandidate(root, { chapter: "chapter-01", candidate: "candidate-001" }))
      .toThrow("candidate-001 is rejected and cannot be accepted");
    expect(fs.existsSync(path.join(root, "chapters", "chapter-01.md"))).toBe(false);
  });
});

describe("acceptance transaction", () => {
  function acceptSeeded(title) {
    const root = seedStory(title);
    authorCandidate(root, { data: fullDelta() });
    const result = acceptCandidate(root, { chapter: "chapter-01", candidate: "candidate-001" });
    return { root, result };
  }

  test("promotes the candidate to canon and records a matching body hash", () => {
    const { root, result } = acceptSeeded("Accept Canon");
    const chapterPath = path.join(root, "chapters", "chapter-01.md");

    expect(fs.existsSync(chapterPath)).toBe(true);

    const transaction = readTransactionRecord(root, { chapter: "chapter-01" });
    expect(transaction["body-sha256"]).toBe(result.bodyHash);
    expect(transaction["body-sha256"]).toBe(hashBody(fs.readFileSync(chapterPath, "utf8")));
    expect(transaction.candidate).toBe("candidate-001");
    expect(transaction.source["candidate-file"]).toBe("work/chapters/chapter-01/candidate-001.md");
  });

  test("creates an ordered snapshot and leaves the previous one untouched", () => {
    const root = seedStory("Accept Snapshot");
    const preStoryBefore = fs.readFileSync(path.join(root, "continuity", "state", "chapter-00.md"), "utf8");

    authorCandidate(root, { data: fullDelta() });
    acceptCandidate(root, { chapter: "chapter-01", candidate: "candidate-001" });

    const report = stateReport(root);
    expect(report.snapshot.id).toBe("chapter-01");
    expect(report.snapshot.sequence).toBe(1);
    expect(report.history.map((item) => item.sequence)).toEqual([0, 1]);
    expect(report.snapshot.characters).toContainEqual(expect.objectContaining({ id: "sarah", location: "harbor-house" }));

    // Immutability: the earlier snapshot is byte-identical after acceptance.
    expect(fs.readFileSync(path.join(root, "continuity", "state", "chapter-00.md"), "utf8")).toBe(preStoryBefore);
  });

  test("points current state at the accepted chapter", () => {
    const { root } = acceptSeeded("Accept Pointer");
    const current = scanProject(root).currentState.data;

    expect(current.chapter).toBe("chapter-01");
    expect(current.sequence).toBe(1);
    expect(current.source).toBe("chapter-01.md");
  });

  test("commits the knowledge delta", () => {
    const { root } = acceptSeeded("Accept Knowledge");
    const sarah = knowledgeReport(root, { character: "sarah" }).records[0].facts[0];

    expect(sarah).toMatchObject({
      fact: "robert-killed-elizabeth",
      status: "suspects",
      learnedIn: "chapter-01",
      confidence: "low"
    });

    // Robert's pre-story knowledge is untouched by another character's delta.
    expect(knowledgeReport(root, { character: "robert" }).records[0].facts[0].status).toBe("knows");
  });

  test("updates the timeline", () => {
    const { root } = acceptSeeded("Accept Timeline");
    const timeline = fs.readFileSync(path.join(root, "plot", "timeline.md"), "utf8");

    expect(timeline).toContain("| 1891-04-02 | The Tide Line | the-drowning | chapter-01 |");
    expect(timeline).not.toContain("*No events yet*");
  });

  test("leaves the project passing every deterministic check", () => {
    const { root } = acceptSeeded("Accept Clean");

    expect(validateProject(root).errors).toEqual([]);
    expect(validateLinks(root).errors).toEqual([]);
    expect(checkProjectContinuity(root)).toMatchObject({ ok: true, errors: [] });
  });

  test("commits a promise delta", () => {
    const root = seedStory("Accept Promise");
    createEntity(root, { kind: "promise", name: "The rope knot matters", character: "sarah" });
    authorCandidate(root, {
      data: {
        ...fullDelta(),
        "promise-delta": [{ promise: "the-rope-knot-matters", status: "planted", planted: "chapter-01" }]
      }
    });

    acceptCandidate(root, { chapter: "chapter-01", candidate: "candidate-001" });
    const promise = scanProject(root).promises.find((item) => item.id === "the-rope-knot-matters");

    expect(promise.status).toBe("planted");
    expect(promise.planted).toBe("chapter-01");
  });
});

describe("acceptance refusals", () => {
  test("refuses a chapter that is already canon", () => {
    const root = seedStory("Already Canon");
    authorCandidate(root, { data: fullDelta() });
    acceptCandidate(root, { chapter: "chapter-01", candidate: "candidate-001" });

    authorCandidate(root, { data: fullDelta() });
    expect(() => acceptCandidate(root, { chapter: "chapter-01", candidate: "candidate-002" }))
      .toThrow("chapter-01 is already canonical");
  });

  test("refuses a chapter that skips the state sequence", () => {
    const root = seedStory("Out Of Order");
    createCandidate(root, { chapter: "chapter-03", title: "Too Far", pov: "sarah" });

    expect(() => acceptCandidate(root, { chapter: "chapter-03", candidate: "candidate-001" }))
      .toThrow("chapter-03 must follow sequence 0, not 2");
  });

  test("refuses unknown references in the delta", () => {
    const root = seedStory("Bad Delta");
    authorCandidate(root, {
      data: { "state-characters": [{ id: "nobody", location: "harbor-house" }] }
    });

    expect(() => acceptCandidate(root, { chapter: "chapter-01", candidate: "candidate-001" }))
      .toThrow("Unknown character: nobody");
    expect(fs.existsSync(path.join(root, "chapters", "chapter-01.md"))).toBe(false);
  });

  test("refuses a knowledge delta that learns a fact in another chapter", () => {
    const root = seedStory("Wrong Chapter");
    authorCandidate(root, {
      data: {
        "knowledge-delta": [{
          character: "sarah",
          fact: "robert-killed-elizabeth",
          status: "knows",
          "learned-in": "chapter-04"
        }]
      }
    });

    expect(() => acceptCandidate(root, { chapter: "chapter-01", candidate: "candidate-001" }))
      .toThrow("sarah cannot learn robert-killed-elizabeth in chapter-04 while accepting chapter-01");
  });

  test("a failed commit rolls back the writes it had already made", () => {
    const root = seedStory("Atomic Rollback");
    authorCandidate(root, { data: fullDelta() });

    // A *file* where the transactions directory belongs. The capture pass sees
    // no transaction to preserve, so it succeeds; the write pass then fails
    // trying to create the directory, by which point canon and the snapshot are
    // already on disk. That is the only way to reach the rollback: a failure
    // partway through the writes, not before them.
    const blocker = path.join(root, "transactions");
    fs.writeFileSync(blocker, "not a directory", "utf8");

    expect(() => acceptCandidate(root, { chapter: "chapter-01", candidate: "candidate-001" })).toThrow();

    // Clear the obstruction so the project is scannable again; the rollback has
    // already happened by now.
    fs.rmSync(blocker);

    // Everything written before the failure is gone again.
    expect(fs.existsSync(path.join(root, "chapters", "chapter-01.md"))).toBe(false);
    expect(fs.existsSync(path.join(root, "continuity", "state", "chapter-01.md"))).toBe(false);
    expect(stateReport(root).snapshot.id).toBe("chapter-00");
    expect(knowledgeReport(root, { character: "sarah" }).records[0].facts[0].status).toBe("unknown");
  });

  test("a commit that fails before writing anything mutates nothing either", () => {
    const root = seedStory("Nothing Staged");
    authorCandidate(root, { data: fullDelta() });

    // A directory where the transaction file belongs: the capture pass cannot
    // read it, so the commit gives up before the first write.
    fs.mkdirSync(path.join(root, "transactions", "chapter-01.json"), { recursive: true });

    expect(() => acceptCandidate(root, { chapter: "chapter-01", candidate: "candidate-001" })).toThrow();
    expect(fs.existsSync(path.join(root, "chapters", "chapter-01.md"))).toBe(false);
    expect(stateReport(root).snapshot.id).toBe("chapter-00");
  });
});

describe("transaction integrity", () => {
  test("detects a chapter edited after acceptance", () => {
    const root = seedStory("Tamper");
    authorCandidate(root, { data: fullDelta() });
    acceptCandidate(root, { chapter: "chapter-01", candidate: "candidate-001" });

    fs.appendFileSync(path.join(root, "chapters", "chapter-01.md"), "\nAn extra line nobody accepted.\n", "utf8");

    expect(checkProjectContinuity(root).errors.join("\n"))
      .toContain("body-sha256 does not match");
  });

  test("survives reindex, which rewrites frontmatter but not prose", () => {
    const root = seedStory("Hash Stability");
    authorCandidate(root, { data: fullDelta() });
    acceptCandidate(root, { chapter: "chapter-01", candidate: "candidate-001" });

    createEntity(root, { kind: "character", name: "Nudge", role: "minor" });
    expect(checkProjectContinuity(root).ok).toBe(true);
  });
});

describe("book scale", () => {
  test("acceptance stamps established-in on a fact first learned in this chapter", () => {
    const root = seedStory("Established Stamp");
    createEntity(root, { kind: "fact", name: "The rope was cut" });
    expect(scanProject(root).facts.find((item) => item.id === "the-rope-was-cut").establishedIn).toBe("");

    authorCandidate(root, {
      data: {
        ...fullDelta(),
        "knowledge-delta": [{
          character: "sarah",
          fact: "the-rope-was-cut",
          status: "knows",
          "learned-in": "chapter-01"
        }]
      }
    });
    acceptCandidate(root, { chapter: "chapter-01", candidate: "candidate-001" });

    // The acceptance already knew when the fact entered the story.
    expect(scanProject(root).facts.find((item) => item.id === "the-rope-was-cut").establishedIn).toBe("chapter-01");
    expect(checkProjectContinuity(root).warnings.join("\n")).not.toContain("the-rope-was-cut");
  });

  test("does not overwrite an established-in the author already set", () => {
    const root = seedStory("Established Respect");
    createEntity(root, { kind: "fact", name: "The rope was cut", "established-in": "pre-story" });

    authorCandidate(root, {
      data: {
        ...fullDelta(),
        "knowledge-delta": [{
          character: "sarah",
          fact: "the-rope-was-cut",
          status: "knows",
          "learned-in": "chapter-01"
        }]
      }
    });
    acceptCandidate(root, { chapter: "chapter-01", candidate: "candidate-001" });

    expect(scanProject(root).facts.find((item) => item.id === "the-rope-was-cut").establishedIn).toBe("pre-story");
  });

  test("reports a character trajectory across the accepted snapshots", () => {
    const root = seedStory("Trajectory");
    authorCandidate(root, { data: fullDelta() });
    acceptCandidate(root, { chapter: "chapter-01", candidate: "candidate-001" });

    const report = stateReport(root, { character: "sarah" });
    expect(report.trajectory).toHaveLength(1);
    expect(report.trajectory[0].chapter).toBe("chapter-01");
    expect(report.trajectory[0].changed.map((item) => item.field)).toContain("emotional");

    expect(() => stateReport(root, { character: "nobody" })).toThrow("Unknown character: nobody");
  });
});
