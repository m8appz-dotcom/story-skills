import path from "node:path";

// Feature 14: first-class relationship records. Values stay qualitative on
// purpose. Reducing a relationship to a numeric score loses the thing that
// actually matters to the prose. Per-chapter relationship state lives in state
// snapshots; these files carry identity and current standing.

export function checkRelationships(project) {
  const errors = [];
  const warnings = [];
  const characters = new Set(project.characters.map((character) => character.id));
  const pairs = new Map();

  for (const relationship of project.relationships) {
    const label = relative(project, relationship.file);

    if (relationship.declaredId && relationship.declaredId !== relationship.id) {
      errors.push(`${label} declares id ${relationship.declaredId} but the filename is ${relationship.id}`);
    }

    if (relationship.participants.length < 2) {
      errors.push(`${label} must list at least two participants`);
      continue;
    }

    for (const participant of relationship.participants) {
      if (!characters.has(participant)) {
        errors.push(`${label} references missing character ${participant}`);
      }
    }

    const key = [...relationship.participants].sort().join("+");
    if (pairs.has(key)) {
      errors.push(`${label} duplicates the participants of ${relative(project, pairs.get(key))}`);
    } else {
      pairs.set(key, relationship.file);
    }

    if (relationship.lastMajorChange && !project.chapters.some((chapter) => chapter.id === relationship.lastMajorChange)) {
      errors.push(`${label} last-major-change references missing chapter ${relationship.lastMajorChange}`);
    }

    const expectedId = [...relationship.participants].sort().join("-");
    if (relationship.id !== expectedId) {
      warnings.push(`${label} id does not match its sorted participants (${expectedId})`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function relative(project, file) {
  return path.relative(project.root, file);
}
