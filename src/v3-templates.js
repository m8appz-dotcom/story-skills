import { stringifyFrontmatter } from "./frontmatter.js";

// Pure template builders for Schema v3 files. These never touch the filesystem;
// callers own writes so the existing path guards stay the single write boundary.

export function factIndex(storyId, facts) {
  const rows = facts.length === 0
    ? "| *No facts yet* | | | |"
    : facts.map((fact) => `| [${fact.id}](${fact.id}.md) | ${fact.truthStatus || ""} | ${fact.establishedIn || ""} | ${fact.resolvedIn || ""} |`).join("\n");

  return `${stringifyFrontmatter({
    type: "fact-registry",
    story: storyId
  })}# Facts

Objective world truth. What is actually true in the fictional universe,
independent of who knows it. Character belief lives in \`../knowledge/\`.

| Fact | Truth | Established In | Resolved In |
|------|-------|----------------|-------------|
${rows}
`;
}

export function knowledgeIndex(storyId, records) {
  const rows = records.length === 0
    ? "| *No knowledge records yet* | |"
    : records.map((record) => `| [${record.character}](${record.character}.md) | ${record.facts.length} |`).join("\n");

  return `${stringifyFrontmatter({
    type: "knowledge-registry",
    story: storyId
  })}# Character Knowledge

What each character knows, believes, suspects, doubts, or misbelieves about the
facts in \`../facts/\`. One record per character.

Deterministic checks cover reference integrity and ordering only. Whether prose
semantically leaks knowledge is a semantic review task, not a mechanical one.

| Character | Tracked Facts |
|-----------|---------------|
${rows}
`;
}

export function relationshipIndex(storyId, relationships) {
  const rows = relationships.length === 0
    ? "| *No relationships yet* | | |"
    : relationships.map((item) => `| [${item.id}](${item.id}.md) | ${item.participants.join(", ")} | ${item.lastMajorChange || ""} |`).join("\n");

  return `${stringifyFrontmatter({
    type: "relationship-registry",
    story: storyId
  })}# Relationships

Qualitative relationship state between characters. Values are author-defined
words, not scores.

| Relationship | Participants | Last Major Change |
|--------------|--------------|-------------------|
${rows}
`;
}

export function stateIndex(storyId, snapshots) {
  const rows = snapshots.length === 0
    ? "| *No snapshots yet* | | |"
    : snapshots.map((snapshot) => `| [${snapshot.id}](${snapshot.id}.md) | ${snapshot.sequence} | ${snapshot.chapter || "pre-story"} |`).join("\n");

  return `${stringifyFrontmatter({
    type: "state-registry",
    story: storyId
  })}# State Snapshots

One immutable snapshot per accepted chapter. Snapshots are append-only:
previously accepted snapshots are never rewritten. \`current.md\` is generated
and points at the latest accepted snapshot.

| Snapshot | Sequence | Chapter |
|----------|----------|---------|
${rows}
`;
}

export function stateSnapshot(storyId, options = {}) {
  const chapter = options.chapter ?? "";
  const sequence = options.sequence ?? 0;

  return `${stringifyFrontmatter({
    type: "state-snapshot",
    story: storyId,
    chapter,
    sequence,
    provisional: options.provisional ? "true" : "false",
    "story-time": options.storyTime ?? { date: "", time: "", elapsed: "" },
    characters: options.characters ?? [],
    objects: options.objects ?? [],
    relationships: options.relationships ?? [],
    "active-threads": options.activeThreads ?? [],
    "reader-knowledge": options.readerKnowledge ?? []
  })}# State After ${chapter || "Pre-Story"}

${options.note ?? "Durable narrative state at the end of this chapter."}
`;
}

export function currentState(storyId, snapshot) {
  return `${stringifyFrontmatter({
    type: "state-current",
    story: storyId,
    chapter: snapshot ? snapshot.chapter : "",
    sequence: snapshot ? snapshot.sequence : 0,
    source: snapshot ? `${snapshot.id}.md` : ""
  })}# Current State

Generated pointer to the latest accepted state snapshot. Do not edit by hand;
\`story reindex\` and chapter acceptance rewrite this file.

${snapshot ? `See [${snapshot.id}.md](${snapshot.id}.md).` : "No accepted snapshot yet."}
`;
}

export function factFile(id, options = {}) {
  return `${stringifyFrontmatter({
    type: "fact",
    id,
    statement: options.statement ?? "",
    "truth-status": options.truthStatus ?? "true",
    "established-in": options.establishedIn ?? "",
    "resolved-in": options.resolvedIn ?? "",
    tags: options.tags ?? []
  })}# ${options.statement || id}

## Notes

What is objectively true. Record who knows it in \`../knowledge/\`.
`;
}

export function knowledgeFile(character, facts = []) {
  return `${stringifyFrontmatter({
    type: "knowledge-record",
    character,
    facts
  })}# Knowledge: ${character}

## Notes

Epistemic state only. Add one entry per fact this character has any relation to.
`;
}

export function relationshipFile(id, participants, options = {}) {
  return `${stringifyFrontmatter({
    type: "relationship",
    id,
    participants,
    state: options.state ?? { trust: "", affection: "", resentment: "", dependency: "" },
    "public-status": options.publicStatus ?? "",
    "private-status": options.privateStatus ?? "",
    "last-major-change": options.lastMajorChange ?? ""
  })}# ${participants.join(" & ")}

## Notes

Qualitative state. Use author-defined words, not numeric scores.
`;
}

export function sealedArcPlan(arc, version, options = {}) {
  return `${stringifyFrontmatter({
    type: "sealed-arc-plan",
    arc: arc.id,
    "plan-version": version,
    "sealed-at": options.now ?? new Date().toISOString(),
    "source-sha256": options.sourceHash ?? "",
    chapters: arc.chapters,
    "dramatic-objective": arc.dramaticObjective,
    "starting-state": arc.startingState,
    "target-end-state": arc.targetEndState,
    "hard-constraints": arc.hardConstraints,
    "required-setups": arc.requiredSetups,
    "required-payoffs": arc.requiredPayoffs,
    "soft-possibilities": arc.softPossibilities,
    "causal-chain": arc.causalChain
  })}# Sealed Plan: ${arc.name} v${version}

This is a frozen copy of the arc plan at the moment it was sealed. It is not
edited in place. Changing the arc and sealing again produces v${version + 1},
so every chapter plan can name the arc version it derives from.

## Hard Constraints

These must not be violated by any chapter in this arc.

## Soft Possibilities

Available to the prose model. None of them are mandatory.
`;
}
