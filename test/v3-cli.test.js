import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../src/cli.js";
import { makeTempDir, memoryIo, writeMarkdown } from "./helpers.js";

// The v3 command surface, driven the way an agent drives it: through argv.
// The underlying functions have their own tests; these cover the CLI wiring,
// the option plumbing, and the exit codes an agent branches on.

function invoke(cwd, argv) {
  const io = memoryIo(cwd);
  const code = runCli(argv, io);
  return { code, out: io.output(), err: io.error() };
}

// A project far enough along to exercise every command: two characters, a
// location, an artifact, an arc with a sealed plan, a fact each character
// stands differently on, and one accepted chapter.
function seedProject() {
  const cwd = makeTempDir();
  expect(invoke(cwd, ["init", "Cli Novel", "--genre", "mystery", "--theme", "memory"]).code).toBe(0);
  const root = path.join(cwd, "cli-novel");

  const steps = [
    ["add", "character", "Sarah", "--path", root, "--role", "protagonist"],
    ["add", "character", "Robert", "--path", root, "--role", "antagonist"],
    ["add", "location", "Harbor House", "--path", root, "--type", "building"],
    ["add", "artifact", "Silver Key", "--path", root, "--type", "object", "--owner", "sarah"],
    ["add", "arc", "The Drowning", "--path", root, "--type", "main", "--character", "sarah"],
    ["add", "fact", "Robert killed Elizabeth", "--path", root, "--truth-status", "true", "--established-in", "pre-story"],
    ["add", "relationship", "Sarah and Robert", "--path", root, "--character", "sarah", "--character", "robert"],
    ["know", root, "--character", "robert", "--fact", "robert-killed-elizabeth", "--status", "knows", "--learned-in", "pre-story"],
    ["know", root, "--character", "sarah", "--fact", "robert-killed-elizabeth", "--status", "unknown"]
  ];

  for (const step of steps) {
    const result = invoke(cwd, step);
    expect(result.code, `${step.join(" ")} -> ${result.err}`).toBe(0);
  }

  return { cwd, root };
}

function writeArcPlan(root) {
  const arcPath = path.join(root, "plot", "arcs", "the-drowning.md");
  const source = fs.readFileSync(arcPath, "utf8");
  const plan = [
    "chapters:",
    "  - chapter-01",
    "  - chapter-02",
    "dramatic-objective: Sarah stops trusting her uncle",
    "hard-constraints:",
    "  - constraint: Sarah must not learn the truth yet",
    "    kind: knowledge",
    "    character: sarah",
    "    fact: robert-killed-elizabeth",
    "    until: chapter-02",
    "soft-possibilities:",
    "  - Robert could offer to handle the paperwork",
    "arc-characters:",
    "  - id: robert",
    "    goal: keep the inquest closed",
    "    offscreen-actions: visits the boatyard",
    "causal-chain:",
    "  - step: 1",
    "    chapter: chapter-01",
    "    character: sarah",
    "    cause: Sarah finds the rope",
    "    effect: she starts noticing",
    ""
  ].join("\n");

  const end = source.indexOf("\n---\n", 3);
  fs.writeFileSync(arcPath, source.slice(0, end + 1) + plan + source.slice(end + 1), "utf8");
}

// Fills in a scaffolded candidate: prose plus the deltas it proposes.
function authorCandidate(root, chapter, extra) {
  const file = path.join(root, "work", "chapters", chapter, "candidate-001.md");
  let source = fs.readFileSync(file, "utf8");
  for (const [find, replace] of extra) {
    source = source.replace(find, replace);
  }
  const marker = "## Chapter Text";
  const head = source.slice(0, source.indexOf(marker) + marker.length);
  fs.writeFileSync(file, `${head}\n\nThe tide had taken the lower steps again, and she counted them twice.\n`, "utf8");
}

