import { constraintsForChapter } from "./arcs.js";
import { projectContext } from "./projection.js";

// Feature 6: compact render packets.
//
// The prose model does not receive the planning dossier. It receives the
// smallest thing that lets it write the scene well:
//
//   PLAN  ≠  RENDER PACKET  ≠  PROSE
//
// A plan is for the author and the reviewer. A render packet is for the writer.
// It carries constraints and pressure, not instructions and not internals.
//
// What is deliberately absent: world truth the POV character cannot hold, any
// other character's interior state, future plot beyond this chapter, reviewer
// diagnostics, and the arc's long-range payoffs that this chapter does not owe.

export const RENDER_PACKET_VERSION = 1;

// Stated inside the packet itself so the writing model reads it as part of the
// brief rather than inferring the contract from field names.
const GUIDANCE = {
  "hard-constraints": "Mandatory. Do not violate any of these.",
  "possible-beats": "Optional. Suggestions only; discard any that do not serve the scene.",
  freedom: "You may discover better local action, dialogue, blocking, or emotional turns than the ones suggested, provided every hard constraint, the POV character's knowledge, and canonical state remain intact.",
  "not-a-script": "Do not transcribe planning notes into prose. Write the scene."
};

// Voice is external. How a character speaks is observable to anyone in the room,
// so a voice card may carry it. Interior fields never appear here.
const VOICE_FIELDS = ["speech-principle", "avoidance-pattern"];

export function buildRenderPacket(project, options = {}) {
  const projection = projectContext(project, options);
  const chapter = project.chapters.find((item) => item.id === projection.chapter);
  const chapterNumber = chapter ? chapter.number : chapterNumberFrom(projection.chapter);
  const scene = findScene(project, projection.chapter, options.scene);

  return {
    version: RENDER_PACKET_VERSION,
    chapter: projection.chapter,
    scene: scene ? scene.id : "",
    pov: projection.pov,
    guidance: GUIDANCE,

    narrative: {
      tense: projection.narrative.tense,
      person: projection.narrative.pov,
      genre: projection.narrative.genre,
      distance: options.distance ?? "close",
      "style-profile": options["style-profile"] ?? ""
    },

    "scene-contract": buildSceneContract(scene, projection),

    "hard-constraints": buildHardConstraints(project, projection, scene, chapterNumber),

    knowledge: projection.knowledge,

    relationships: projection.relationships,

    "voice-cards": buildVoiceCards(project, projection),

    "reveal-budget": buildRevealBudget(project, projection, chapterNumber),

    "possible-beats": buildPossibleBeats(project, scene, projection.chapter),

    "previous-scene": {
      "ending-state": projection.state,
      "story-time": projection["story-time"],
      "active-threads": projection["active-threads"]
    },

    setting: {
      location: projection.location,
      present: projection.present,
      objects: projection.objects
    },

    "word-budget": buildWordBudget(options)
  };
}

function buildSceneContract(scene, projection) {
  if (!scene) {
    return {
      objective: "",
      "active-opposition": "",
      "emotional-pressure": "",
      turn: "",
      "exit-consequence": "",
      note: `No scene record found for ${projection.chapter}; the writer sets the scene shape.`
    };
  }

  return {
    objective: scene.objective,
    "active-opposition": scene.opposition,
    "emotional-pressure": scene.emotionalPressure,
    turn: scene.turn,
    "exit-consequence": scene.exitConsequence
  };
}

