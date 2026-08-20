import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { constraintsForChapter } from "../src/arcs.js";
import { replaceFrontmatter } from "../src/frontmatter.js";
import { buildRenderPacket } from "../src/render-packet.js";
import {
  checkProjectContinuity,
  contextProjection,
  createEntity,
  createStoryProject,
  recordKnowledge,
  scanProject,
  sealArc
} from "../src/story.js";
import { makeTempDir, writeMarkdown } from "./helpers.js";

// The specification scenario, exactly:
//   fact A  Sarah knows
//   fact B  Sarah suspects
//   fact C  a secret only Robert holds
function seedProjection(title) {
  const cwd = makeTempDir();
  const created = createStoryProject({ cwd, title, force: false });
  const root = created.root;

  createEntity(root, { kind: "character", name: "Sarah", role: "protagonist" });
  createEntity(root, { kind: "character", name: "Robert", role: "antagonist" });
  createEntity(root, { kind: "location", name: "Harbor House", type: "building" });

  createEntity(root, { kind: "fact", name: "Fact A the house was left to Sarah", "established-in": "pre-story" });
  createEntity(root, { kind: "fact", name: "Fact B someone moved the boat", "established-in": "pre-story" });
  createEntity(root, { kind: "fact", name: "Fact C Robert drowned Elizabeth", "truth-status": "true", "established-in": "pre-story" });

  recordKnowledge(root, { character: "sarah", fact: "fact-a-the-house-was-left-to-sarah", status: "knows", "learned-in": "pre-story" });
  recordKnowledge(root, { character: "sarah", fact: "fact-b-someone-moved-the-boat", status: "suspects", "learned-in": "pre-story", confidence: "low" });
  recordKnowledge(root, { character: "robert", fact: "fact-c-robert-drowned-elizabeth", status: "knows", "learned-in": "pre-story" });

  return root;
}

function factIds(projection) {
  return Object.values(projection.knowledge).flat().map((entry) => entry.fact);
}

function blob(value) {
  return JSON.stringify(value).toLowerCase();
}

