import path from "node:path";

// Feature 1: versioned narrative state. Every accepted chapter produces one
// immutable snapshot under `continuity/state/`. Snapshots are append-only:
// nothing here ever rewrites an earlier snapshot, and `current.md` is a
// generated pointer at the latest accepted one.

export const PRE_STORY_SNAPSHOT = "chapter-00";

export function checkStateSnapshots(project) {
  const errors = [];
  const warnings = [];

  if (project.stateSnapshots.length === 0) {
    if (project.currentState) {
      errors.push(`${currentLabel()} exists but there are no state snapshots`);
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  checkSequence(project, errors);
  checkChapterBinding(project, errors, warnings);
  checkSnapshotContents(project, errors, warnings);
  checkCurrentPointer(project, errors);

  return { ok: errors.length === 0, errors, warnings };
}

// The latest accepted snapshot, or null. Snapshots arrive sorted by sequence
// from scanProject.
export function resolveCurrentSnapshot(project) {
  if (project.stateSnapshots.length === 0) {
    return null;
  }
  return project.stateSnapshots[project.stateSnapshots.length - 1];
}

export function findSnapshot(project, chapterId) {
  return project.stateSnapshots.find((snapshot) => snapshot.chapter === chapterId) ?? null;
}

function checkSequence(project, errors) {
  let expected = 0;

  for (const snapshot of project.stateSnapshots) {
    const label = relative(project, snapshot.file);

    if (!Number.isInteger(snapshot.sequence) || snapshot.sequence < 0) {
      errors.push(`${label} sequence must be a non-negative integer`);
      continue;
    }

    if (snapshot.sequence < expected) {
      errors.push(`${label} sequence ${snapshot.sequence} duplicates or precedes an earlier snapshot`);
    } else if (snapshot.sequence > expected) {
      errors.push(`${label} sequence ${snapshot.sequence} skips ${expected}; state history has a gap`);
    }

    expected = snapshot.sequence + 1;
  }

  const first = project.stateSnapshots[0];
  if (first && first.sequence !== 0) {
    errors.push(`${relative(project, first.file)} is the first snapshot but does not start at sequence 0`);
  }
}

function checkChapterBinding(project, errors, warnings) {
  const chapters = new Map(project.chapters.map((chapter) => [chapter.id, chapter]));
  const covered = new Set();

  for (const snapshot of project.stateSnapshots) {
    const label = relative(project, snapshot.file);

    if (snapshot.sequence === 0) {
      if (snapshot.chapter) {
        errors.push(`${label} is the pre-story snapshot and must not name a chapter`);
      }
      continue;
    }

    if (!snapshot.chapter) {
      errors.push(`${label} is missing chapter`);
      continue;
    }

    const chapter = chapters.get(snapshot.chapter);
    if (!chapter) {
      errors.push(`${label} references missing chapter ${snapshot.chapter}; a snapshot may only exist for a canonical chapter`);
      continue;
    }

    if (covered.has(snapshot.chapter)) {
      errors.push(`${label} is a second snapshot for ${snapshot.chapter}`);
    }
    covered.add(snapshot.chapter);

    if (chapter.number !== snapshot.sequence) {
      errors.push(`${label} sequence ${snapshot.sequence} does not match chapter number ${chapter.number}`);
    }
  }

  // A canonical chapter with no snapshot is recoverable by hand, so this stays a
  // warning: authors may legitimately write chapters outside the acceptance flow.
  for (const chapter of project.chapters) {
    if (!covered.has(chapter.id)) {
      warnings.push(`${relative(project, chapter.file)} is canonical but has no state snapshot; accept the chapter or add continuity/state/${chapter.id}.md`);
    }
  }
}

function checkSnapshotContents(project, errors, warnings) {
  const characters = new Set(project.characters.map((item) => item.id));
  const locations = new Set(project.locations.map((item) => item.id));
  const artifacts = new Set(project.artifacts.map((item) => item.id));
  const factions = new Set(project.factions.map((item) => item.id));
  const relationships = new Set(project.relationships.map((item) => item.id));

  for (const snapshot of project.stateSnapshots) {
    const label = relative(project, snapshot.file);

    for (const [index, entry] of snapshot.characters.entries()) {
      const entryLabel = `${label} characters[${index}]`;
      if (!requireMapping(entry, entryLabel, errors)) {
        continue;
      }
      if (!entry.id || !characters.has(entry.id)) {
        errors.push(`${entryLabel} references missing character ${entry.id || "(unset)"}`);
      }
      if (entry.location && !locations.has(entry.location)) {
        errors.push(`${entryLabel} references missing location ${entry.location}`);
      }
    }

    for (const [index, entry] of snapshot.objects.entries()) {
      const entryLabel = `${label} objects[${index}]`;
      if (!requireMapping(entry, entryLabel, errors)) {
        continue;
      }
      if (!entry.id || !artifacts.has(entry.id)) {
        errors.push(`${entryLabel} references missing artifact ${entry.id || "(unset)"}`);
      }
      if (entry.owner && !characters.has(entry.owner) && !factions.has(entry.owner)) {
        errors.push(`${entryLabel} references missing owner ${entry.owner}`);
      }
      if (entry.location && !locations.has(entry.location)) {
        errors.push(`${entryLabel} references missing location ${entry.location}`);
      }
    }

    for (const [index, entry] of snapshot.relationships.entries()) {
      const entryLabel = `${label} relationships[${index}]`;
      if (!requireMapping(entry, entryLabel, errors)) {
        continue;
      }
      if (!entry.id) {
        errors.push(`${entryLabel} is missing id`);
      } else if (relationships.size > 0 && !relationships.has(entry.id)) {
        warnings.push(`${entryLabel} references relationship ${entry.id} with no record in continuity/relationships/`);
      }
    }
  }
}

function checkCurrentPointer(project, errors) {
  const label = currentLabel();
  const latest = resolveCurrentSnapshot(project);

  if (!project.currentState) {
    errors.push(`${label} is missing; it must point at ${latest.id}`);
    return;
  }

  const data = project.currentState.data;

  if (data.chapter !== latest.chapter) {
    errors.push(`${label} chapter ${data.chapter || "(unset)"} is not the latest accepted chapter ${latest.chapter || "(pre-story)"}`);
  }

  if (data.sequence !== latest.sequence) {
    errors.push(`${label} sequence ${data.sequence ?? "(unset)"} is not the latest sequence ${latest.sequence}`);
  }

  const expectedSource = `${latest.id}.md`;
  if (data.source && data.source !== expectedSource) {
    errors.push(`${label} source ${data.source} is not ${expectedSource}`);
  }
}

function requireMapping(entry, entryLabel, errors) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    errors.push(`${entryLabel} must be a mapping`);
    return false;
  }
  return true;
}

function currentLabel() {
  return path.join("continuity", "state", "current.md");
}

function relative(project, file) {
  return path.relative(project.root, file);
}
