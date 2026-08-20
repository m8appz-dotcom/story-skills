import { EPISTEMIC_STATUSES, PRE_STORY } from "./epistemic.js";

// Feature 3: POV-safe context projection.
//
// The prose model must not receive world truth wholesale. Given a chapter and a
// POV character, this builds the largest context that character could honestly
// hold, and nothing beyond it.
//
// The filter denies by default. A fact reaches the projection only when the POV
// character has an explicit epistemic record placing them in a knowing state.
// No record means the character does not know it -- absence of knowledge is
// itself knowledge about the character, and in a long book the dangerous facts
// are usually the ones nobody has written a record for yet.

// Statuses that put a fact inside the character's head in some form. `unknown`
// is deliberately absent.
const VISIBLE_STATUSES = ["knows", "believes", "suspects", "doubts", "misbelieves"];

// Fields on a non-POV character that a POV character could plausibly observe.
// Interior state is not among them.
const OBSERVABLE_STATE_FIELDS = ["location", "physical"];

// Artifact states that mean "present but not perceivable by a bystander".
const CONCEALED_OBJECT_STATUSES = new Set(["hidden", "lost", "destroyed", "unknown"]);

export function projectContext(project, options = {}) {
  const chapterId = String(options.chapter ?? "").trim();
  const povId = String(options.pov ?? "").trim();

  const chapter = resolveChapter(project, chapterId);
  const povCharacter = project.characters.find((item) => item.id === povId);

  if (!povCharacter) {
    throw new Error(`Unknown POV character: ${povId || "(unset)"}`);
  }

  // State entering the chapter is the snapshot from the chapter before it.
  const entering = enteringSnapshot(project, chapter.number);
  const knowledge = projectKnowledge(project, povId, chapter.number);
  const povState = findEntry(entering, "characters", povId);

  return {
    chapter: chapter.id,
    scene: options.scene ? String(options.scene) : "",
    pov: povId,
    narrative: {
      tense: project.story.data.tense ?? "",
      pov: project.story.data.pov ?? "",
      genre: project.story.data.genre ?? ""
    },
    "story-time": entering ? entering.storyTime : {},
    character: {
      id: povCharacter.id,
      name: povCharacter.name,
      role: povCharacter.role,
      ...causality(povCharacter)
    },
    state: povState ? withoutId(povState) : {},
    knowledge,
    relationships: projectRelationships(project, entering, povId),
    present: projectPresentCharacters(project, entering, chapter, povId),
    location: projectLocation(project, povState),
    objects: projectObjects(project, entering, povId, povState),
    "active-threads": entering ? entering.activeThreads : [],
    excluded: {
      // Counts only. Naming what was withheld would defeat the point.
      facts: project.facts.length - countVisible(knowledge),
      reason: "not knowable by this POV character at this point in the story"
    }
  };
}

function resolveChapter(project, chapterId) {
  if (!chapterId) {
    throw new Error("A chapter id is required");
  }

  const chapter = project.chapters.find((item) => item.id === chapterId);
  if (chapter) {
    return chapter;
  }

  // Projection also has to work for the chapter about to be written, which is
  // not canon yet. Derive its number from the id.
  const number = Number(String(chapterId).replace(/[^0-9]/g, ""));
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`Unknown chapter: ${chapterId}`);
  }

  return { id: chapterId, number, characters: [], locations: [] };
}

function enteringSnapshot(project, number) {
  return project.stateSnapshots.find((snapshot) => snapshot.sequence === number - 1) ?? null;
}

// The core filter. Every exclusion decision lives here.
function projectKnowledge(project, povId, chapterNumber) {
  const buckets = Object.fromEntries(VISIBLE_STATUSES.map((status) => [status, []]));
  const record = project.knowledge.find((item) => item.character === povId);

  if (!record) {
    return buckets;
  }

  const facts = new Map(project.facts.map((fact) => [fact.id, fact]));

  for (const entry of record.facts) {
    if (!entry || !VISIBLE_STATUSES.includes(entry.status)) {
      continue;
    }

    const fact = facts.get(entry.fact);
    if (!fact) {
      continue;
    }

    // Defence in depth: a fact the story has not established yet never reaches
    // the page, even if a knowledge record claims otherwise.
    if (establishedAfter(project, fact, chapterNumber)) {
      continue;
    }

    // Learning something later in the book does not make it available now.
    if (learnedAfter(project, entry, chapterNumber)) {
      continue;
    }

    buckets[entry.status].push({
      fact: fact.id,
      statement: fact.statement,
      "learned-in": entry["learned-in"] ?? "",
      ...(entry.confidence ? { confidence: entry.confidence } : {}),
      ...(entry.source ? { source: entry.source } : {})
    });
  }

  return buckets;
}

function establishedAfter(project, fact, chapterNumber) {
  return chapterNumberOf(project, fact.establishedIn) > chapterNumber;
}

