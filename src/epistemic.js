import path from "node:path";

// Feature 2: the epistemic graph. Objective world truth lives in `continuity/facts/`;
// what each character knows about that truth lives in `continuity/knowledge/`.
//
// BOUNDARY: everything here is mechanical. These checks prove that references
// resolve, enums are legal, and learning order is possible. They cannot and do
// not decide whether prose semantically leaks knowledge -- that is a semantic
// review task performed by an LLM reviewer, never by this module.

export const TRUTH_STATUSES = new Set(["true", "false", "ambiguous", "undetermined"]);
export const EPISTEMIC_STATUSES = new Set(["knows", "believes", "suspects", "doubts", "misbelieves", "unknown"]);
export const CONFIDENCE_LEVELS = new Set(["low", "medium", "high"]);

// Chapter-shaped fields may also carry this sentinel for anything true before
// chapter one opens.
export const PRE_STORY = "pre-story";

export function checkEpistemicGraph(project) {
  const errors = [];
  const warnings = [];

  checkFacts(project, errors, warnings);
  checkKnowledge(project, errors, warnings);

  return { ok: errors.length === 0, errors, warnings };
}

function checkFacts(project, errors, warnings) {
  for (const fact of project.facts) {
    const label = relative(project, fact.file);

    // A fact's id is its filename, so two facts cannot collide on it. Two files
    // declaring the same `id:` field are caught here instead: at most one of
    // them can match its own filename.
    if (fact.declaredId && fact.declaredId !== fact.id) {
      errors.push(`${label} declares id ${fact.declaredId} but the filename is ${fact.id}`);
    }

    if (!fact.statement) {
      errors.push(`${label} is missing statement`);
    }

    if (fact.truthStatus && !TRUTH_STATUSES.has(fact.truthStatus)) {
      errors.push(`${label} truth-status ${fact.truthStatus} is not one of ${[...TRUTH_STATUSES].join(", ")}`);
    }

    const established = chapterPosition(project, fact.establishedIn, label, "established-in", errors);
    const resolved = chapterPosition(project, fact.resolvedIn, label, "resolved-in", errors);

    if (established !== null && resolved !== null && resolved < established) {
      errors.push(`${label} resolves in ${fact.resolvedIn} before it is established in ${fact.establishedIn}`);
    }

    if (!fact.establishedIn) {
      warnings.push(`${label} has no established-in chapter; set it or ${PRE_STORY}`);
    }
  }
}

function checkKnowledge(project, errors, warnings) {
  const characters = new Set(project.characters.map((character) => character.id));
  const facts = new Set(project.facts.map((fact) => fact.id));
  const currentPosition = currentStatePosition(project);

  for (const record of project.knowledge) {
    const label = relative(project, record.file);

    if (record.declaredCharacter && record.declaredCharacter !== record.id) {
      errors.push(`${label} declares character ${record.declaredCharacter} but the filename is ${record.id}`);
    }

    if (!characters.has(record.character)) {
      errors.push(`${label} references missing character ${record.character || "(unset)"}`);
    }

    const seenFacts = new Map();

    for (const [index, entry] of record.facts.entries()) {
      const entryLabel = `${label} facts[${index}]`;

      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        errors.push(`${entryLabel} must be a mapping`);
        continue;
      }

      if (!entry.fact || !facts.has(entry.fact)) {
        errors.push(`${entryLabel} references missing fact ${entry.fact || "(unset)"}`);
      }

      if (!entry.status) {
        errors.push(`${entryLabel} is missing status`);
      } else if (!EPISTEMIC_STATUSES.has(entry.status)) {
        errors.push(`${entryLabel} status ${entry.status} is not one of ${[...EPISTEMIC_STATUSES].join(", ")}`);
      }

      if (entry.confidence && !CONFIDENCE_LEVELS.has(entry.confidence)) {
        errors.push(`${entryLabel} confidence ${entry.confidence} is not one of ${[...CONFIDENCE_LEVELS].join(", ")}`);
      }

      if (entry.fact && seenFacts.has(entry.fact)) {
        const previous = seenFacts.get(entry.fact);
        errors.push(previous === entry.status
          ? `${entryLabel} duplicates fact ${entry.fact}`
          : `${entryLabel} contradicts an earlier entry for fact ${entry.fact}: ${previous} then ${entry.status}`);
      } else if (entry.fact) {
        seenFacts.set(entry.fact, entry.status);
      }

      const learned = chapterPosition(project, entry["learned-in"], entryLabel, "learned-in", errors);

      if (learned !== null && currentPosition !== null && learned > currentPosition) {
        errors.push(`${entryLabel} is learned-in ${entry["learned-in"]}, which is ahead of the current accepted state ${currentStateLabel(project)}`);
      }

      if (entry.status === "unknown" && entry["learned-in"]) {
        errors.push(`${entryLabel} is status unknown but records learned-in ${entry["learned-in"]}`);
      }

      if (entry.status && entry.status !== "unknown" && !entry["learned-in"]) {
        warnings.push(`${entryLabel} is status ${entry.status} with no learned-in chapter; set it or ${PRE_STORY}`);
      }
    }
  }
}

// Resolves a chapter-shaped field to a sortable position. Returns null when the
// field is unset or unresolvable; pushes an error when it names a missing chapter.
export function chapterPosition(project, value, label, field, errors) {
  const text = String(value ?? "").trim();
  if (text === "") {
    return null;
  }

  if (text === PRE_STORY) {
    return 0;
  }

  const chapter = project.chapters.find((item) => item.id === text);
  if (!chapter) {
    if (errors) {
      errors.push(`${label} ${field} references missing chapter ${text}`);
    }
    return null;
  }

  return chapter.number;
}

// The furthest chapter the accepted canon has reached, or null when a project
// has no state snapshots yet (a v2 project, or one that never accepted a chapter).
export function currentStatePosition(project) {
  if (!project.stateSnapshots || project.stateSnapshots.length === 0) {
    return null;
  }

  const latest = project.stateSnapshots[project.stateSnapshots.length - 1];
  return chapterPosition(project, latest.chapter, "", "", null) ?? 0;
}

// What to call the accepted state in a message: the chapter the latest snapshot
// names, or the pre-story sentinel when it names none.
function currentStateLabel(project) {
  const latest = project.stateSnapshots[project.stateSnapshots.length - 1];
  return latest && latest.chapter ? latest.chapter : PRE_STORY;
}

function relative(project, file) {
  return path.relative(project.root, file);
}