describe("v3 read commands", () => {
  test("state reports the latest snapshot, a named chapter, and a trajectory", () => {
    const { cwd, root } = seedProject();

    const latest = invoke(cwd, ["state", root]);
    expect(latest.code).toBe(0);
    expect(latest.out).toContain("chapter-00");
    expect(latest.out).toContain("snapshot(s)");

    expect(invoke(cwd, ["state", root, "--chapter", "chapter-00"]).out).toContain("sequence 0");
    expect(invoke(cwd, ["state", root, "--character", "sarah"]).out).toContain("Trajectory of sarah");

    const missing = invoke(cwd, ["state", root, "--chapter", "chapter-77"]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("No state snapshot for chapter-77");
  });

  test("knowledge reports everyone, then one character", () => {
    const { cwd, root } = seedProject();

    const all = invoke(cwd, ["knowledge", root]);
    expect(all.code).toBe(0);
    expect(all.out).toContain("robert");
    expect(all.out).toContain("sarah");

    const one = invoke(cwd, ["knowledge", root, "--character", "robert"]);
    expect(one.out).toContain("knows");
    expect(one.out).not.toContain("sarah:");

    expect(invoke(cwd, ["knowledge", root, "--character", "nobody"]).code).toBe(1);
  });

  test("knowledge says so plainly when nothing is recorded yet", () => {
    const cwd = makeTempDir();
    invoke(cwd, ["init", "Bare"]);
    expect(invoke(cwd, ["knowledge", path.join(cwd, "bare")]).out).toContain("No knowledge records yet");
  });

  test("context projects a POV and withholds the rest", () => {
    const { cwd, root } = seedProject();

    const sarah = invoke(cwd, ["context", root, "--chapter", "chapter-01", "--pov", "sarah"]);
    expect(sarah.code).toBe(0);
    expect(sarah.out).toContain("Withheld: 1 fact");
    expect(sarah.out).not.toContain("Elizabeth");

    const robert = invoke(cwd, ["context", root, "--chapter", "chapter-01", "--pov", "robert", "--json"]);
    const parsed = JSON.parse(robert.out);
    expect(parsed.knowledge.knows[0].fact).toBe("robert-killed-elizabeth");
    expect(parsed.excluded.facts).toBe(0);

    expect(invoke(cwd, ["context", root, "--chapter", "chapter-01", "--pov", "ghost"]).code).toBe(1);
  });

  test("render-packet prints, and writes a versioned file when asked", () => {
    const { cwd, root } = seedProject();

    const printed = invoke(cwd, ["render-packet", root, "--chapter", "chapter-01", "--pov", "sarah", "--word-target", "1200"]);
    expect(printed.code).toBe(0);
    const packet = JSON.parse(printed.out);
    expect(packet["word-budget"]).toEqual({ min: 960, target: 1200, max: 1500 });
    expect(JSON.stringify(packet)).not.toContain("Elizabeth");

    const written = invoke(cwd, ["render-packet", root, "--chapter", "chapter-01", "--pov", "sarah", "--write"]);
    expect(written.out).toContain("Wrote render packet");
    expect(fs.existsSync(path.join(root, "work", "chapters", "chapter-01", "render-packet-v1.json"))).toBe(true);
  });

  test("prose reports repetition signals and never fails", () => {
    const { cwd, root } = seedProject();
    writeMarkdown(path.join(root, "chapters", "chapter-01.md"), [
      "title: One",
      "number: 1",
      "status: draft",
      "word-count: 0"
    ].join("\n"), "## Chapter Text\n\nShe waited by the door. She waited by the door again.\n");

    const text = invoke(cwd, ["prose", root]);
    expect(text.code).toBe(0);
    expect(text.out).toContain("not a quality judgement");

    const json = invoke(cwd, ["prose", root, "--chapter", "chapter-01", "--json", "--limit", "3"]);
    expect(JSON.parse(json.out).chapters[0].chapter).toBe("chapter-01");

    expect(invoke(cwd, ["prose", root, "--chapter", "chapter-99"]).code).toBe(1);
  });
});

describe("v3 arc commands", () => {
  test("seal-arc freezes successive versions", () => {
    const { cwd, root } = seedProject();
    writeArcPlan(root);

    const first = invoke(cwd, ["seal-arc", root, "--arc", "the-drowning"]);
    expect(first.code).toBe(0);
    expect(first.out).toContain("the-drowning-v1");

    expect(invoke(cwd, ["seal-arc", root, "--arc", "the-drowning"]).out).toContain("the-drowning-v2");
    expect(invoke(cwd, ["seal-arc", root, "--arc", "nope"]).code).toBe(1);
  });

  test("simulate-arc briefs each character and can write the brief", () => {
    const { cwd, root } = seedProject();
    writeArcPlan(root);

    const printed = invoke(cwd, ["simulate-arc", root, "--arc", "the-drowning"]);
    expect(printed.code).toBe(0);
    const brief = JSON.parse(printed.out);
    expect(brief.characters.map((item) => item.id)).toContain("robert");
    expect(brief["causal-chain"]).toHaveLength(1);

    const written = invoke(cwd, ["simulate-arc", root, "--arc", "the-drowning", "--write"]);
    expect(written.out).toContain("Wrote arc simulation brief");
    expect(invoke(cwd, ["simulate-arc", root, "--arc", "nope"]).code).toBe(1);
  });
});

describe("v3 chapter lifecycle through the CLI", () => {
  test("candidate, reject, candidate, accept, transaction", () => {
    const { cwd, root } = seedProject();

    expect(invoke(cwd, ["candidates", root]).out).toContain("No candidates found");

    const scaffold = invoke(cwd, ["candidate", root, "--chapter", "chapter-01", "--title", "The Tide Line", "--pov", "sarah", "--character", "sarah"]);
    expect(scaffold.code).toBe(0);
    expect(scaffold.out).toContain("candidate-001");

    authorCandidate(root, "chapter-01", []);
    expect(invoke(cwd, ["candidates", root, "--chapter", "chapter-01"]).out).toContain("pending");

    const rejected = invoke(cwd, ["reject", root, "--chapter", "chapter-01", "--candidate", "candidate-001", "--reason", "Voice too flat"]);
    expect(rejected.code).toBe(0);
    expect(rejected.out).toContain("canon unchanged");
    expect(fs.existsSync(path.join(root, "chapters", "chapter-01.md"))).toBe(false);

    // A rejected candidate is final.
    expect(invoke(cwd, ["accept", root, "--chapter", "chapter-01", "--candidate", "candidate-001"]).code).toBe(1);

    invoke(cwd, ["candidate", root, "--chapter", "chapter-01", "--title", "The Tide Line", "--pov", "sarah", "--character", "sarah"]);
    const file = path.join(root, "work", "chapters", "chapter-01", "candidate-002.md");
    let source = fs.readFileSync(file, "utf8").replace("knowledge-delta: []", [
      "knowledge-delta:",
      "  - character: sarah",
      "    fact: robert-killed-elizabeth",
      "    status: suspects",
      "    learned-in: chapter-01",
      "    confidence: low"
    ].join("\n"));
    const marker = "## Chapter Text";
    fs.writeFileSync(file, `${source.slice(0, source.indexOf(marker) + marker.length)}\n\nShe counted the steps twice and did not say why.\n`, "utf8");

    const accepted = invoke(cwd, ["accept", root, "--chapter", "chapter-01", "--candidate", "candidate-002"]);
    expect(accepted.code).toBe(0);
    expect(accepted.out).toContain("chapter-00 -> chapter-01");
    expect(fs.existsSync(path.join(root, "chapters", "chapter-01.md"))).toBe(true);

    const transaction = invoke(cwd, ["transaction", root, "--chapter", "chapter-01"]);
    expect(transaction.code).toBe(0);
    expect(JSON.parse(transaction.out).candidate).toBe("candidate-002");

    expect(invoke(cwd, ["transaction", root, "--chapter", "chapter-09"]).code).toBe(1);
    expect(invoke(cwd, ["candidates", root]).out).toContain("chapter is canon");

    // The whole project still passes every deterministic check afterwards.
    for (const command of ["validate", "links", "continuity"]) {
      expect(invoke(cwd, [command, root]).code, command).toBe(0);
    }
  });

  test("know refuses every bad reference and records a good one", () => {
    const { cwd, root } = seedProject();

    const bad = [
      [["know", root, "--character", "nobody", "--fact", "robert-killed-elizabeth", "--status", "knows"], "Unknown character"],
      [["know", root, "--character", "sarah", "--fact", "no-such-fact", "--status", "knows"], "Unknown fact"],
      [["know", root, "--character", "sarah", "--fact", "robert-killed-elizabeth", "--status", "vibes"], "--status must be one of"],
      [["know", root, "--character", "sarah", "--fact", "robert-killed-elizabeth", "--status", "knows", "--learned-in", "chapter-42"], "Unknown chapter"],
      [["know", root, "--character", "sarah", "--fact", "robert-killed-elizabeth", "--status", "knows", "--confidence", "vast"], "--confidence must be one of"],
      [["know", root, "--fact", "robert-killed-elizabeth", "--status", "knows"], "--character is required"],
      [["know", root, "--character", "sarah", "--status", "knows"], "--fact is required"]
    ];

    for (const [argv, message] of bad) {
      const result = invoke(cwd, argv);
      expect(result.code, argv.join(" ")).toBe(1);
      expect(result.err).toContain(message);
    }

    const good = invoke(cwd, [
      "know", root, "--character", "sarah", "--fact", "robert-killed-elizabeth",
      "--status", "believes", "--learned-in", "pre-story", "--confidence", "medium",
      "--source", "the coiled rope", "--notes", "she will not say it aloud"
    ]);
    expect(good.code).toBe(0);
    expect(good.out).toContain("sarah believes");
  });

  test("accept refuses a candidate that does not exist", () => {
    const { cwd, root } = seedProject();
    const result = invoke(cwd, ["accept", root, "--chapter", "chapter-01", "--candidate", "candidate-404"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("No candidate candidate-404");
  });
});
