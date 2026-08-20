import { createHash } from "node:crypto";
import path from "node:path";
import { replaceFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { chapterProse, wordCount } from "./markdown.js";
import { CONFIDENCE_LEVELS, EPISTEMIC_STATUSES, PRE_STORY } from "./epistemic.js";
import { stateSnapshot } from "./v3-templates.js";

// Features 7 and 8: candidates, acceptance, and the two-phase state update.
//
// Planning is pure. `planAcceptance` decides every byte that acceptance would
// write and returns it as a list of staged writes, or throws before touching
// anything. The caller performs the writes, so a rejected or invalid candidate
// can never partially mutate canon.

export const CANDIDATE_STATUSES = new Set(["pending", "accepted", "rejected"]);

export function planAcceptance(project, options = {}) {
  const chapterId = String(options.chapter ?? "").trim();
  const candidateId = String(options.candidate ?? "").trim();

  const candidate = project.candidates.find(
    (item) => item.chapter === chapterId && item.id === candidateId
  );

  if (!candidate) {
    throw new Error(`No candidate ${candidateId || "(unset)"} for ${chapterId || "(unset)"}`);
  }

  // Phase A: refuse everything that must not proceed, before staging any write.
  assertAcceptable(project, candidate);

  const previous = previousSnapshot(project, candidate.number);
  const snapshot = buildSnapshot(project, candidate, previous);
  const knowledgeWrites = buildKnowledgeWrites(project, candidate);
  const factWrites = buildFactWrites(project, candidate);
  const promiseWrites = buildRecordWrites(project, candidate, "promise");
  const questionWrites = buildRecordWrites(project, candidate, "question");

  const chapterMarkdown = buildChapterMarkdown(candidate);
  const bodyHash = hashBody(chapterMarkdown);

  const transaction = {
    chapter: candidate.chapter,
    candidate: candidate.id,
    "accepted-at": options.now ?? new Date().toISOString(),
    source: {
      "candidate-file": toPosix(path.relative(project.root, candidate.file)),
      "plan-version": candidate.planVersion || null,
      "render-packet-version": candidate.renderPacketVersion || null
    },
    "body-sha256": bodyHash,
    checks: {
      structural: "pass",
      continuity: "pass",
      links: "pass",
      review: candidate.review || "unrecorded"
    },
    "state-before": previous ? previous.id : null,
    "state-after": candidate.chapter,
    "state-delta": {
      characters: candidate.stateCharacters,
      objects: candidate.stateObjects,
      relationships: candidate.stateRelationships,
      "story-time": candidate.storyTime,
      "active-threads": candidate.activeThreads
    },
    "knowledge-delta": candidate.knowledgeDelta,
    "promise-delta": candidate.promiseDelta,
    "question-delta": candidate.questionDelta
  };

  const writes = [
    { file: path.join(project.root, "chapters", `${candidate.chapter}.md`), contents: chapterMarkdown },
    { file: path.join(project.root, "continuity", "state", `${candidate.chapter}.md`), contents: snapshot },
    ...knowledgeWrites,
    ...factWrites,
    ...promiseWrites,
    ...questionWrites,
    { file: path.join(project.root, "plot", "timeline.md"), contents: appendTimelineRow(project, candidate) },
    {
      file: path.join(project.root, "transactions", `${candidate.chapter}.json`),
      contents: `${JSON.stringify(transaction, null, 2)}\n`
    },
    { file: candidate.file, contents: withCandidateStatus(candidate, "accepted") }
  ];

  return { candidate, transaction, writes, bodyHash, previous };
}

export function planRejection(project, options = {}) {
  const chapterId = String(options.chapter ?? "").trim();
  const candidateId = String(options.candidate ?? "").trim();
  const candidate = project.candidates.find(
    (item) => item.chapter === chapterId && item.id === candidateId
  );

  if (!candidate) {
    throw new Error(`No candidate ${candidateId || "(unset)"} for ${chapterId || "(unset)"}`);
  }

  if (candidate.status === "accepted") {
    throw new Error(`${candidate.id} was already accepted for ${candidate.chapter}`);
  }

  // A rejection touches exactly one file: the candidate itself. Canon, state,
  // knowledge, promises, and the timeline are all untouched by construction.
  return {
    candidate,
    writes: [{
      file: candidate.file,
      contents: withCandidateStatus(candidate, "rejected", options.reason)
    }]
  };
}

// Deterministic integrity checks over committed transactions.
export function checkTransactions(project) {
  const errors = [];
  const warnings = [];
  const chapters = new Map(project.chapters.map((chapter) => [chapter.id, chapter]));

  for (const transaction of project.transactions) {
    const label = toPosix(path.relative(project.root, transaction.file));

    if (transaction.data.chapter !== transaction.id) {
      errors.push(`${label} records chapter ${transaction.data.chapter} but is filed as ${transaction.id}`);
    }

    const chapter = chapters.get(transaction.id);
    if (!chapter) {
      errors.push(`${label} has no canonical chapter ${transaction.id}`);
      continue;
    }

    const actual = hashBody(chapter.rawMarkdown);
    if (transaction.data["body-sha256"] !== actual) {
      errors.push(`${label} body-sha256 does not match ${toPosix(path.relative(project.root, chapter.file))}; the chapter changed after acceptance`);
    }

    const after = transaction.data["state-after"];
    if (after && !project.stateSnapshots.some((snapshot) => snapshot.chapter === after)) {
      errors.push(`${label} state-after ${after} has no state snapshot`);
    }
  }

  // A candidate must never masquerade as canon.
  for (const candidate of project.candidates) {
    const label = toPosix(path.relative(project.root, candidate.file));
    if (candidate.status === "rejected" && chapters.has(candidate.chapter)
      && project.transactions.some((item) => item.id === candidate.chapter && item.data.candidate === candidate.id)) {
      errors.push(`${label} is rejected but a transaction records it as accepted`);
    }
  }

  for (const chapter of project.chapters) {
    if (project.candidates.length > 0 && !project.transactions.some((item) => item.id === chapter.id)) {
      warnings.push(`${toPosix(path.relative(project.root, chapter.file))} is canonical but has no acceptance transaction`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

// Hash the prose only. Frontmatter is rewritten by reindex and wordcount, so
// hashing the whole file would make every maintenance run look like tampering.
export function hashBody(markdown) {
  const prose = chapterProse(markdown).replace(/\r\n/g, "\n").trim();
  return createHash("sha256").update(prose, "utf8").digest("hex");
}

function assertAcceptable(project, candidate) {
  if (candidate.status === "rejected") {
    throw new Error(`${candidate.id} is rejected and cannot be accepted`);
  }

  if (project.chapters.some((chapter) => chapter.id === candidate.chapter)) {
    throw new Error(`${candidate.chapter} is already canonical; remove it before accepting another candidate`);
  }

  if (!Number.isInteger(candidate.number) || candidate.number < 1) {
    throw new Error(`${candidate.id} must declare a positive chapter number`);
  }

  if (project.stateSnapshots.length === 0) {
    throw new Error("Project has no state history; run story migrate before accepting chapters");
  }

  const latest = project.stateSnapshots[project.stateSnapshots.length - 1];
  if (latest.sequence !== candidate.number - 1) {
    throw new Error(`${candidate.chapter} must follow sequence ${latest.sequence}, not ${candidate.number - 1}`);
  }

  const characters = new Set(project.characters.map((item) => item.id));
  const locations = new Set(project.locations.map((item) => item.id));
  const artifacts = new Set(project.artifacts.map((item) => item.id));
  const factions = new Set(project.factions.map((item) => item.id));
  const facts = new Set(project.facts.map((item) => item.id));
  const promises = new Set(project.promises.map((item) => item.id));
  const questions = new Set(project.questions.map((item) => item.id));

  requireAll(candidate.characters, characters, "character");
  requireAll(candidate.locations, locations, "location");
  if (candidate.pov && !characters.has(candidate.pov)) {
    throw new Error(`Unknown POV character: ${candidate.pov}`);
  }

  for (const entry of candidate.stateCharacters) {
    requireOne(entry.id, characters, "character");
    if (entry.location) {
      requireOne(entry.location, locations, "location");
    }
  }

  for (const entry of candidate.stateObjects) {
    requireOne(entry.id, artifacts, "artifact");
    if (entry.owner && !characters.has(entry.owner) && !factions.has(entry.owner)) {
      throw new Error(`Unknown owner: ${entry.owner}`);
    }
    if (entry.location) {
      requireOne(entry.location, locations, "location");
    }
  }

  for (const entry of candidate.knowledgeDelta) {
    requireOne(entry.character, characters, "character");
    requireOne(entry.fact, facts, "fact");

    if (!EPISTEMIC_STATUSES.has(entry.status)) {
      throw new Error(`Unknown epistemic status: ${entry.status}`);
    }
    if (entry.confidence && !CONFIDENCE_LEVELS.has(entry.confidence)) {
      throw new Error(`Unknown confidence: ${entry.confidence}`);
    }

    const learned = entry["learned-in"];
    if (learned && learned !== PRE_STORY && learned !== candidate.chapter) {
      throw new Error(`${entry.character} cannot learn ${entry.fact} in ${learned} while accepting ${candidate.chapter}`);
    }
    if (entry.status === "unknown" && learned) {
      throw new Error(`${entry.character} cannot be unknown on ${entry.fact} and record learned-in`);
    }
  }

  for (const entry of candidate.promiseDelta) {
    requireOne(entry.promise, promises, "promise");
  }

  for (const entry of candidate.questionDelta) {
    requireOne(entry.question, questions, "question");
  }
}

function requireAll(values, allowed, label) {
  for (const value of values) {
    requireOne(value, allowed, label);
  }
}

function requireOne(value, allowed, label) {
  if (!value || !allowed.has(value)) {
    throw new Error(`Unknown ${label}: ${value || "(unset)"}`);
  }
}

function previousSnapshot(project, number) {
  return project.stateSnapshots.find((snapshot) => snapshot.sequence === number - 1) ?? null;
}

// The new snapshot carries the previous one forward and applies the delta on
// top, keyed by id. Nothing in the previous snapshot is lost unless the delta
// explicitly restates it.
function buildSnapshot(project, candidate, previous) {
  return stateSnapshot(project.storyId, {
    chapter: candidate.chapter,
    sequence: candidate.number,
    // The scaffold writes story-time with its three keys already present and
    // empty, so counting keys would always look like "the chapter set this" and
    // silently wipe the clock. What matters is whether any of them says anything.
    storyTime: hasContent(candidate.storyTime)
      ? candidate.storyTime
      : (previous ? previous.storyTime : {}),
    characters: mergeById(previous ? previous.characters : [], candidate.stateCharacters),
    objects: mergeById(previous ? previous.objects : [], candidate.stateObjects),
    relationships: mergeById(previous ? previous.relationships : [], candidate.stateRelationships),
    activeThreads: candidate.activeThreads.length > 0
      ? candidate.activeThreads
      : (previous ? previous.activeThreads : []),
    readerKnowledge: candidate.readerKnowledge.length > 0
      ? candidate.readerKnowledge
      : (previous ? previous.readerKnowledge : []),
    note: `Durable state after ${candidate.chapter}.`
  });
}

function hasContent(mapping) {
  return Object.values(mapping ?? {}).some((value) => String(value ?? "").trim() !== "");
}

function mergeById(previous, delta) {
  const merged = new Map();
  for (const entry of previous) {
    if (entry && entry.id) {
      merged.set(entry.id, { ...entry });
    }
  }
  for (const entry of delta) {
    if (entry && entry.id) {
      merged.set(entry.id, { ...(merged.get(entry.id) ?? {}), ...entry });
    }
  }
  return [...merged.values()].sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function buildKnowledgeWrites(project, candidate) {
  const byCharacter = new Map();

  for (const entry of candidate.knowledgeDelta) {
    const list = byCharacter.get(entry.character) ?? [];
    list.push(entry);
    byCharacter.set(entry.character, list);
  }

  const writes = [];

  for (const [character, entries] of byCharacter) {
    const record = project.knowledge.find((item) => item.character === character);
    const existing = record ? record.facts.filter((item) => !entries.some((entry) => entry.fact === item.fact)) : [];

    const facts = existing
      .concat(entries.map((entry) => {
        const next = { fact: entry.fact, status: entry.status };
        if (entry["learned-in"]) {
          next["learned-in"] = entry["learned-in"];
        }
        if (entry.confidence) {
          next.confidence = entry.confidence;
        }
        if (entry.source) {
          next.source = entry.source;
        }
        return next;
      }))
      .sort((left, right) => String(left.fact).localeCompare(String(right.fact)));

    const file = record
      ? record.file
      : path.join(project.root, "continuity", "knowledge", `${character}.md`);

    const contents = record
      ? replaceFrontmatter(record.rawMarkdown, { ...record.rawData, facts })
      : `${stringifyFrontmatter({ type: "knowledge-record", character, facts })}# Knowledge: ${character}\n`;

    writes.push({ file, contents });
  }

  return writes;
}

// The acceptance already knows when a fact first entered the story: a delta says
// a character learned it in this chapter. Stamping `established-in` from that is
// derivation, not invention, and it stops the checker nagging the author for
// something the system was already holding.
function buildFactWrites(project, candidate) {
  const writes = [];
  const stamped = new Set();

  for (const entry of candidate.knowledgeDelta) {
    if (entry["learned-in"] !== candidate.chapter || stamped.has(entry.fact)) {
      continue;
    }

    const fact = project.facts.find((item) => item.id === entry.fact);
    if (!fact || fact.establishedIn) {
      continue;
    }

    stamped.add(entry.fact);
    writes.push({
      file: fact.file,
      contents: replaceFrontmatter(fact.rawMarkdown, {
        ...fact.rawData,
        "established-in": candidate.chapter
      })
    });
  }

  return writes;
}

function buildRecordWrites(project, candidate, kind) {
  const delta = kind === "promise" ? candidate.promiseDelta : candidate.questionDelta;
  const records = kind === "promise" ? project.promises : project.questions;
  const writes = [];

  for (const entry of delta) {
    const id = entry[kind];
    const record = records.find((item) => item.id === id);
    if (!record) {
      continue;
    }

    const next = { ...record.rawData };
    if (entry.status) {
      next.status = entry.status;
    }
    for (const field of kind === "promise" ? ["planted", "payoff"] : ["introduced", "resolved"]) {
      if (entry[field]) {
        next[field] = entry[field];
      }
    }

    writes.push({ file: record.file, contents: replaceFrontmatter(record.rawMarkdown, next) });
  }

  return writes;
}

function buildChapterMarkdown(candidate) {
  const body = candidate.body.startsWith("\n") ? candidate.body : `\n${candidate.body}`;
  const frontmatter = {
    title: candidate.title,
    number: candidate.number,
    status: "draft",
    "word-count": wordCount(chapterProse(body)),
    pov: candidate.pov,
    characters: candidate.characters,
    mentions: candidate.mentions,
    locations: candidate.locations,
    "arcs-advanced": candidate.arcsAdvanced
  };

  return `${stringifyFrontmatter(frontmatter)}${body.replace(/^\n/, "")}`;
}

function appendTimelineRow(project, candidate) {
  const markdown = project.timeline;
  const when = candidate.storyTime.date || candidate.storyTime.time || "unrecorded";
  const arcs = candidate.arcsAdvanced.join(", ");
  const row = `| ${when} | ${candidate.title} | ${arcs} | ${candidate.chapter} |`;

  if (markdown.includes("| *No events yet* | | | |")) {
    return markdown.replace("| *No events yet* | | | |", row);
  }

  return markdown.endsWith("\n") ? `${markdown}${row}\n` : `${markdown}\n${row}\n`;
}

function withCandidateStatus(candidate, status, reason) {
  const next = { ...candidate.rawData, status };
  if (reason) {
    next["review-note"] = String(reason);
  }
  return replaceFrontmatter(candidate.rawMarkdown, next);
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}