function learnedAfter(project, entry, chapterNumber) {
  return chapterNumberOf(project, entry["learned-in"]) > chapterNumber;
}

function chapterNumberOf(project, value) {
  const text = String(value ?? "").trim();
  if (text === "" || text === PRE_STORY) {
    return 0;
  }

  const chapter = project.chapters.find((item) => item.id === text);
  if (chapter) {
    return chapter.number;
  }

  const parsed = Number(text.replace(/[^0-9]/g, ""));
  return Number.isInteger(parsed) ? parsed : 0;
}

// Only relationships the POV character is part of. What two other characters
// privately are to each other is not this character's to know.
//
// Two sources, merged rather than chosen between. The v2 `relationships:` list
// on a character file carries the *kind* of tie -- sibling, enemy, mentor -- and
// is where every existing project's relational data already lives. A v3 record
// adds qualitative state on top. Reading only v3 would leave a migrated project
// with a POV who does not know who their own brother is.
function projectRelationships(project, snapshot, povId) {
  const merged = new Map();
  const key = (participants) => [...participants].sort().join("+");

  const pov = project.characters.find((character) => character.id === povId);

  for (const entry of (pov ? pov.relationships : [])) {
    if (!entry || typeof entry !== "object" || !entry.character) {
      continue;
    }

    const participants = [povId, entry.character];
    merged.set(key(participants), {
      id: [...participants].sort().join("-"),
      with: [entry.character],
      type: entry.type ?? "",
      state: {},
      "public-status": "",
      "private-status": ""
    });
  }

  for (const relationship of project.relationships) {
    if (!relationship.participants.includes(povId)) {
      continue;
    }

    const live = findEntry(snapshot, "relationships", relationship.id);
    const existing = merged.get(key(relationship.participants)) ?? {};

    merged.set(key(relationship.participants), {
      id: relationship.id,
      with: relationship.participants.filter((participant) => participant !== povId),
      type: existing.type ?? "",
      state: { ...relationship.state, ...(live ? withoutId(live) : {}) },
      "public-status": relationship.publicStatus,
      // The POV character knows their own private read on the relationship.
      "private-status": relationship.privateStatus
    });
  }

  return [...merged.values()];
}

// Other characters are exposed as they would be seen, never as they are felt.
// No interior state, no goals, no knowledge of their own.
function projectPresentCharacters(project, snapshot, chapter, povId) {
  const cast = chapter.characters.length > 0
    ? chapter.characters
    : (snapshot ? snapshot.characters.map((entry) => entry.id) : []);

  return cast
    .filter((id) => id !== povId)
    .map((id) => project.characters.find((character) => character.id === id))
    .filter(Boolean)
    .map((character) => {
      const state = findEntry(snapshot, "characters", character.id);
      const observable = {};

      for (const field of OBSERVABLE_STATE_FIELDS) {
        if (state && state[field]) {
          observable[field] = state[field];
        }
      }

      return {
        id: character.id,
        name: character.name,
        status: character.status,
        observable
      };
    });
}

function projectLocation(project, povState) {
  if (!povState || !povState.location) {
    return {};
  }

  const location = project.locations.find((item) => item.id === povState.location);
  if (!location) {
    return { id: povState.location };
  }

  return { id: location.id, name: location.name, type: location.type, region: location.region };
}

// Objects the character carries, or that sit in the room with them.
//
// Co-location is not visibility. An artifact recorded as hidden, lost, or
// destroyed does not enter a bystander's context just because they are standing
// in the same place -- that would hand the prose model a concealed object as
// scene furniture. The owner is the exception: they know what they hid.
function projectObjects(project, snapshot, povId, povState) {
  if (!snapshot) {
    return [];
  }

  const here = povState ? povState.location : "";

  return snapshot.objects
    .filter((entry) => entry.owner === povId
      || (here && entry.location === here && !CONCEALED_OBJECT_STATUSES.has(String(entry.status ?? ""))))
    .map((entry) => {
      const artifact = project.artifacts.find((item) => item.id === entry.id);
      return {
        id: entry.id,
        name: artifact ? artifact.name : entry.id,
        ...withoutId(entry)
      };
    });
}

function causality(character) {
  const fields = {};
  for (const [key, value] of Object.entries(character.causality ?? {})) {
    if (value) {
      fields[key] = value;
    }
  }
  return fields;
}

function findEntry(snapshot, collection, id) {
  if (!snapshot) {
    return null;
  }
  return snapshot[collection].find((entry) => entry && entry.id === id) ?? null;
}

function withoutId(entry) {
  const { id, ...rest } = entry;
  return rest;
}

function countVisible(knowledge) {
  return Object.values(knowledge).reduce((sum, list) => sum + list.length, 0);
}

export { VISIBLE_STATUSES, EPISTEMIC_STATUSES };