describe("POV context projection", () => {
  test("includes what the POV knows and suspects, and excludes the secret", () => {
    const root = seedProjection("Projection Core");
    const projection = contextProjection(root, { chapter: "chapter-01", pov: "sarah" });

    expect(factIds(projection)).toContain("fact-a-the-house-was-left-to-sarah");
    expect(factIds(projection)).toContain("fact-b-someone-moved-the-boat");
    expect(factIds(projection)).not.toContain("fact-c-robert-drowned-elizabeth");

    // Nothing about the secret survives anywhere in the envelope, not just in
    // the knowledge block.
    expect(blob(projection)).not.toContain("elizabeth");
    expect(blob(projection)).not.toContain("drowned");
  });

  test("sorts knowledge into the status it was recorded under", () => {
    const root = seedProjection("Projection Buckets");
    const projection = contextProjection(root, { chapter: "chapter-01", pov: "sarah" });

    expect(projection.knowledge.knows.map((entry) => entry.fact)).toEqual(["fact-a-the-house-was-left-to-sarah"]);
    expect(projection.knowledge.suspects.map((entry) => entry.fact)).toEqual(["fact-b-someone-moved-the-boat"]);
    expect(projection.knowledge.misbelieves).toEqual([]);
  });

  test("gives the other POV a different and complementary view", () => {
    const root = seedProjection("Projection Asymmetry");
    const robert = contextProjection(root, { chapter: "chapter-01", pov: "robert" });

    expect(factIds(robert)).toEqual(["fact-c-robert-drowned-elizabeth"]);
    expect(robert.excluded.facts).toBe(2);
  });

  test("denies by default: a fact with no record at all is excluded", () => {
    const root = seedProjection("Deny By Default");
    createEntity(root, { kind: "fact", name: "Fact D nobody has recorded", "established-in": "pre-story" });

    const projection = contextProjection(root, { chapter: "chapter-01", pov: "sarah" });
    expect(factIds(projection)).not.toContain("fact-d-nobody-has-recorded");
    expect(blob(projection)).not.toContain("nobody has recorded");
  });

  test("excludes a fact the story has not established yet", () => {
    const root = seedProjection("Future Fact");
    createEntity(root, { kind: "chapter", name: "Later", number: 9 });
    createEntity(root, { kind: "fact", name: "Fact E surfaces later", "established-in": "chapter-09" });
    writeMarkdown(path.join(root, "continuity", "knowledge", "sarah.md"), [
      "type: knowledge-record",
      "character: sarah",
      "facts:",
      "  - fact: fact-e-surfaces-later",
      "    status: knows",
      "    learned-in: pre-story"
    ].join("\n"), "# Knowledge\n");

    const projection = contextProjection(root, { chapter: "chapter-01", pov: "sarah" });
    expect(factIds(projection)).not.toContain("fact-e-surfaces-later");
  });

  test("excludes a fact learned in a later chapter than the one being written", () => {
    const root = seedProjection("Learned Later");
    createEntity(root, { kind: "chapter", name: "Later", number: 6 });
    writeMarkdown(path.join(root, "continuity", "knowledge", "sarah.md"), [
      "type: knowledge-record",
      "character: sarah",
      "facts:",
      "  - fact: fact-c-robert-drowned-elizabeth",
      "    status: knows",
      "    learned-in: chapter-06"
    ].join("\n"), "# Knowledge\n");

    expect(factIds(contextProjection(root, { chapter: "chapter-01", pov: "sarah" }))).toEqual([]);
    expect(factIds(contextProjection(root, { chapter: "chapter-06", pov: "sarah" })))
      .toContain("fact-c-robert-drowned-elizabeth");
  });

  test("never exposes the interior state of a non-POV character", () => {
    const root = seedProjection("No Interior Leak");
    const robertPath = path.join(root, "characters", "robert.md");
    const robert = scanProject(root).characters.find((item) => item.id === "robert");
    fs.writeFileSync(robertPath, replaceFrontmatter(fs.readFileSync(robertPath, "utf8"), {
      ...{ name: robert.name, role: robert.role, status: robert.status },
      fear: "that the tide gives her back",
      "false-belief": "that grief makes people incurious",
      "private-information": "where the second rope went",
      "speech-principle": "answers a question with a question"
    }), "utf8");

    createEntity(root, { kind: "chapter", name: "Opening", number: 1, character: ["sarah", "robert"], pov: "sarah" });
    const projection = contextProjection(root, { chapter: "chapter-01", pov: "sarah" });

    expect(projection.present.map((item) => item.id)).toContain("robert");
    for (const secret of ["that the tide gives her back", "grief makes people incurious", "where the second rope went"]) {
      expect(blob(projection)).not.toContain(secret.toLowerCase());
    }
  });

  test("does not show a concealed object to a bystander in the same place", () => {
    const root = seedProjection("Concealed Object");
    createEntity(root, { kind: "location", name: "Port Kestrel", type: "settlement" });
    createEntity(root, { kind: "artifact", name: "Archive Lantern", type: "relic", status: "hidden" });
    createEntity(root, { kind: "chapter", name: "One", number: 1 });

    // Both characters stand in the same place; the lantern is hidden and Sarah owns it.
    writeMarkdown(path.join(root, "continuity", "state", "chapter-01.md"), [
      "type: state-snapshot",
      "chapter: chapter-01",
      "sequence: 1",
      "characters:",
      "  - id: sarah",
      "    location: port-kestrel",
      "  - id: robert",
      "    location: port-kestrel",
      "objects:",
      "  - id: archive-lantern",
      "    owner: sarah",
      "    location: port-kestrel",
      "    status: hidden"
    ].join("\n"), "# Snapshot\n");

    const bystander = contextProjection(root, { chapter: "chapter-02", pov: "robert" });
    const owner = contextProjection(root, { chapter: "chapter-02", pov: "sarah" });

    // Co-location is not visibility.
    expect(bystander.objects.map((item) => item.id)).not.toContain("archive-lantern");
    // The owner knows what they hid.
    expect(owner.objects.map((item) => item.id)).toContain("archive-lantern");
  });

  test("shows an unconcealed object to anyone in the same place", () => {
    const root = seedProjection("Visible Object");
    createEntity(root, { kind: "location", name: "Port Kestrel", type: "settlement" });
    createEntity(root, { kind: "artifact", name: "Harbour Bell", type: "object", status: "active" });
    createEntity(root, { kind: "chapter", name: "One", number: 1 });

    writeMarkdown(path.join(root, "continuity", "state", "chapter-01.md"), [
      "type: state-snapshot",
      "chapter: chapter-01",
      "sequence: 1",
      "characters:",
      "  - id: robert",
      "    location: port-kestrel",
      "objects:",
      "  - id: harbour-bell",
      "    location: port-kestrel",
      "    status: active"
    ].join("\n"), "# Snapshot\n");

    const projection = contextProjection(root, { chapter: "chapter-02", pov: "robert" });
    expect(projection.objects.map((item) => item.id)).toContain("harbour-bell");
  });

  test("exposes only relationships the POV character is part of", () => {
    const root = seedProjection("Relationship Scope");
    createEntity(root, { kind: "character", name: "Nell", role: "supporting" });
    createEntity(root, { kind: "relationship", name: "Sarah and Robert", character: ["sarah", "robert"] });
    createEntity(root, { kind: "relationship", name: "Robert and Nell", character: ["robert", "nell"] });

    const projection = contextProjection(root, { chapter: "chapter-01", pov: "sarah" });
    expect(projection.relationships.map((item) => item.id)).toEqual(["robert-sarah"]);
  });

  test("carries v2 character relationships even with no v3 record", () => {
    const root = seedProjection("Legacy Relationships");
    const sarahPath = path.join(root, "characters", "sarah.md");
    const sarah = scanProject(root).characters.find((item) => item.id === "sarah");
    fs.writeFileSync(sarahPath, replaceFrontmatter(fs.readFileSync(sarahPath, "utf8"), {
      name: sarah.name,
      role: sarah.role,
      status: sarah.status,
      relationships: [{ character: "robert", type: "sibling" }]
    }), "utf8");

    // A migrated project keeps its relational data on the character file. Reading
    // only v3 records would leave the POV not knowing who their own brother is.
    const projection = contextProjection(root, { chapter: "chapter-01", pov: "sarah" });
    expect(projection.relationships).toHaveLength(1);
    expect(projection.relationships[0]).toMatchObject({ with: ["robert"], type: "sibling" });
  });

  test("overlays v3 relationship state onto the v2 type without losing either", () => {
    const root = seedProjection("Merged Relationships");
    const sarahPath = path.join(root, "characters", "sarah.md");
    const sarah = scanProject(root).characters.find((item) => item.id === "sarah");
    fs.writeFileSync(sarahPath, replaceFrontmatter(fs.readFileSync(sarahPath, "utf8"), {
      name: sarah.name,
      role: sarah.role,
      status: sarah.status,
      relationships: [{ character: "robert", type: "sibling" }]
    }), "utf8");

    createEntity(root, { kind: "relationship", name: "Sarah and Robert", character: ["sarah", "robert"] });
    const recordPath = path.join(root, "continuity", "relationships", "robert-sarah.md");
    const record = scanProject(root).relationships[0];
    fs.writeFileSync(recordPath, replaceFrontmatter(fs.readFileSync(recordPath, "utf8"), {
      ...record.rawData,
      state: { trust: "fraying" },
      "public-status": "the last of the line"
    }), "utf8");

    const projection = contextProjection(root, { chapter: "chapter-01", pov: "sarah" });

    // One entry, not two: the same pair described from two files.
    expect(projection.relationships).toHaveLength(1);
    expect(projection.relationships[0]).toMatchObject({
      type: "sibling",
      state: { trust: "fraying" },
      "public-status": "the last of the line"
    });
  });

  test("rejects an unknown POV character", () => {
    const root = seedProjection("Unknown POV");
    expect(() => contextProjection(root, { chapter: "chapter-01", pov: "ghost" }))
      .toThrow("Unknown POV character: ghost");
  });
});