// Three kinds of mandatory statement, kept separate because they fail
// differently: a missing fact is an omission, a forbidden outcome is a breach,
// a continuity requirement is a contradiction.
function buildHardConstraints(project, projection, scene, chapterNumber) {
  const arcConstraints = constraintsForChapter(project, projection.chapter, chapterNumber);

  const mandatoryFacts = [];
  const forbiddenOutcomes = [];
  const continuityRequirements = [];

  for (const constraint of arcConstraints) {
    const text = String(constraint.constraint ?? "");
    if (!text) {
      continue;
    }

    // A constraint protecting a secret is itself written in terms of that
    // secret: "Sarah must not learn that Robert killed Elizabeth." Passing that
    // text to the prose model leaks precisely what it guards. When the named
    // fact is outside this POV's projection, emit a content-free directive
    // instead -- the knowledge block already bounds what the character can hold,
    // so the constraint is enforced by absence rather than by instruction.
    if (constraint.fact && !knownToPov(projection, constraint.fact)) {
      forbiddenOutcomes.push(`${projection.pov} must not learn, infer, or be told anything beyond the knowledge listed in this packet.`);
      continue;
    }

    if (constraint.kind === "knowledge" || constraint.kind === "reveal") {
      forbiddenOutcomes.push(text);
    } else {
      continuityRequirements.push(text);
    }
  }

  for (const constraint of (scene ? scene.hardConstraints : [])) {
    const text = typeof constraint === "string" ? constraint : String(constraint?.constraint ?? "");
    if (text) {
      continuityRequirements.push(text);
    }
  }

  // What the POV character misbelieves is mandatory: the prose must not quietly
  // correct them.
  for (const entry of projection.knowledge.misbelieves ?? []) {
    forbiddenOutcomes.push(`${projection.pov} must not discover that this is false in this scene: ${entry.statement}`);
  }

  for (const entry of projection.knowledge.knows ?? []) {
    mandatoryFacts.push(entry.statement);
  }

  return {
    "mandatory-facts": unique(mandatoryFacts),
    "forbidden-outcomes": unique(forbiddenOutcomes),
    "continuity-requirements": unique(continuityRequirements)
  };
}

function buildVoiceCards(project, projection) {
  const ids = [projection.pov, ...projection.present.map((item) => item.id)];

  return ids
    .map((id) => project.characters.find((character) => character.id === id))
    .filter(Boolean)
    .map((character) => {
      const card = { id: character.id, name: character.name };
      for (const field of VOICE_FIELDS) {
        if (character.causality[field]) {
          card[field] = character.causality[field];
        }
      }
      return card;
    })
    .filter((card) => card.id === projection.pov || Object.keys(card).length > 2);
}

// What the reader is allowed to learn in this chapter. Facts resolving later
// stay out, so the packet cannot leak the shape of a future reveal.
function buildRevealBudget(project, projection, chapterNumber) {
  return project.facts
    .filter((fact) => fact.resolvedIn === projection.chapter)
    .filter((fact) => knownToPov(projection, fact.id))
    .map((fact) => ({ fact: fact.id, statement: fact.statement }));
}

function knownToPov(projection, factId) {
  return Object.values(projection.knowledge)
    .some((entries) => entries.some((entry) => entry.fact === factId));
}

function buildPossibleBeats(project, scene, chapterId) {
  const beats = [];

  for (const arc of project.arcs) {
    if (arc.chapters.length > 0 && !arc.chapters.includes(chapterId)) {
      continue;
    }
    for (const possibility of arc.softPossibilities) {
      beats.push(typeof possibility === "string" ? possibility : String(possibility?.beat ?? ""));
    }
  }

  for (const beat of (scene ? scene.softBeats : [])) {
    beats.push(typeof beat === "string" ? beat : String(beat?.beat ?? ""));
  }

  return beats.filter(Boolean);
}

function buildWordBudget(options) {
  const target = Number(options["word-target"] ?? options.words ?? 2500);
  return {
    min: Math.round(target * 0.8),
    target,
    max: Math.round(target * 1.25)
  };
}

function findScene(project, chapterId, sceneNumber) {
  const scenes = project.scenes.filter((scene) => scene.chapter === chapterId);
  if (scenes.length === 0) {
    return null;
  }

  if (sceneNumber === undefined || sceneNumber === "") {
    return scenes[0];
  }

  return scenes.find((scene) => scene.scene === Number(sceneNumber)) ?? null;
}

function unique(values) {
  return [...new Set(values)];
}

function chapterNumberFrom(chapterId) {
  const parsed = Number(String(chapterId).replace(/[^0-9]/g, ""));
  return Number.isInteger(parsed) ? parsed : 0;
}
