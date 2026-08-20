import { projectContext } from "./projection.js";

// Feature 4: the deterministic half of arc-level causal simulation.
//
// This assembles the brief a model needs in order to simulate an arc: each
// character's goal, pressure, resources, and -- the part a model must not guess
// -- exactly what they know at the moment the arc opens, taken from the
// epistemic graph rather than from memory of earlier chapters.
//
// It does not simulate. Deciding what a character would plausibly do, on the
// page and off it, is creative judgement. The brief is the input to that
// judgement, and `checkCausalChains` is the check applied to its output.

export const ARC_SIMULATION_VERSION = 1;

const GUIDANCE = {
  task: "Simulate what each character does across this arc, on the page and off it, given their goal, pressure, resources, and what they actually know at the arc's opening.",
  "hard-constraints": "Mandatory. A simulated action that violates one of these is wrong, however plausible it seems.",
  knowledge: "Each character's knowledge block is what they hold at the arc's opening. Do not have them act on anything outside it unless a step in your chain makes them learn it first.",
  "offscreen-actions": "Antagonists and absent characters keep acting while the POV is elsewhere. Say what they do, not only what the reader sees.",
  "deceased-characters": "A character marked with a simulation-note takes no new action. They shape the arc only through what they left behind.",
  "causal-chain": "Return an ordered chain of cause and effect. Where a step makes someone learn a canonical fact, name it in `learns` so the constraint checker can verify it.",
  "not-a-beat-sheet": "This is causal reasoning, not an outline. Leave room for the drafting to find better local action."
};

export function buildArcSimulation(project, options = {}) {
  const arcId = String(options.arc ?? "").trim();
  const arc = project.arcs.find((item) => item.id === arcId);

  if (!arc) {
    throw new Error(`Unknown arc: ${arcId || "(unset)"}`);
  }

  if (arc.chapters.length === 0) {
    throw new Error(`${arc.id} has no chapters; add a chapters list before simulating`);
  }

  const opening = arc.chapters[0];

  return {
    version: ARC_SIMULATION_VERSION,
    arc: arc.id,
    name: arc.name,
    "plan-version": arc.planVersion,
    "sealed-version": arc.sealedVersion,
    chapters: arc.chapters,
    guidance: GUIDANCE,

    objective: {
      "dramatic-objective": arc.dramaticObjective,
      "starting-state": arc.startingState,
      "target-end-state": arc.targetEndState
    },

    "hard-constraints": arc.hardConstraints,
    "required-setups": arc.requiredSetups,
    "required-payoffs": arc.requiredPayoffs,
    "soft-possibilities": arc.softPossibilities,

    characters: buildCharacterBriefs(project, arc, opening),

    "open-questions": project.questions
      .filter((question) => question.status === "open")
      .map((question) => ({ id: question.id, title: question.title, introduced: question.introduced })),

    "unpaid-promises": project.promises
      .filter((promise) => promise.status === "planted")
      .map((promise) => ({ id: promise.id, title: promise.title, planted: promise.planted })),

    "causal-chain": arc.causalChain
  };
}

// Each character is briefed from their own epistemic position. Two characters in
// the same arc get genuinely different pictures, which is the point: an
// antagonist acting on what the protagonist knows is the failure this prevents.
function buildCharacterBriefs(project, arc, opening) {
  const declared = new Map(
    arc.arcCharacters
      .filter((entry) => entry && typeof entry === "object" && entry.id)
      .map((entry) => [entry.id, entry])
  );

  const ids = [...new Set([...declared.keys(), ...arc.characters])];

  return ids
    .map((id) => {
      const character = project.characters.find((item) => item.id === id);
      if (!character) {
        return null;
      }

      const entry = declared.get(id) ?? {};
      const projection = safeProjection(project, opening, id);

      // A character who is already dead still shapes an arc -- often it is their
      // death the arc is about -- but they take no new action. Briefing them as
      // an agent with a goal invites a model to simulate offscreen behaviour for
      // someone who cannot have any, which the continuity checker would then
      // reject when it reached the page.
      if (!canAct(character)) {
        return {
          id,
          name: character.name,
          role: character.role,
          status: character.status,
          "died-in": character.diedIn,
          "simulation-note": "Takes no new action. May shape this arc only through evidence, memory, record, or what they left behind.",
          "knowledge-at-arc-start": projection ? projection.knowledge : {}
        };
      }

      return {
        id,
        name: character.name,
        role: character.role,
        status: character.status,
        goal: entry.goal ?? character.causality["external-goal"] ?? "",
        pressure: entry.pressure ?? "",
        resources: entry.resources ?? "",
        "likely-actions": entry["likely-actions"] ?? "",
        "offscreen-actions": entry["offscreen-actions"] ?? "",
        ...interiorFields(character),
        "knowledge-at-arc-start": projection ? projection.knowledge : {},
        "state-at-arc-start": projection ? projection.state : {}
      };
    })
    .filter(Boolean);
}

// Simulation is the one place interior state is legitimately in scope for every
// character: it is the author reasoning about the whole cast, not a POV writing
// a scene. Render packets remain strictly POV-limited.
function interiorFields(character) {
  const fields = {};
  for (const key of ["internal-need", "fear", "false-belief", "private-information", "stress-response"]) {
    if (character.causality[key]) {
      fields[key] = character.causality[key];
    }
  }
  return fields;
}

// Only characters who can still act are briefed as agents. `unknown` and
// `missing` count as able to act: a missing character is very often acting, just
// not where the reader can see.
function canAct(character) {
  return character.status !== "deceased";
}

function safeProjection(project, chapterId, povId) {
  try {
    return projectContext(project, { chapter: chapterId, pov: povId });
  } catch {
    // A character with no projectable position yet still belongs in the brief.
    return null;
  }
}