describe("arc plans", () => {
  function seedArc(title) {
    const root = seedProjection(title);
    createEntity(root, { kind: "arc", name: "The Drowning", type: "main", character: "sarah" });
    return root;
  }

  function writeArcPlan(root, extra) {
    const arcPath = path.join(root, "plot", "arcs", "the-drowning.md");
    const arc = scanProject(root).arcs.find((item) => item.id === "the-drowning");
    fs.writeFileSync(arcPath, replaceFrontmatter(fs.readFileSync(arcPath, "utf8"), {
      ...arc.rawData,
      ...extra
    }), "utf8");
  }

  test("treats a constraint expiring at a future chapter as a warning, not an error", () => {
    const root = seedArc("Future Expiry");
    writeArcPlan(root, {
      chapters: ["chapter-01"],
      "hard-constraints": [{
        constraint: "Sarah must not learn the truth yet",
        kind: "knowledge",
        character: "sarah",
        fact: "fact-c-robert-drowned-elizabeth",
        until: "chapter-04"
      }]
    });

    const result = checkProjectContinuity(root);
    expect(result.errors).toEqual([]);
    expect(result.warnings.join("\n")).toContain("expires at chapter-04, which is not canon yet");
  });

  test("rejects a constraint whose until is not a chapter id", () => {
    const root = seedArc("Bad Expiry");
    writeArcPlan(root, {
      "hard-constraints": [{ constraint: "Something", kind: "reveal", until: "eventually" }]
    });

    expect(checkProjectContinuity(root).errors.join("\n"))
      .toContain("until eventually is not a chapter id");
  });

  test("rejects a constraint naming a character who does not exist", () => {
    const root = seedArc("Ghost Constraint");
    writeArcPlan(root, {
      "hard-constraints": [{ constraint: "Something", kind: "other", character: "nobody" }]
    });

    expect(checkProjectContinuity(root).errors.join("\n"))
      .toContain("references missing character nobody");
  });

  test("rejects an illegal constraint kind", () => {
    const root = seedArc("Bad Kind");
    writeArcPlan(root, { "hard-constraints": [{ constraint: "Something", kind: "vibes" }] });

    expect(checkProjectContinuity(root).errors.join("\n")).toContain("kind vibes is not one of");
  });

  test("sealing produces successive immutable versions", () => {
    const root = seedArc("Sealing");
    writeArcPlan(root, { chapters: ["chapter-01"], "dramatic-objective": "grief to suspicion" });

    const first = sealArc(root, { arc: "the-drowning" });
    expect(first.id).toBe("the-drowning-v1");

    const sealedPath = path.join(root, "plot", "arcs", "sealed", "the-drowning-v1.md");
    const sealedBefore = fs.readFileSync(sealedPath, "utf8");

    writeArcPlan(root, { chapters: ["chapter-01"], "dramatic-objective": "grief to certainty" });
    const second = sealArc(root, { arc: "the-drowning" });

    expect(second.id).toBe("the-drowning-v2");
    // v1 is frozen: re-sealing never rewrites an earlier version.
    expect(fs.readFileSync(sealedPath, "utf8")).toBe(sealedBefore);

    const arc = scanProject(root).arcs.find((item) => item.id === "the-drowning");
    expect(arc.sealedVersion).toBe("the-drowning-v2");
    expect(arc.planVersion).toBe(2);
    expect(checkProjectContinuity(root).errors).toEqual([]);
  });

  test("drops constraints that have already expired", () => {
    const root = seedArc("Expiry Filter");
    createEntity(root, { kind: "chapter", name: "One", number: 1 });
    createEntity(root, { kind: "chapter", name: "Two", number: 2 });
    writeArcPlan(root, {
      chapters: ["chapter-01", "chapter-02"],
      "hard-constraints": [
        { constraint: "Expired by now", kind: "other", until: "chapter-01" },
        { constraint: "Still binding", kind: "other", until: "chapter-02" }
      ]
    });

    const project = scanProject(root);
    const active = constraintsForChapter(project, "chapter-02", 2);
    expect(active.map((item) => item.constraint)).toEqual(["Still binding"]);
  });
});

