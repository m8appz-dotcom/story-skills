import path from "node:path";

// Features 4 and 5: the arc planning layer and sealed arc plans.
//
// An arc spans roughly 3-8 chapters and holds three deliberately different kinds
// of statement:
//
//   hard-constraints    must not be violated. Mechanical where possible.
//   required-setups     things this arc owes the reader.
//   required-payoffs
//   soft-possibilities  available to the prose model, never mandatory.
//
// The distinction is the whole point. Turning every intention into a mandatory
// beat is how outlines strangle the drafting; leaving nothing mandatory is how
// long books lose their spine.

export const HARD_CONSTRAINT_KINDS = new Set([
  "knowledge",   // a character must not learn something before a chapter
  "possession",  // an artifact must stay with someone
  "location",    // a character must remain somewhere
  "reveal",      // something must not be revealed before a chapter
  "survival",    // a character must remain alive
  "other"
]);

export function checkArcs(project) {
  const errors = [];
  const warnings = [];

  const chapters = new Set(project.chapters.map((chapter) => chapter.id));
  const characters = new Set(project.characters.map((character) => character.id));
  const facts = new Set(project.facts.map((fact) => fact.id));
  const artifacts = new Set(project.artifacts.map((artifact) => artifact.id));
  const sealed = new Set(project.sealedArcs.map((plan) => plan.id));

  for (const arc of project.arcs) {
    const label = relative(project, arc.file);

    for (const chapterId of arc.chapters) {
      if (!chapters.has(chapterId)) {
        // Arcs are planned ahead of the chapters they cover, so this is only a
        // warning until the chapter exists.
        warnings.push(`${label} plans chapter ${chapterId}, which is not canon yet`);
      }
    }

    if (arc.sealedVersion && !sealed.has(arc.sealedVersion)) {
      errors.push(`${label} derives from sealed plan ${arc.sealedVersion}, which does not exist`);
    }

    checkConstraints(project, arc, label, { chapters, characters, facts, artifacts }, errors, warnings);
  }

  for (const plan of project.sealedArcs) {
    const label = relative(project, plan.file);

    if (!project.arcs.some((arc) => arc.id === plan.arc)) {
      errors.push(`${label} seals arc ${plan.arc}, which no longer exists`);
    }

    if (!Number.isInteger(plan.version) || plan.version < 1) {
      errors.push(`${label} must declare a positive plan-version`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function checkConstraints(project, arc, label, known, errors, warnings) {
  for (const [index, constraint] of arc.hardConstraints.entries()) {
    const entryLabel = `${label} hard-constraints[${index}]`;

    if (!constraint || typeof constraint !== "object" || Array.isArray(constraint)) {
      errors.push(`${entryLabel} must be a mapping`);
      continue;
    }

    if (!constraint.constraint) {
      errors.push(`${entryLabel} is missing constraint`);
    }

    if (constraint.kind && !HARD_CONSTRAINT_KINDS.has(constraint.kind)) {
      errors.push(`${entryLabel} kind ${constraint.kind} is not one of ${[...HARD_CONSTRAINT_KINDS].join(", ")}`);
    }

    // Only the reference fields are mechanically checkable. The constraint text
    // itself is prose and stays a matter for semantic review.
    for (const [field, set, kind] of [
      ["character", known.characters, "character"],
      ["fact", known.facts, "fact"],
      ["artifact", known.artifacts, "artifact"]
    ]) {
      if (constraint[field] && !set.has(constraint[field])) {
        errors.push(`${entryLabel} references missing ${kind} ${constraint[field]}`);
      }
    }

    // `until` names the chapter a constraint expires at, which is normally still
    // ahead of the draft: "must not be revealed before chapter 25" is written
    // long before chapter 25 exists. It must look like a chapter id, but naming
    // a future one is the expected case, not an error.
    if (constraint.until && !known.chapters.has(constraint.until)) {
      if (/^chapter-\d+$/.test(String(constraint.until))) {
        warnings.push(`${entryLabel} expires at ${constraint.until}, which is not canon yet`);
      } else {
        errors.push(`${entryLabel} until ${constraint.until} is not a chapter id`);
      }
    }
  }
}

// The hard constraints in force while writing a given chapter: those belonging
// to an arc that covers it, that have not already expired.
export function constraintsForChapter(project, chapterId, chapterNumber) {
  const active = [];

  for (const arc of project.arcs) {
    if (arc.chapters.length > 0 && !arc.chapters.includes(chapterId)) {
      continue;
    }

    for (const constraint of arc.hardConstraints) {
      if (!constraint || typeof constraint !== "object") {
        continue;
      }

      if (expired(project, constraint.until, chapterNumber)) {
        continue;
      }

      active.push({ arc: arc.id, ...constraint });
    }
  }

  return active;
}

function expired(project, until, chapterNumber) {
  if (!until) {
    return false;
  }

  const chapter = project.chapters.find((item) => item.id === until);
  const number = chapter ? chapter.number : Number(String(until).replace(/[^0-9]/g, ""));
  return Number.isInteger(number) && number < chapterNumber;
}

function relative(project, file) {
  return path.relative(project.root, file);
}

// Feature 4: arc-level causal simulation.
//
// The simulation itself -- what a character would plausibly do, on and off the
// page, across three to eight chapters -- is creative judgement and belongs to a
// model. What code does is two things a model should not be trusted with:
//
//   1. assemble the inputs reliably, including what each character actually
//      knows at the moment the arc opens, taken from the epistemic graph
//   2. check the resulting causal chain against the arc's hard constraints
//
// A simulated step that has a character learn something a hard constraint
// forbids is a mechanical contradiction, and it is caught here rather than three
// chapters later in prose.

export function checkCausalChains(project) {
  const errors = [];
  const warnings = [];

  const characters = new Set(project.characters.map((character) => character.id));
  const facts = new Set(project.facts.map((fact) => fact.id));

  for (const arc of project.arcs) {
    const label = relative(project, arc.file);
    checkArcCharacters(arc, label, characters, errors);
    checkChain(project, arc, label, characters, facts, errors, warnings);
  }

  return { ok: errors.length === 0, errors, warnings };
}

function checkArcCharacters(arc, label, characters, errors) {
  const seen = new Set();

  for (const [index, entry] of arc.arcCharacters.entries()) {
    const entryLabel = `${label} arc-characters[${index}]`;

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${entryLabel} must be a mapping`);
      continue;
    }

    if (!entry.id || !characters.has(entry.id)) {
      errors.push(`${entryLabel} references missing character ${entry.id || "(unset)"}`);
      continue;
    }

    if (seen.has(entry.id)) {
      errors.push(`${entryLabel} duplicates character ${entry.id}`);
    }
    seen.add(entry.id);
  }
}

function checkChain(project, arc, label, characters, facts, errors, warnings) {
  let previousStep = 0;

  for (const [index, entry] of arc.causalChain.entries()) {
    const entryLabel = `${label} causal-chain[${index}]`;

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${entryLabel} must be a mapping`);
      continue;
    }

    const step = Number(entry.step ?? index + 1);
    if (!Number.isInteger(step) || step <= previousStep) {
      errors.push(`${entryLabel} step ${entry.step ?? "(unset)"} must increase; the chain is an ordered sequence`);
    }
    previousStep = Number.isInteger(step) ? step : previousStep;

    if (entry.character && !characters.has(entry.character)) {
      errors.push(`${entryLabel} references missing character ${entry.character}`);
    }

    if (entry.chapter && arc.chapters.length > 0 && !arc.chapters.includes(entry.chapter)) {
      errors.push(`${entryLabel} happens in ${entry.chapter}, which is outside this arc`);
    }

    if (entry.learns) {
      if (!facts.has(entry.learns)) {
        errors.push(`${entryLabel} references missing fact ${entry.learns}`);
      } else {
        checkAgainstConstraints(project, arc, entry, entryLabel, errors);
      }
    }

    if (!entry.cause && !entry.effect) {
      warnings.push(`${entryLabel} records neither cause nor effect`);
    }
  }
}

// The check that makes simulation worth running: a step that has a character
// learn something the arc has forbidden them to learn yet.
function checkAgainstConstraints(project, arc, entry, entryLabel, errors) {
  const stepNumber = chapterNumber(project, entry.chapter);

  for (const constraint of arc.hardConstraints) {
    if (!constraint || typeof constraint !== "object") {
      continue;
    }

    if (constraint.fact !== entry.learns) {
      continue;
    }

    if (constraint.character && entry.character && constraint.character !== entry.character) {
      continue;
    }

    const until = chapterNumber(project, constraint.until);
    if (until !== null && stepNumber !== null && stepNumber < until) {
      errors.push(`${entryLabel} has ${entry.character || "someone"} learn ${entry.learns} in ${entry.chapter}, but a hard constraint withholds it until ${constraint.until}`);
    }
  }
}

function chapterNumber(project, value) {
  const text = String(value ?? "").trim();
  if (text === "") {
    return null;
  }

  const chapter = project.chapters.find((item) => item.id === text);
  if (chapter) {
    return chapter.number;
  }

  const parsed = Number(text.replace(/[^0-9]/g, ""));
  return Number.isInteger(parsed) ? parsed : null;
}