describe("render packet", () => {
  function seedPacket(title) {
    const root = seedProjection(title);
    createEntity(root, { kind: "arc", name: "The Drowning", type: "main", character: "sarah" });

    const arcPath = path.join(root, "plot", "arcs", "the-drowning.md");
    const arc = scanProject(root).arcs.find((item) => item.id === "the-drowning");
    fs.writeFileSync(arcPath, replaceFrontmatter(fs.readFileSync(arcPath, "utf8"), {
      ...arc.rawData,
      chapters: ["chapter-01"],
      "hard-constraints": [
        {
          constraint: "Sarah must not learn that Robert drowned Elizabeth before chapter-04",
          kind: "knowledge",
          character: "sarah",
          fact: "fact-c-robert-drowned-elizabeth",
          until: "chapter-04"
        },
        { constraint: "The harbor house stays in Sarah's possession", kind: "possession" }
      ],
      "soft-possibilities": ["Robert could offer to handle the paperwork himself"]
    }), "utf8");

    return root;
  }

  function packet(root, options = {}) {
    return buildRenderPacket(scanProject(root), { chapter: "chapter-01", pov: "sarah", ...options });
  }

  test("redacts a constraint whose text would leak the secret it guards", () => {
    const built = packet(seedPacket("Constraint Redaction"));

    // The authored constraint text names the secret. It must not survive.
    expect(blob(built)).not.toContain("elizabeth");
    expect(blob(built)).not.toContain("drowned");

    expect(built["hard-constraints"]["forbidden-outcomes"])
      .toContain("sarah must not learn, infer, or be told anything beyond the knowledge listed in this packet.");
  });

  test("keeps constraints that do not name a hidden fact", () => {
    const built = packet(seedPacket("Constraint Kept"));
    expect(built["hard-constraints"]["continuity-requirements"])
      .toContain("The harbor house stays in Sarah's possession");
  });

  test("states the hard and soft contract explicitly", () => {
    const built = packet(seedPacket("Guidance"));

    expect(built.guidance["hard-constraints"]).toContain("Mandatory");
    expect(built.guidance["possible-beats"]).toContain("Optional");
    expect(built.guidance.freedom).toContain("discover better local action");
    expect(built["possible-beats"]).toContain("Robert could offer to handle the paperwork himself");
  });

  test("carries only knowledge the POV character holds", () => {
    const built = packet(seedPacket("Packet Knowledge"));
    const facts = Object.values(built.knowledge).flat().map((entry) => entry.fact);

    expect(facts).toContain("fact-a-the-house-was-left-to-sarah");
    expect(facts).not.toContain("fact-c-robert-drowned-elizabeth");
  });

  test("carries no reviewer diagnostics or candidate internals", () => {
    const built = packet(seedPacket("No Internals"));

    for (const forbidden of ["review", "candidate", "transaction", "body-sha256", "state-delta"]) {
      expect(Object.keys(built)).not.toContain(forbidden);
    }
    expect(blob(built)).not.toContain("body-sha256");
  });

  test("scales the word budget around the requested target", () => {
    const built = packet(seedPacket("Budget"), { "word-target": 2000 });
    expect(built["word-budget"]).toEqual({ min: 1600, target: 2000, max: 2500 });
  });

  test("voice cards carry speech behaviour, never interior state", () => {
    const root = seedPacket("Voice Cards");
    const sarahPath = path.join(root, "characters", "sarah.md");
    const sarah = scanProject(root).characters.find((item) => item.id === "sarah");
    fs.writeFileSync(sarahPath, replaceFrontmatter(fs.readFileSync(sarahPath, "utf8"), {
      name: sarah.name,
      role: sarah.role,
      status: sarah.status,
      "speech-principle": "understates when frightened",
      fear: "that she already knows"
    }), "utf8");

    const built = packet(root);
    const card = built["voice-cards"].find((item) => item.id === "sarah");

    expect(card["speech-principle"]).toBe("understates when frightened");
    expect(card.fear).toBeUndefined();
  });
});
