import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { checkContinuity } from "./continuity.js";
import { parseFrontmatter, replaceFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { chapterProse, escapeRegExp, extractSection, kebabCase, titleCaseSlug, wordCount } from "./markdown.js";
import {
  assertLexicallyInsideRoot,
  assertSafeProjectDirectory,
  assertSafeProjectPath,
  readMarkdown,
  safeRead,
  writeFile
} from "./project-io.js";
import { CONFIDENCE_LEVELS, EPISTEMIC_STATUSES, PRE_STORY, checkEpistemicGraph } from "./epistemic.js";
import { checkRelationships } from "./relationships.js";
import { projectContext } from "./projection.js";
import { checkArcs, checkCausalChains } from "./arcs.js";
import { buildArcSimulation } from "./arc-simulation.js";
import { buildRenderPacket } from "./render-packet.js";
import { analyzeProse } from "./prose-diagnostics.js";
import { checkTransactions, planAcceptance, planRejection } from "./transactions.js";
import { checkStateSnapshots, resolveCurrentSnapshot } from "./state.js";
import {
  currentState,
  factFile,
  relationshipFile,
  factIndex,
  knowledgeFile,
  knowledgeIndex,
  relationshipIndex,
  sealedArcPlan,
  stateIndex,
  stateSnapshot
} from "./v3-templates.js";

export const STORY_SCHEMA_VERSION = 3;

// Schema v2 projects stay valid. v3 directories activate progressively: a
// project only gets v3 checks once the matching directories exist.
const LEGACY_SCHEMA_VERSIONS = new Set([2]);

const V3_DIRECTORIES = [
  path.join("continuity", "facts"),
  path.join("continuity", "knowledge"),
  path.join("continuity", "relationships"),
  path.join("continuity", "state")
];

const REQUIRED_PATHS = [
  "story.md",
  "characters/_index.md",
  "worldbuilding/_index.md",
  "worldbuilding/locations",
  "worldbuilding/systems",
  "worldbuilding/factions",
  "worldbuilding/artifacts",
  "plot/_index.md",
  "plot/arcs",
  "plot/timeline.md",
  "chapters/_index.md",
  "scenes/_index.md",
  "continuity/state.md",
  "continuity/questions/_index.md",
  "continuity/questions",
  "continuity/promises/_index.md",
  "continuity/promises",
  "glossary/_index.md",
  "glossary/terms"
];

const INDEX_SCHEMAS = [
  [path.join("characters", "_index.md"), "character-registry"],
  [path.join("worldbuilding", "_index.md"), "world-registry"],
  [path.join("plot", "_index.md"), "plot-registry"],
  [path.join("plot", "timeline.md"), "timeline"],
  [path.join("chapters", "_index.md"), "chapter-registry"],
  [path.join("scenes", "_index.md"), "scene-registry"],
  [path.join("continuity", "questions", "_index.md"), "question-registry"],
  [path.join("continuity", "promises", "_index.md"), "promise-registry"],
  [path.join("glossary", "_index.md"), "glossary-registry"]
];

// Optional depth fields on a character. Absent by default; the schema supports
// richer causality without making a short story painful to author.
const CHARACTER_CAUSALITY_FIELDS = [
  "external-goal",
  "internal-need",
  "fear",
  "false-belief",
  "private-information",
  "dependencies",
  "leverage",
  "contradictions",
  "stress-response",
  "speech-principle",
  "avoidance-pattern"
];

const STORY_STATUSES = new Set(["planning", "drafting", "in-progress", "revising", "complete", "abandoned"]);
const STORY_TENSES = new Set(["past", "present", "future", "mixed"]);
const CHARACTER_ROLES = new Set(["protagonist", "antagonist", "supporting", "minor", "narrator", "deuteragonist"]);
const CHARACTER_STATUSES = new Set(["alive", "deceased", "unknown", "missing"]);
const ARC_TYPES = new Set(["main", "subplot", "character", "thematic"]);
const ARC_STATUSES = new Set(["planned", "in-progress", "resolved"]);
const CHAPTER_STATUSES = new Set(["outline", "draft", "revised", "final", "complete"]);
const SCENE_STATUSES = new Set(["outline", "draft", "revised", "final", "complete"]);
const FACTION_TYPES = new Set(["family", "guild", "government", "military", "religion", "company", "community", "criminal", "other"]);
const FACTION_STATUSES = new Set(["active", "hidden", "declining", "defeated", "disbanded", "unknown"]);
const ARTIFACT_TYPES = new Set(["object", "weapon", "document", "technology", "relic", "symbol", "resource", "other"]);
const ARTIFACT_STATUSES = new Set(["active", "lost", "destroyed", "hidden", "transferred", "unknown"]);
const QUESTION_STATUSES = new Set(["open", "answered", "resolved", "dropped"]);
const PROMISE_STATUSES = new Set(["planned", "planted", "paid-off", "dropped"]);
const TERM_CATEGORIES = new Set(["person", "place", "faction", "artifact", "concept", "term", "other"]);

const RELATIONSHIP_INVERSES = new Map([
  ["parent", "child"],
  ["child", "parent"],
  ["grandparent", "grandchild"],
  ["grandchild", "grandparent"],
  ["uncle", "nephew"],
  ["aunt", "niece"],
  ["nephew", "uncle"],
  ["niece", "aunt"],
  ["mentor", "student"],
  ["student", "mentor"],
  ["employer", "subordinate"],
  ["subordinate", "employer"]
]);

const SYMMETRIC_RELATIONSHIPS = new Set([
  "sibling",
  "spouse",
  "partner",
  "friend",
  "ally",
  "rival",
  "enemy",
  "cousin",
  "colleague",
  "foil",
  "confidant",
  "love-interest"
]);

export function createStoryProject(options) {
  const title = String(options.title ?? "").trim();
  if (!title) {
    throw new Error("A story title is required");
  }

  const storyId = kebabCase(title);
  const root = path.resolve(options.cwd ?? process.cwd(), options.dir ?? storyId);
  if (fs.existsSync(root) && !options.force) {
    throw new Error(`${root} already exists. Use --force to overwrite starter files.`);
  }

  const themes = normalizeList(options.themes, ["change"]);
  fs.mkdirSync(path.join(root, "characters"), { recursive: true });
  fs.mkdirSync(path.join(root, "worldbuilding", "locations"), { recursive: true });
  fs.mkdirSync(path.join(root, "worldbuilding", "systems"), { recursive: true });
  fs.mkdirSync(path.join(root, "worldbuilding", "factions"), { recursive: true });
  fs.mkdirSync(path.join(root, "worldbuilding", "artifacts"), { recursive: true });
  fs.mkdirSync(path.join(root, "plot", "arcs"), { recursive: true });
  fs.mkdirSync(path.join(root, "chapters"), { recursive: true });
  fs.mkdirSync(path.join(root, "scenes"), { recursive: true });
  fs.mkdirSync(path.join(root, "continuity", "questions"), { recursive: true });
  fs.mkdirSync(path.join(root, "continuity", "promises"), { recursive: true });
  fs.mkdirSync(path.join(root, "glossary", "terms"), { recursive: true });

  writeFile(path.join(root, "story.md"), storyBible({
    title,
    storyId,
    genre: options.genre ?? "fiction",
    subGenre: options.subGenre ?? "general",
    settingEra: options.settingEra ?? "unspecified",
    themes,
    pov: options.pov ?? "third-person-limited",
    tense: options.tense ?? "past",
    synopsis: options.synopsis ?? "Add a 2-3 sentence synopsis here."
  }), { root });
  writeFile(path.join(root, "characters", "_index.md"), characterIndex(storyId, [], "", ""), { root });
  writeFile(path.join(root, "worldbuilding", "_index.md"), worldIndex(storyId, [], [], [], [], ""), { root });
  writeFile(path.join(root, "plot", "_index.md"), plotIndex(storyId, "three-act", [], "", ""), { root });
  writeFile(path.join(root, "plot", "timeline.md"), timeline(storyId), { root });
  writeFile(path.join(root, "chapters", "_index.md"), chapterIndex(storyId, []), { root });
  writeFile(path.join(root, "scenes", "_index.md"), sceneIndex(storyId, []), { root });
  writeFile(path.join(root, "continuity", "state.md"), continuityState(storyId), { root });
  writeFile(path.join(root, "continuity", "questions", "_index.md"), questionIndex(storyId, []), { root });
  writeFile(path.join(root, "continuity", "promises", "_index.md"), promiseIndex(storyId, []), { root });
  writeFile(path.join(root, "glossary", "_index.md"), glossaryIndex(storyId, []), { root });

  // A new project starts at schema v3, so it gets the v3 layout up front. The
  // directories stay empty until the author uses them, which keeps a short story
  // from having to reason about facts or knowledge at all.
  migrateToV3(root, storyId, []);

  return { root, storyId, files: REQUIRED_PATHS.filter((entry) => entry.endsWith(".md")) };
}

export function scanProject(root) {
  const projectRoot = path.resolve(root);
  const story = readMarkdown(path.join(projectRoot, "story.md"), projectRoot);
  const storyId = kebabCase(story.data.title ?? path.basename(projectRoot));

  return {
    root: projectRoot,
    story,
    storyId,
    characters: readEntityFiles(projectRoot, "characters", (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      role: data.role ?? "",
      status: data.status ?? "",
      diedIn: data["died-in"] ?? "",
      relationships: asArray(data.relationships),
      locations: asArray(data.locations),
      // Feature 13: optional character causality. Every field is opt-in so a
      // lightweight story never has to fill any of them in.
      causality: Object.fromEntries(CHARACTER_CAUSALITY_FIELDS
        .filter((field) => data[field] !== undefined && data[field] !== "")
        .map((field) => [field, data[field]]))
    })),
    locations: readEntityFiles(projectRoot, path.join("worldbuilding", "locations"), (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      region: data.region ?? "",
      notableCharacters: asArray(data["notable-characters"])
    })),
    systems: readEntityFiles(projectRoot, path.join("worldbuilding", "systems"), (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? ""
    })),
    factions: readEntityFiles(projectRoot, path.join("worldbuilding", "factions"), (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      status: data.status ?? "",
      members: asArray(data.members),
      locations: asArray(data.locations)
    })),
    artifacts: readEntityFiles(projectRoot, path.join("worldbuilding", "artifacts"), (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      status: data.status ?? "",
      owner: data.owner ?? "",
      location: data.location ?? ""
    })),
    arcs: readEntityFiles(projectRoot, path.join("plot", "arcs"), (id, file, data, markdown) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      status: data.status ?? "",
      characters: asArray(data.characters),
      themes: asArray(data.themes),
      // v3 arc plan. All optional: a v2 arc scans with empty plan fields.
      chapters: asArray(data.chapters),
      planVersion: Number(data["plan-version"] ?? 0),
      sealedVersion: data["sealed-version"] ?? "",
      dramaticObjective: data["dramatic-objective"] ?? "",
      startingState: data["starting-state"] ?? "",
      targetEndState: data["target-end-state"] ?? "",
      hardConstraints: asArray(data["hard-constraints"]),
      requiredSetups: asArray(data["required-setups"]),
      requiredPayoffs: asArray(data["required-payoffs"]),
      softPossibilities: asArray(data["soft-possibilities"]),
      causalChain: asArray(data["causal-chain"]),
      arcCharacters: asArray(data["arc-characters"]),
      rawData: data,
      rawMarkdown: markdown.rawMarkdown
    })),
    sealedArcs: readEntityFiles(projectRoot, path.join("plot", "arcs", "sealed"), (id, file, data) => ({
      id,
      file,
      arc: data.arc ?? "",
      version: Number(data["plan-version"] ?? 0),
      chapters: asArray(data.chapters),
      dramaticObjective: data["dramatic-objective"] ?? "",
      hardConstraints: asArray(data["hard-constraints"]),
      requiredSetups: asArray(data["required-setups"]),
      requiredPayoffs: asArray(data["required-payoffs"]),
      softPossibilities: asArray(data["soft-possibilities"]),
      rawData: data
    })),
    chapters: readEntityFiles(projectRoot, "chapters", (id, file, data, markdown) => ({
      id,
      file,
      title: data.title ?? titleCaseSlug(id),
      number: Number(data.number ?? chapterNumberFromFile(file) ?? 0),
      pov: data.pov ?? "",
      status: data.status ?? "",
      characters: asArray(data.characters),
      mentions: asArray(data.mentions),
      locations: asArray(data.locations),
      arcsAdvanced: asArray(data["arcs-advanced"]),
      declaredWordCount: Number(data["word-count"] ?? 0),
      wordCount: wordCount(chapterProse(markdown.body)),
      rawMarkdown: markdown.rawMarkdown
    })).sort((left, right) => left.number - right.number || left.file.localeCompare(right.file)),
    scenes: readEntityFiles(projectRoot, "scenes", (id, file, data) => ({
      id,
      file,
      title: data.title ?? titleCaseSlug(id),
      // Coerce before the localeCompare sort below: a hand-written
      // `chapter: 3` parses as a number and must surface as a link error,
      // not a crash.
      chapter: String(data.chapter ?? ""),
      scene: Number(data.scene ?? sceneNumberFromFile(file) ?? 0),
      pov: data.pov ?? "",
      location: data.location ?? "",
      status: data.status ?? "",
      characters: asArray(data.characters),
      mentions: asArray(data.mentions),
      arcsAdvanced: asArray(data["arcs-advanced"]),
      stateChanges: asArray(data["state-changes"]),
      // Feature 15: the scene contract. All optional, so v2 scenes keep working.
      objective: data.objective ?? "",
      opposition: data.opposition ?? "",
      turn: data.turn ?? "",
      exitConsequence: data["exit-consequence"] ?? "",
      emotionalPressure: data["emotional-pressure"] ?? "",
      hardConstraints: asArray(data["hard-constraints"]),
      softBeats: asArray(data["soft-beats"]),
      knowledgeChanges: asArray(data["knowledge-changes"]),
      relationshipChanges: asArray(data["relationship-changes"])
    })).sort((left, right) => left.chapter.localeCompare(right.chapter) || left.scene - right.scene || left.file.localeCompare(right.file)),
    questions: readEntityFiles(projectRoot, path.join("continuity", "questions"), (id, file, data, markdown) => ({
      id,
      file,
      title: data.title ?? titleCaseSlug(id),
      status: data.status ?? "",
      introduced: data.introduced ?? "",
      resolved: data.resolved ?? "",
      characters: asArray(data.characters),
      rawData: data,
      rawMarkdown: markdown.rawMarkdown
    })),
    promises: readEntityFiles(projectRoot, path.join("continuity", "promises"), (id, file, data, markdown) => ({
      id,
      file,
      title: data.title ?? titleCaseSlug(id),
      status: data.status ?? "",
      planted: data.planted ?? "",
      payoff: data.payoff ?? "",
      arcs: asArray(data.arcs),
      characters: asArray(data.characters),
      rawData: data,
      rawMarkdown: markdown.rawMarkdown
    })),
    glossaryTerms: readEntityFiles(projectRoot, path.join("glossary", "terms"), (id, file, data) => ({
      id,
      file,
      term: data.term ?? titleCaseSlug(id),
      category: data.category ?? "",
      aliases: asArray(data.aliases)
    })),
    facts: readEntityFiles(projectRoot, path.join("continuity", "facts"), (id, file, data, markdown) => ({
      id,
      file,
      declaredId: data.id ?? "",
      statement: data.statement ?? "",
      truthStatus: String(data["truth-status"] ?? ""),
      establishedIn: data["established-in"] ?? "",
      resolvedIn: data["resolved-in"] ?? "",
      tags: asArray(data.tags),
      rawData: data,
      rawMarkdown: markdown.rawMarkdown
    })),
    knowledge: readEntityFiles(projectRoot, path.join("continuity", "knowledge"), (id, file, data, markdown) => ({
      id,
      file,
      declaredCharacter: data.character ?? "",
      character: data.character || id,
      facts: asArray(data.facts),
      rawData: data,
      rawMarkdown: markdown.rawMarkdown
    })),
    relationships: readEntityFiles(projectRoot, path.join("continuity", "relationships"), (id, file, data) => ({
      id,
      file,
      declaredId: data.id ?? "",
      participants: asArray(data.participants),
      state: asMapping(data.state),
      publicStatus: data["public-status"] ?? "",
      privateStatus: data["private-status"] ?? "",
      lastMajorChange: data["last-major-change"] ?? "",
      rawData: data
    })),
    // `current.md` is a generated pointer, not a snapshot, so it never enters
    // the ordered history.
    stateSnapshots: readEntityFiles(projectRoot, path.join("continuity", "state"), (id, file, data) => ({
      id,
      file,
      chapter: data.chapter ?? "",
      sequence: Number(data.sequence ?? 0),
      provisional: String(data.provisional ?? "false") === "true",
      storyTime: asMapping(data["story-time"]),
      characters: asArray(data.characters),
      objects: asArray(data.objects),
      relationships: asArray(data.relationships),
      activeThreads: asArray(data["active-threads"]),
      readerKnowledge: asArray(data["reader-knowledge"]),
      rawData: data
    })).filter((snapshot) => snapshot.id !== "current")
      .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id)),
    candidates: readCandidates(projectRoot),
    transactions: readTransactions(projectRoot),
    timeline: safeRead(path.join(projectRoot, "plot", "timeline.md"), projectRoot),
    currentState: fs.existsSync(path.join(projectRoot, "continuity", "state", "current.md"))
      ? readMarkdown(path.join(projectRoot, "continuity", "state", "current.md"), projectRoot)
      : null,
    continuity: fs.existsSync(path.join(projectRoot, "continuity", "state.md"))
      ? readMarkdown(path.join(projectRoot, "continuity", "state.md"), projectRoot)
      : null
  };
}

export function validateProject(root) {
  const projectRoot = path.resolve(root);
  const errors = [];
  const warnings = [];

  for (const requiredPath of REQUIRED_PATHS) {
    if (!fs.existsSync(path.join(projectRoot, requiredPath))) {
      errors.push(`Missing required path: ${requiredPath}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  const project = scanProject(projectRoot);
  validateStoryFrontmatter(project, errors);
  validateIndexFrontmatter(project, errors);
  validateCharacters(project, errors);
  validateLocations(project, errors);
  validateSystems(project, errors);
  validateFactions(project, errors);
  validateArtifacts(project, errors);
  validateArcs(project, errors);
  validateChapters(project, errors);
  validateScenes(project, errors);
  validateContinuityState(project, errors);
  validateQuestions(project, errors);
  validatePromises(project, errors);
  validateGlossaryTerms(project, errors);
  validateV3Structure(project, errors);

  const indexChecks = [
    [path.join("characters", "_index.md"), project.characters.map((item) => `](${item.id}.md)`)],
    [path.join("worldbuilding", "_index.md"), project.locations.map((item) => `](locations/${item.id}.md)`)
      .concat(project.systems.map((item) => `](systems/${item.id}.md)`))
      .concat(project.factions.map((item) => `](factions/${item.id}.md)`))
      .concat(project.artifacts.map((item) => `](artifacts/${item.id}.md)`))],
    [path.join("plot", "_index.md"), project.arcs.map((item) => `](arcs/${item.id}.md)`)],
    [path.join("chapters", "_index.md"), project.chapters.map((item) => `](${path.basename(item.file)})`)],
    [path.join("scenes", "_index.md"), project.scenes.map((item) => `](${item.id}.md)`)],
    [path.join("continuity", "questions", "_index.md"), project.questions.map((item) => `](${item.id}.md)`)],
    [path.join("continuity", "promises", "_index.md"), project.promises.map((item) => `](${item.id}.md)`)],
    [path.join("glossary", "_index.md"), project.glossaryTerms.map((item) => `](terms/${item.id}.md)`)]
  ];

  for (const [indexPath, links] of indexChecks) {
    const markdown = safeRead(path.join(projectRoot, indexPath), projectRoot);
    for (const link of links) {
      if (!markdown.includes(link)) {
        warnings.push(`${indexPath} is missing registry link ${link}`);
      }
    }
  }

  for (const chapter of project.chapters) {
    if (chapter.declaredWordCount !== chapter.wordCount) {
      warnings.push(`${path.relative(projectRoot, chapter.file)} declares ${chapter.declaredWordCount} words but contains ${chapter.wordCount}`);
    }

    if (!project.scenes.some((scene) => scene.chapter === chapter.id)) {
      warnings.push(`${path.relative(projectRoot, chapter.file)} has no machine-readable scene records`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function validateLinks(root) {
  const project = scanProject(root);
  const errors = [];
  const warnings = [];
  const characters = new Map(project.characters.map((item) => [item.id, item]));
  const locations = new Map(project.locations.map((item) => [item.id, item]));
  const chapters = new Map(project.chapters.map((item) => [item.id, item]));
  const arcs = new Map(project.arcs.map((item) => [item.id, item]));
  const factions = new Map(project.factions.map((item) => [item.id, item]));

  for (const character of project.characters) {
    for (const relationship of character.relationships) {
      const target = relationship.character;
      if (!characters.has(target)) {
        errors.push(`${relative(project, character.file)} references missing character ${target}`);
      } else if (!characters.get(target).relationships.some((entry) => entry.character === character.id)) {
        errors.push(`${relative(project, character.file)} relationship to ${target} is missing backlink`);
      } else {
        const backlink = characters.get(target).relationships.find((entry) => entry.character === character.id);
        const expectedType = inverseRelationshipType(relationship.type);
        if (expectedType && backlink.type !== expectedType) {
          errors.push(`${relative(project, character.file)} relationship ${relationship.type} to ${target} expects backlink type ${expectedType}, got ${backlink.type}`);
        }
      }
    }

    for (const locationId of character.locations) {
      if (!locations.has(locationId)) {
        errors.push(`${relative(project, character.file)} references missing location ${locationId}`);
      } else if (!locations.get(locationId).notableCharacters.includes(character.id)) {
        errors.push(`${relative(project, character.file)} location ${locationId} is missing notable-character backlink`);
      }
    }
  }

  for (const location of project.locations) {
    for (const characterId of location.notableCharacters) {
      if (!characters.has(characterId)) {
        errors.push(`${relative(project, location.file)} references missing character ${characterId}`);
      } else if (!characters.get(characterId).locations.includes(location.id)) {
        errors.push(`${relative(project, location.file)} notable character ${characterId} is missing location backlink`);
      }
    }
  }

  for (const arc of project.arcs) {
    for (const characterId of arc.characters) {
      if (!characters.has(characterId)) {
        errors.push(`${relative(project, arc.file)} references missing character ${characterId}`);
      }
    }
  }

  for (const chapter of project.chapters) {
    if (chapter.pov && !characters.has(chapter.pov)) {
      errors.push(`${relative(project, chapter.file)} references missing POV character ${chapter.pov}`);
    }

    for (const characterId of chapter.characters.concat(chapter.mentions)) {
      if (!characters.has(characterId)) {
        errors.push(`${relative(project, chapter.file)} references missing character ${characterId}`);
      }
    }
    for (const locationId of chapter.locations) {
      if (!locations.has(locationId)) {
        errors.push(`${relative(project, chapter.file)} references missing location ${locationId}`);
      }
    }
    for (const arcId of chapter.arcsAdvanced) {
      if (!arcs.has(arcId)) {
        errors.push(`${relative(project, chapter.file)} references missing arc ${arcId}`);
      }
    }
  }

  for (const faction of project.factions) {
    for (const characterId of faction.members) {
      if (!characters.has(characterId)) {
        errors.push(`${relative(project, faction.file)} references missing member ${characterId}`);
      }
    }
    for (const locationId of faction.locations) {
      if (!locations.has(locationId)) {
        errors.push(`${relative(project, faction.file)} references missing location ${locationId}`);
      }
    }
  }

  for (const artifact of project.artifacts) {
    if (artifact.owner && !characters.has(artifact.owner) && !factions.has(artifact.owner)) {
      errors.push(`${relative(project, artifact.file)} references missing owner ${artifact.owner}`);
    }
    if (artifact.location && !locations.has(artifact.location)) {
      errors.push(`${relative(project, artifact.file)} references missing location ${artifact.location}`);
    }
  }

  for (const scene of project.scenes) {
    if (scene.chapter && !chapters.has(scene.chapter)) {
      errors.push(`${relative(project, scene.file)} references missing chapter ${scene.chapter}`);
    }
    if (scene.pov && !characters.has(scene.pov)) {
      errors.push(`${relative(project, scene.file)} references missing POV character ${scene.pov}`);
    }
    if (scene.location && !locations.has(scene.location)) {
      errors.push(`${relative(project, scene.file)} references missing location ${scene.location}`);
    }
    for (const characterId of scene.characters.concat(scene.mentions)) {
      if (!characters.has(characterId)) {
        errors.push(`${relative(project, scene.file)} references missing character ${characterId}`);
      }
    }
    for (const arcId of scene.arcsAdvanced) {
      if (!arcs.has(arcId)) {
        errors.push(`${relative(project, scene.file)} references missing arc ${arcId}`);
      }
    }
  }

  for (const question of project.questions) {
    for (const chapterId of [question.introduced, question.resolved].filter(Boolean)) {
      if (!chapters.has(chapterId)) {
        errors.push(`${relative(project, question.file)} references missing chapter ${chapterId}`);
      }
    }
    for (const characterId of question.characters) {
      if (!characters.has(characterId)) {
        errors.push(`${relative(project, question.file)} references missing character ${characterId}`);
      }
    }
  }

  for (const promise of project.promises) {
    for (const chapterId of [promise.planted, promise.payoff].filter(Boolean)) {
      if (!chapters.has(chapterId)) {
        errors.push(`${relative(project, promise.file)} references missing chapter ${chapterId}`);
      }
    }
    for (const arcId of promise.arcs) {
      if (!arcs.has(arcId)) {
        errors.push(`${relative(project, promise.file)} references missing arc ${arcId}`);
      }
    }
    for (const characterId of promise.characters) {
      if (!characters.has(characterId)) {
        errors.push(`${relative(project, promise.file)} references missing character ${characterId}`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function checkProjectContinuity(root) {
  const project = scanProject(root);
  return mergeChecks([
    checkContinuity(project),
    checkEpistemicGraph(project),
    checkRelationships(project),
    checkStateSnapshots(project),
    checkTransactions(project),
    checkArcs(project),
    checkCausalChains(project)
  ]);
}

function mergeChecks(results) {
  const errors = results.flatMap((result) => result.errors);
  const warnings = results.flatMap((result) => result.warnings);
  return { ok: errors.length === 0, errors, warnings };
}

export function projectReport(root) {
  const project = scanProject(root);
  const validation = validateProject(project.root);
  const links = validateLinks(project.root);
  const continuity = checkContinuity(project);
  const totalWords = project.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);

  return {
    root: project.root,
    title: project.story.data.title,
    storyId: project.storyId,
    schemaVersion: project.story.data["schema-version"],
    genre: project.story.data.genre,
    subGenre: project.story.data["sub-genre"],
    status: project.story.data.status,
    pov: project.story.data.pov,
    tense: project.story.data.tense,
    counts: {
      characters: project.characters.length,
      locations: project.locations.length,
      systems: project.systems.length,
      factions: project.factions.length,
      artifacts: project.artifacts.length,
      arcs: project.arcs.length,
      chapters: project.chapters.length,
      scenes: project.scenes.length,
      questions: project.questions.length,
      promises: project.promises.length,
      glossaryTerms: project.glossaryTerms.length,
      words: totalWords
    },
    chapters: project.chapters.map((chapter) => ({
      number: chapter.number,
      title: chapter.title,
      status: chapter.status,
      pov: chapter.pov,
      wordCount: chapter.wordCount
    })),
    arcs: project.arcs.map((arc) => ({
      name: arc.name,
      type: arc.type,
      status: arc.status,
      characters: arc.characters.length
    })),
    validation,
    links,
    continuity,
    actions: buildProjectActions(project, validation, links, continuity)
  };
}

export function formatProjectReport(report, options = {}) {
  const lines = [
    `# ${report.title}`,
    "",
    `Story ID: ${report.storyId}`,
    `Schema version: ${report.schemaVersion}`,
    `Status: ${report.status}`,
    `Genre: ${[report.genre, report.subGenre].filter(Boolean).join(" / ")}`,
    `POV/Tense: ${report.pov} / ${report.tense}`,
    "",
    "Inventory:",
    `- Characters: ${report.counts.characters}`,
    `- Locations: ${report.counts.locations}`,
    `- Systems: ${report.counts.systems}`,
    `- Factions: ${report.counts.factions}`,
    `- Artifacts: ${report.counts.artifacts}`,
    `- Arcs: ${report.counts.arcs}`,
    `- Chapters: ${report.counts.chapters}`,
    `- Scenes: ${report.counts.scenes}`,
    `- Questions: ${report.counts.questions}`,
    `- Promises: ${report.counts.promises}`,
    `- Glossary terms: ${report.counts.glossaryTerms}`,
    `- Total words: ${report.counts.words}`,
    "",
    "Chapters:"
  ];

  if (report.chapters.length === 0) {
    lines.push("- None");
  } else {
    for (const chapter of report.chapters) {
      lines.push(`- ${chapter.number}. ${chapter.title} (${chapter.status}, ${chapter.wordCount} words, POV: ${chapter.pov || "unspecified"})`);
    }
  }

  lines.push("", "Arcs:");
  if (report.arcs.length === 0) {
    lines.push("- None");
  } else {
    for (const arc of report.arcs) {
      lines.push(`- ${arc.name} (${arc.type}, ${arc.status}, ${arc.characters} characters)`);
    }
  }

  lines.push(
    "",
    "Checks:",
    `- Validate: ${formatCheck(report.validation)}`,
    `- Links: ${formatCheck(report.links)}`,
    `- Continuity: ${formatCheck(report.continuity)}`
  );

  if (options.actionable) {
    lines.push("", "Next Actions:");
    appendActionLines(lines, report.actions);
  }

  return `${lines.join("\n")}\n`;
}

export function projectActions(root) {
  const project = scanProject(root);
  const validation = validateProject(project.root);
  const links = validateLinks(project.root);
  const continuity = checkContinuity(project);
  return {
    root: project.root,
    title: project.story.data.title,
    storyId: project.storyId,
    actions: buildProjectActions(project, validation, links, continuity),
    validation,
    links,
    continuity
  };
}

export function formatActionReport(report) {
  const lines = [
    `# Next Writing Actions: ${report.title}`,
    "",
    `Checks: validate ${formatCheck(report.validation)}, links ${formatCheck(report.links)}, continuity ${formatCheck(report.continuity)}`,
    "",
    "Actions:"
  ];
  appendActionLines(lines, report.actions);
  return `${lines.join("\n")}\n`;
}

export function formatDoctorReport(report) {
  const lines = [
    `# Story Doctor: ${report.title}`,
    "",
    `Root: ${report.root}`,
    "",
    "Checks:",
    `- Validate: ${formatCheck(report.validation)}`,
    `- Links: ${formatCheck(report.links)}`,
    `- Continuity: ${formatCheck(report.continuity)}`,
    "",
    "Actions:"
  ];
  appendActionLines(lines, report.actions);
  return `${lines.join("\n")}\n`;
}

export function reindexProject(root) {
  const project = scanProject(root);
  const changed = [];
  const charactersIndexPath = path.join(project.root, "characters", "_index.md");
  const worldIndexPath = path.join(project.root, "worldbuilding", "_index.md");
  const plotIndexPath = path.join(project.root, "plot", "_index.md");
  const chaptersIndexPath = path.join(project.root, "chapters", "_index.md");
  const scenesIndexPath = path.join(project.root, "scenes", "_index.md");
  const questionsIndexPath = path.join(project.root, "continuity", "questions", "_index.md");
  const promisesIndexPath = path.join(project.root, "continuity", "promises", "_index.md");
  const glossaryIndexPath = path.join(project.root, "glossary", "_index.md");
  const existingCharacters = safeRead(charactersIndexPath, project.root);
  const existingWorld = safeRead(worldIndexPath, project.root);
  const existingPlot = safeRead(plotIndexPath, project.root);
  const plotFrontmatter = parseFrontmatter(existingPlot, "plot/_index.md").data;

  writeChanged(charactersIndexPath, characterIndex(
    project.storyId,
    project.characters,
    extractSection(existingCharacters, "Relationship Map"),
    extractSection(existingCharacters, "Family Trees")
  ), changed, project.root);
  writeChanged(worldIndexPath, worldIndex(
    project.storyId,
    project.locations,
    project.systems,
    project.factions,
    project.artifacts,
    extractSection(existingWorld, "World Overview")
  ), changed, project.root);
  writeChanged(plotIndexPath, plotIndex(
    project.storyId,
    plotFrontmatter.structure ?? "three-act",
    project.arcs,
    extractSection(existingPlot, "Story Structure"),
    extractSection(existingPlot, "Theme Tracking")
  ), changed, project.root);
  writeChanged(chaptersIndexPath, chapterIndex(project.storyId, project.chapters), changed, project.root);
  writeChanged(scenesIndexPath, sceneIndex(project.storyId, project.scenes), changed, project.root);
  writeChanged(questionsIndexPath, questionIndex(project.storyId, project.questions), changed, project.root);
  writeChanged(promisesIndexPath, promiseIndex(project.storyId, project.promises), changed, project.root);
  writeChanged(glossaryIndexPath, glossaryIndex(project.storyId, project.glossaryTerms), changed, project.root);
  reindexV3(project, changed);

  return { changed };
}

// v3 registries are rebuilt only when the project has activated the matching
// directory, so v2 projects reindex exactly as before.
function reindexV3(project, changed) {
  const factsDir = path.join(project.root, "continuity", "facts");
  const knowledgeDir = path.join(project.root, "continuity", "knowledge");
  const relationshipsDir = path.join(project.root, "continuity", "relationships");
  const stateDir = path.join(project.root, "continuity", "state");

  if (fs.existsSync(factsDir)) {
    writeChanged(path.join(factsDir, "_index.md"), factIndex(project.storyId, project.facts), changed, project.root);
  }

  if (fs.existsSync(knowledgeDir)) {
    writeChanged(path.join(knowledgeDir, "_index.md"), knowledgeIndex(project.storyId, project.knowledge), changed, project.root);
  }

  if (fs.existsSync(relationshipsDir)) {
    writeChanged(path.join(relationshipsDir, "_index.md"), relationshipIndex(project.storyId, project.relationships), changed, project.root);
  }

  if (fs.existsSync(stateDir)) {
    writeChanged(path.join(stateDir, "_index.md"), stateIndex(project.storyId, project.stateSnapshots), changed, project.root);
    writeChanged(path.join(stateDir, "current.md"), currentState(project.storyId, resolveCurrentSnapshot(project)), changed, project.root);
    syncLegacyStatePointer(project, changed);
  }
}

// Once a project has v3 snapshots they are the source of truth for how far the
// story has advanced. The v2 `continuity/state.md` keeps working for v2 tooling,
// so its `current-chapter` is mirrored from the latest snapshot rather than left
// to drift. Only that one field is touched; hand-written v2 state is preserved.
function syncLegacyStatePointer(project, changed) {
  const latest = resolveCurrentSnapshot(project);
  if (!project.continuity || !latest) {
    return;
  }

  if (project.continuity.data["current-chapter"] === latest.sequence) {
    return;
  }

  const statePath = path.join(project.root, "continuity", "state.md");
  writeChanged(statePath, replaceFrontmatter(project.continuity.rawMarkdown, {
    ...project.continuity.data,
    "current-chapter": latest.sequence
  }), changed, project.root);
}

export function computeWordCounts(root, options = {}) {
  const project = scanProject(root);
  const chapters = [];

  for (const chapter of project.chapters) {
    chapters.push({
      number: chapter.number,
      title: chapter.title,
      file: path.relative(project.root, chapter.file),
      wordCount: chapter.wordCount
    });

    if (options.write) {
      const markdown = readMarkdown(chapter.file, project.root);
      writeFile(chapter.file, replaceFrontmatter(markdown.rawMarkdown, {
        ...markdown.data,
        "word-count": chapter.wordCount
      }), { root: project.root });
    }
  }

  if (options.write) {
    reindexProject(project.root);
  }

  return {
    chapters,
    total: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0)
  };
}

export function exportManuscript(root, options = {}) {
  const project = scanProject(root);
  if (project.chapters.length === 0) {
    throw new Error("No chapters found to export");
  }

  const output = resolveOutputPath(project, options.out, "manuscript.md", options.enforceRoot);
  const generatedBy = options.generatedBy ?? "story export";
  const manuscript = manuscriptParts(project);
  const lines = [`# ${manuscript.title}`, "", `<!-- Generated by ${generatedBy}. -->`, ""];

  for (const chapter of manuscript.chapters) {
    lines.push(`# Chapter ${chapter.number}: ${chapter.title}`, "", chapter.body, "");
  }

  writeFile(output.outFile, `${lines.join("\n").trimEnd()}\n`, output.writeOptions);
  return { outFile: output.outFile, chapters: project.chapters.length };
}

export function buildBook(root, options = {}) {
  const format = normalizeBuildFormat(options.format ?? "markdown");
  const project = scanProject(root);
  const extension = format === "markdown" ? "md" : format;
  const output = resolveOutputPath(project, options.out, path.join("dist", `${project.storyId}.${extension}`));

  if (format === "markdown") {
    const result = exportManuscript(project.root, {
      out: output.outFile,
      generatedBy: "story build",
      enforceRoot: output.enforceRoot
    });
    return { ...result, format };
  }

  const manuscript = manuscriptParts(project);
  if (format === "epub") {
    writeEpub(output.outFile, project.storyId, manuscript, output.writeOptions);
  } else {
    writeDocx(output.outFile, manuscript, output.writeOptions);
  }

  return { outFile: output.outFile, chapters: manuscript.chapters.length, format };
}

export function migrateProject(root) {
  const projectRoot = path.resolve(root);
  const storyPath = path.join(projectRoot, "story.md");
  const story = readMarkdown(storyPath, projectRoot);
  const storyId = kebabCase(story.data.title ?? path.basename(projectRoot));
  const changed = [];

  for (const directory of [
    path.join("worldbuilding", "factions"),
    path.join("worldbuilding", "artifacts"),
    "scenes",
    path.join("continuity", "questions"),
    path.join("continuity", "promises"),
    path.join("glossary", "terms")
  ]) {
    ensureDirectory(path.join(projectRoot, directory), changed, projectRoot);
  }

  ensureFile(path.join(projectRoot, "scenes", "_index.md"), sceneIndex(storyId, []), changed, projectRoot);
  ensureFile(path.join(projectRoot, "continuity", "state.md"), continuityState(storyId), changed, projectRoot);
  ensureFile(path.join(projectRoot, "continuity", "questions", "_index.md"), questionIndex(storyId, []), changed, projectRoot);
  ensureFile(path.join(projectRoot, "continuity", "promises", "_index.md"), promiseIndex(storyId, []), changed, projectRoot);
  ensureFile(path.join(projectRoot, "glossary", "_index.md"), glossaryIndex(storyId, []), changed, projectRoot);

  if (story.data["schema-version"] !== STORY_SCHEMA_VERSION) {
    writeFile(storyPath, replaceFrontmatter(story.rawMarkdown, {
      ...story.data,
      "schema-version": STORY_SCHEMA_VERSION
    }), { root: projectRoot });
    changed.push(storyPath);
  }

  migrateToV3(projectRoot, storyId, changed);

  const reindexed = reindexProject(projectRoot);
  return { root: projectRoot, changed: changed.concat(reindexed.changed) };
}

// Schema v2 -> v3. Creates the v3 directories, seeds the pre-story snapshot, and
// lifts v2 `knowledge-state` rows into fact + knowledge records. It never invents
// creative content: every derived fact keeps the author's own wording and is
// marked `undetermined` so a human decides its truth value.
function migrateToV3(projectRoot, storyId, changed) {
  for (const directory of V3_DIRECTORIES) {
    ensureDirectory(path.join(projectRoot, directory), changed, projectRoot);
  }

  ensureFile(path.join(projectRoot, "continuity", "facts", "_index.md"), factIndex(storyId, []), changed, projectRoot);
  ensureFile(path.join(projectRoot, "continuity", "knowledge", "_index.md"), knowledgeIndex(storyId, []), changed, projectRoot);
  ensureFile(path.join(projectRoot, "continuity", "relationships", "_index.md"), relationshipIndex(storyId, []), changed, projectRoot);
  // Seed the registry already listing the pre-story snapshot, so a freshly
  // scaffolded project is byte-identical to what the next reindex would write.
  const preStorySnapshot = { id: "chapter-00", sequence: 0, chapter: "" };
  ensureFile(path.join(projectRoot, "continuity", "state", "_index.md"), stateIndex(storyId, [preStorySnapshot]), changed, projectRoot);
  ensureFile(path.join(projectRoot, "continuity", "state", "chapter-00.md"), stateSnapshot(storyId, {
    chapter: "",
    sequence: 0,
    note: "Durable state before chapter one opens. Seeded by migration; review and fill in."
  }), changed, projectRoot);
  // reindex regenerates this pointer, but init does not reindex, so seed it here.
  ensureFile(path.join(projectRoot, "continuity", "state", "current.md"), currentState(storyId, {
    id: "chapter-00",
    chapter: "",
    sequence: 0
  }), changed, projectRoot);

  migrateKnowledgeState(projectRoot, changed);
  migrateChapterSnapshots(projectRoot, storyId, changed);
}

// A project migrating mid-draft already has canonical chapters but no state
// history, and snapshot sequences must be gapless. Without a baseline the
// acceptance flow is unreachable for exactly the authors who most need it.
//
// So seed one snapshot per existing chapter, marked `provisional` to record that
// it was reconstructed at migration rather than captured at acceptance. Empty is
// honest here: v2 never stored per-chapter state, and an empty provisional
// snapshot says "unknown", which is the opposite of inventing one. The v2
// durable state is real, recorded data, so it lands on the latest chapter.
function migrateChapterSnapshots(projectRoot, storyId, changed) {
  const chapters = readChapterNumbers(projectRoot);
  if (chapters.length === 0) {
    return;
  }

  // Only seed a contiguous run from chapter 1. A gap in chapter numbering would
  // produce a gap in sequences, which is an error the author should fix first.
  const contiguous = chapters.every((chapter, index) => chapter.number === index + 1);
  if (!contiguous) {
    return;
  }

  const legacy = legacyDurableState(projectRoot);
  const latest = chapters[chapters.length - 1];

  for (const chapter of chapters) {
    const isLatest = chapter.id === latest.id;
    ensureFile(path.join(projectRoot, "continuity", "state", `${chapter.id}.md`), stateSnapshot(storyId, {
      chapter: chapter.id,
      sequence: chapter.number,
      provisional: true,
      characters: isLatest ? legacy.characters : [],
      objects: isLatest ? legacy.objects : [],
      note: isLatest
        ? "Provisional. Reconstructed at migration from continuity/state.md. Review before relying on it."
        : "Provisional. v2 did not record per-chapter state, so this snapshot is intentionally empty."
    }), changed, projectRoot);
  }

  writeChanged(path.join(projectRoot, "continuity", "state", "current.md"), currentState(storyId, {
    id: latest.id,
    chapter: latest.id,
    sequence: latest.number
  }), changed, projectRoot);
}

function readChapterNumbers(projectRoot) {
  const directory = path.join(projectRoot, "chapters");
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory)
    .filter((name) => name.endsWith(".md") && name !== "_index.md")
    .map((name) => {
      const id = path.basename(name, ".md");
      const data = readMarkdown(path.join(directory, name), projectRoot).data;
      return { id, number: Number(data.number ?? chapterNumberFromFile(name) ?? 0) };
    })
    .filter((chapter) => Number.isInteger(chapter.number) && chapter.number > 0)
    .sort((left, right) => left.number - right.number);
}

// Relocating recorded v2 state is not invention: the author wrote it.
function legacyDurableState(projectRoot) {
  const legacyPath = path.join(projectRoot, "continuity", "state.md");
  if (!fs.existsSync(legacyPath)) {
    return { characters: [], objects: [] };
  }

  const data = readMarkdown(legacyPath, projectRoot).data;
  const mappings = (value) => asArray(value)
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry));

  return {
    characters: mappings(data["character-state"]).map(({ character, ...rest }) => ({ id: character, ...rest })),
    objects: mappings(data["object-state"]).map(({ artifact, ...rest }) => ({ id: artifact, ...rest }))
  };
}

function migrateKnowledgeState(projectRoot, changed) {
  const legacyPath = path.join(projectRoot, "continuity", "state.md");
  if (!fs.existsSync(legacyPath)) {
    return;
  }

  const entries = asArray(readMarkdown(legacyPath, projectRoot).data["knowledge-state"])
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .filter((entry) => entry.character && entry.knows);

  // A v2 project may already contain a broken chapter reference. Copying it into
  // two new files would turn one authoring mistake into three errors, two of them
  // in files the author never wrote. Carry forward only what resolves, and say so
  // where it does not.
  const chapters = new Set(fs.existsSync(path.join(projectRoot, "chapters"))
    ? fs.readdirSync(path.join(projectRoot, "chapters"))
        .filter((name) => name.endsWith(".md") && name !== "_index.md")
        .map((name) => path.basename(name, ".md"))
    : []);

  const resolves = (value) => {
    const text = String(value ?? "").trim();
    return text !== "" && (text === PRE_STORY || chapters.has(text));
  };

  const byCharacter = new Map();

  for (const entry of entries) {
    const factId = kebabCase(entry.knows);
    if (!factId) {
      continue;
    }

    const learnedIn = entry["learned-in"];
    const carried = resolves(learnedIn);
    const unresolved = Boolean(learnedIn) && !carried;

    ensureFile(path.join(projectRoot, "continuity", "facts", `${factId}.md`), factFile(factId, {
      statement: String(entry.knows),
      truthStatus: "undetermined",
      establishedIn: carried ? learnedIn : "",
      tags: ["migrated", "needs-review"]
    }), changed, projectRoot);

    const record = byCharacter.get(entry.character) ?? [];
    if (!record.some((item) => item.fact === factId)) {
      record.push({
        fact: factId,
        status: "knows",
        ...(carried ? { "learned-in": learnedIn } : {}),
        ...(unresolved
          ? { notes: `migration could not resolve learned-in ${learnedIn}; set it by hand` }
          : {})
      });
    }
    byCharacter.set(entry.character, record);
  }

  for (const [character, facts] of byCharacter) {
    ensureFile(
      path.join(projectRoot, "continuity", "knowledge", `${character}.md`),
      knowledgeFile(character, facts),
      changed,
      projectRoot
    );
  }
}

// Upserts one epistemic entry into a character's knowledge record, creating the
// record when it does not exist yet. Every reference is validated before the
// write so a bad id can never land in canon.
export function recordKnowledge(root, options) {
  const project = scanProject(root);
  const character = String(options.character ?? "").trim();
  const fact = String(options.fact ?? "").trim();
  const status = String(options.status ?? "").trim();

  if (!character) {
    throw new Error("--character is required");
  }
  if (!fact) {
    throw new Error("--fact is required");
  }
  if (!EPISTEMIC_STATUSES.has(status)) {
    throw new Error(`--status must be one of ${[...EPISTEMIC_STATUSES].join(", ")}`);
  }
  if (!project.characters.some((item) => item.id === character)) {
    throw new Error(`Unknown character: ${character}`);
  }
  if (!project.facts.some((item) => item.id === fact)) {
    throw new Error(`Unknown fact: ${fact}`);
  }

  const learnedIn = String(options["learned-in"] ?? "").trim();
  if (learnedIn && learnedIn !== PRE_STORY && !project.chapters.some((item) => item.id === learnedIn)) {
    throw new Error(`Unknown chapter: ${learnedIn}`);
  }
  if (status === "unknown" && learnedIn) {
    throw new Error("status unknown cannot record a learned-in chapter");
  }

  const confidence = String(options.confidence ?? "").trim();
  if (confidence && !CONFIDENCE_LEVELS.has(confidence)) {
    throw new Error(`--confidence must be one of ${[...CONFIDENCE_LEVELS].join(", ")}`);
  }

  const entry = { fact, status };
  if (learnedIn) {
    entry["learned-in"] = learnedIn;
  }
  if (options.source) {
    entry.source = String(options.source);
  }
  if (confidence) {
    entry.confidence = confidence;
  }
  if (options.notes) {
    entry.notes = String(options.notes);
  }

  const file = path.join(project.root, "continuity", "knowledge", `${character}.md`);
  const existing = fs.existsSync(file) ? readMarkdown(file, project.root) : null;
  const entries = existing ? asArray(existing.data.facts).filter((item) => item && item.fact !== fact) : [];
  const facts = entries.concat([entry]).sort((left, right) => String(left.fact).localeCompare(String(right.fact)));

  const markdown = existing
    ? replaceFrontmatter(existing.rawMarkdown, { ...existing.data, facts })
    : knowledgeFile(character, facts);

  writeFile(file, markdown, { root: project.root });
  const reindexed = reindexProject(project.root);
  return { character, fact, status, file, changed: [file].concat(reindexed.changed) };
}

// Read-only projection of the accepted state history.
export function stateReport(root, options = {}) {
  const project = scanProject(root);
  const requested = String(options.chapter ?? "").trim();
  const snapshot = requested
    ? project.stateSnapshots.find((item) => item.chapter === requested || item.id === requested)
    : resolveCurrentSnapshot(project);

  if (requested && !snapshot) {
    throw new Error(`No state snapshot for ${requested}`);
  }

  const character = String(options.character ?? "").trim();
  if (character && !project.characters.some((item) => item.id === character)) {
    throw new Error(`Unknown character: ${character}`);
  }

  return {
    root: project.root,
    snapshot,
    character,
    // One snapshot answers "where are we". Across a book the question becomes
    // "how did this person get here", which no single snapshot can answer.
    trajectory: character ? characterTrajectory(project, character) : [],
    history: project.stateSnapshots.map((item) => ({
      id: item.id,
      sequence: item.sequence,
      chapter: item.chapter,
      provisional: item.provisional
    }))
  };
}

// Only the snapshots where something about this character actually changed.
function characterTrajectory(project, character) {
  const steps = [];
  let previous = null;

  for (const snapshot of project.stateSnapshots) {
    const entry = snapshot.characters.find((item) => item && item.id === character);
    if (!entry) {
      continue;
    }

    const { id, ...fields } = entry;
    const changed = Object.entries(fields)
      .filter(([key, value]) => value !== "" && (!previous || previous[key] !== value))
      .map(([key, value]) => ({ field: key, value }));

    if (changed.length > 0) {
      steps.push({ chapter: snapshot.chapter || "pre-story", sequence: snapshot.sequence, changed });
    }

    previous = fields;
  }

  return steps;
}

export function knowledgeReport(root, options = {}) {
  const project = scanProject(root);
  const requested = String(options.character ?? "").trim();
  const statements = new Map(project.facts.map((fact) => [fact.id, fact.statement]));

  const records = project.knowledge
    .filter((record) => !requested || record.character === requested)
    .map((record) => ({
      character: record.character,
      facts: record.facts.map((entry) => ({
        fact: entry.fact,
        status: entry.status,
        learnedIn: entry["learned-in"] ?? "",
        confidence: entry.confidence ?? "",
        statement: statements.get(entry.fact) ?? ""
      }))
    }));

  if (requested && records.length === 0) {
    throw new Error(`No knowledge record for ${requested}`);
  }

  return { root: project.root, records };
}

export function formatStateReport(report) {
  const lines = [];

  if (!report.snapshot) {
    lines.push("No state snapshots yet.");
    return `${lines.join("\n")}
`;
  }

  const snapshot = report.snapshot;
  lines.push(`State ${snapshot.id} (sequence ${snapshot.sequence}, chapter ${snapshot.chapter || "pre-story"})`);

  // Provisional snapshots were reconstructed at migration, not captured at
  // acceptance. Saying so keeps a reconstruction from being read as a record.
  if (snapshot.provisional) {
    lines.push("Provisional: reconstructed at migration, not captured at acceptance");
  }

  const time = Object.entries(snapshot.storyTime).filter(([, value]) => value !== "");
  if (time.length > 0) {
    lines.push(`Story time: ${time.map(([key, value]) => `${key} ${value}`).join(", ")}`);
  }

  appendStateSection(lines, "Characters", snapshot.characters);
  appendStateSection(lines, "Objects", snapshot.objects);
  appendStateSection(lines, "Relationships", snapshot.relationships);

  if (snapshot.activeThreads.length > 0) {
    lines.push(`Active threads: ${snapshot.activeThreads.join(", ")}`);
  }

  if (report.character) {
    lines.push(`Trajectory of ${report.character}:`);
    for (const step of report.trajectory) {
      lines.push(`  ${step.chapter}: ${step.changed.map((item) => `${item.field}=${item.value}`).join(", ")}`);
    }
  }

  const provisional = report.history.filter((item) => item.provisional).length;
  lines.push(`History: ${report.history.length} snapshot(s)${provisional > 0 ? `, ${provisional} provisional` : ""}`);
  return `${lines.join("\n")}
`;
}

function appendStateSection(lines, title, entries) {
  if (entries.length === 0) {
    return;
  }

  lines.push(`${title}:`);
  for (const entry of entries) {
    const detail = Object.entries(entry)
      .filter(([key, value]) => key !== "id" && value !== "")
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
    lines.push(`  ${entry.id}${detail ? ` ${detail}` : ""}`);
  }
}

export function formatKnowledgeReport(report) {
  if (report.records.length === 0) {
    return "No knowledge records yet.\n";
  }

  const lines = [];
  for (const record of report.records) {
    lines.push(`${record.character}:`);
    if (record.facts.length === 0) {
      lines.push("  (no tracked facts)");
      continue;
    }
    for (const entry of record.facts) {
      const suffix = [entry.learnedIn && `learned-in ${entry.learnedIn}`, entry.confidence && `confidence ${entry.confidence}`]
        .filter(Boolean)
        .join(", ");
      lines.push(`  ${entry.status.padEnd(11)} ${entry.fact}${suffix ? ` (${suffix})` : ""}`);
    }
  }

  return `${lines.join("\n")}
`;
}

// Phase B of the two-phase update. Every target is captured first, so a failure
// part-way through restores the repository to exactly its previous state.
//
// Exported because that guarantee cannot be reached through the public API:
// scanProject validates the tree and the capture pass reads every existing
// target, so a malformed project is refused before the first write. Only a real
// runtime fault -- a full disk, permissions changing under us -- fails mid-way,
// and the only way to prove the recovery is to drive this directly.
export function commitWrites(root, writes) {
  const originals = writes.map((write) => ({
    file: write.file,
    existed: fs.existsSync(write.file),
    contents: fs.existsSync(write.file) ? fs.readFileSync(write.file) : null
  }));

  const written = [];

  try {
    for (const write of writes) {
      writeFile(write.file, write.contents, { root });
      written.push(write.file);
    }
  } catch (error) {
    for (const original of originals) {
      if (!written.includes(original.file)) {
        continue;
      }
      if (original.existed) {
        fs.writeFileSync(original.file, original.contents);
      } else {
        fs.rmSync(original.file, { force: true });
      }
    }
    throw error;
  }

  return written;
}

export function listCandidates(root, options = {}) {
  const project = scanProject(root);
  const chapter = String(options.chapter ?? "").trim();

  return {
    root: project.root,
    candidates: project.candidates
      .filter((candidate) => !chapter || candidate.chapter === chapter)
      .map((candidate) => ({
        id: candidate.id,
        chapter: candidate.chapter,
        status: candidate.status,
        number: candidate.number,
        pov: candidate.pov,
        words: wordCount(candidate.body),
        canonical: project.chapters.some((item) => item.id === candidate.chapter)
      }))
  };
}

// Phase A runs inside planAcceptance and throws before anything is staged.
export function acceptCandidate(root, options = {}) {
  const project = scanProject(root);
  const plan = planAcceptance(project, { ...options, now: options.now });
  const written = commitWrites(project.root, plan.writes);
  const reindexed = reindexProject(project.root);

  return {
    chapter: plan.candidate.chapter,
    candidate: plan.candidate.id,
    bodyHash: plan.bodyHash,
    stateBefore: plan.transaction["state-before"],
    stateAfter: plan.transaction["state-after"],
    changed: written.concat(reindexed.changed)
  };
}

export function rejectCandidate(root, options = {}) {
  const project = scanProject(root);
  const plan = planRejection(project, options);
  const written = commitWrites(project.root, plan.writes);

  return {
    chapter: plan.candidate.chapter,
    candidate: plan.candidate.id,
    changed: written
  };
}

export function readTransactionRecord(root, options = {}) {
  const project = scanProject(root);
  const chapter = String(options.chapter ?? "").trim();
  const transaction = project.transactions.find((item) => item.id === chapter);

  if (!transaction) {
    throw new Error(`No transaction for ${chapter || "(unset)"}`);
  }

  return transaction.data;
}

// Feature 5: sealing an arc plan. Sealed plans are never edited in place;
// sealing again produces the next version, so a chapter plan can always name
// the exact arc version it derives from.
export function sealArc(root, options = {}) {
  const project = scanProject(root);
  const arcId = String(options.arc ?? "").trim();
  const arc = project.arcs.find((item) => item.id === arcId);

  if (!arc) {
    throw new Error(`Unknown arc: ${arcId || "(unset)"}`);
  }

  const version = project.sealedArcs
    .filter((plan) => plan.arc === arc.id)
    .reduce((max, plan) => Math.max(max, plan.version), 0) + 1;

  const id = `${arc.id}-v${version}`;
  const file = path.join(project.root, "plot", "arcs", "sealed", `${id}.md`);

  if (fs.existsSync(file)) {
    throw new Error(`${relative(project, file)} already exists`);
  }

  const sourceHash = createHash("sha256").update(JSON.stringify(arc.rawData), "utf8").digest("hex");

  const writes = [
    { file, contents: sealedArcPlan(arc, version, { sourceHash, now: options.now }) },
    {
      file: arc.file,
      contents: replaceFrontmatter(arc.rawMarkdown, {
        ...arc.rawData,
        "plan-version": version,
        "sealed-version": id
      })
    }
  ];

  const written = commitWrites(project.root, writes);
  const reindexed = reindexProject(project.root);

  return { arc: arc.id, version, id, file, changed: written.concat(reindexed.changed) };
}

// Feature 3: the POV-safe context envelope, in machine-readable form.
export function contextProjection(root, options = {}) {
  return projectContext(scanProject(root), options);
}

export function formatContextProjection(projection) {
  const newline = String.fromCharCode(10);
  const lines = [
    `Context ${projection.chapter} / POV ${projection.pov}`,
    `Narrative: ${projection.narrative.pov}, ${projection.narrative.tense} tense`
  ];

  if (projection.location.id) {
    lines.push(`Location: ${projection.location.name ?? projection.location.id}`);
  }

  for (const status of ["knows", "believes", "suspects", "doubts", "misbelieves"]) {
    const entries = projection.knowledge[status] ?? [];
    if (entries.length === 0) {
      continue;
    }
    lines.push(`${status}:`);
    for (const entry of entries) {
      lines.push(`  ${entry.statement || entry.fact}${entry["learned-in"] ? ` (${entry["learned-in"]})` : ""}`);
    }
  }

  if (projection.present.length > 0) {
    lines.push(`Present: ${projection.present.map((item) => item.name).join(", ")}`);
  }

  if (projection.objects.length > 0) {
    lines.push(`Objects: ${projection.objects.map((item) => item.name).join(", ")}`);
  }

  lines.push(`Withheld: ${projection.excluded.facts} fact(s) ${projection.excluded.reason}`);
  return `${lines.join(newline)}${newline}`;
}

// Feature 22: prose diagnostics. Reported, never enforced: this deliberately
// does not participate in validate, links, or continuity, and cannot fail a
// check. Repetition is sometimes the point.
export function proseDiagnostics(root, options = {}) {
  const project = scanProject(root);
  const requested = String(options.chapter ?? "").trim();

  const chapters = project.chapters
    .filter((chapter) => !requested || chapter.id === requested)
    .map((chapter) => ({ id: chapter.id, text: chapterProse(parseFrontmatter(chapter.rawMarkdown, chapter.file).body) }));

  if (requested && chapters.length === 0) {
    throw new Error(`Unknown chapter: ${requested}`);
  }

  return analyzeProse(chapters, options);
}

// Feature 4: the deterministic brief a model simulates an arc from.
export function arcSimulation(root, options = {}) {
  const project = scanProject(root);
  const brief = buildArcSimulation(project, options);

  if (!options.write) {
    return { brief, file: "" };
  }

  const file = path.join(project.root, "plot", "arcs", "simulations", `${brief.arc}-v${brief["plan-version"] || 1}.json`);
  writeFile(file, `${JSON.stringify(brief, null, 2)}${String.fromCharCode(10)}`, { root: project.root });

  return { brief, file };
}

// Feature 6: the compact, prose-facing packet. Written to the candidate
// workspace so a chapter plan and its packet version live beside the drafts
// they produced.
export function renderPacket(root, options = {}) {
  const project = scanProject(root);
  const packet = buildRenderPacket(project, options);

  if (!options.write) {
    return { packet, file: "" };
  }

  const version = Number(options.version ?? 1);
  const file = path.join(project.root, "work", "chapters", packet.chapter, `render-packet-v${version}.json`);
  writeFile(file, `${JSON.stringify(packet, null, 2)}${String.fromCharCode(10)}`, { root: project.root });

  return { packet, file };
}

export function createCandidate(root, options = {}) {
  const project = scanProject(root);
  const chapter = String(options.chapter ?? "").trim();
  requireKebabId(chapter, "chapter id");

  const number = Number(options.number ?? Number(String(chapter).replace(/[^0-9]/g, "")) ?? 0);
  const existing = project.candidates.filter((candidate) => candidate.chapter === chapter);
  const id = `candidate-${String(existing.length + 1).padStart(3, "0")}`;
  const file = path.join(project.root, "work", "chapters", chapter, `${id}.md`);

  if (fs.existsSync(file)) {
    throw new Error(`${relative(project, file)} already exists`);
  }

  writeFile(file, candidateFile(chapter, id, number, options), { root: project.root });
  return { chapter, candidate: id, file };
}

export function createEntity(root, options) {
  const project = scanProject(root);
  const kind = normalizeKind(options.kind);
  const name = String(options.name ?? "").trim();
  if (!name) {
    throw new Error(`A ${kind} name is required`);
  }

  const entity = buildEntity(project, kind, name, options);
  if (fs.existsSync(entity.file)) {
    throw new Error(`${relative(project, entity.file)} already exists`);
  }

  writeFile(entity.file, entity.markdown, { root: project.root });
  applyEntityBacklinks(project.root, kind, entity.id, readMarkdown(entity.file, project.root).data);
  const reindexed = reindexProject(project.root);
  return { kind, id: entity.id, file: entity.file, changed: [entity.file].concat(reindexed.changed) };
}

export function renameEntity(root, options) {
  const project = scanProject(root);
  const kind = normalizeKind(options.kind);
  const oldId = String(options.id ?? "").trim();
  const name = String(options.name ?? "").trim();
  if (!oldId || !name) {
    throw new Error("rename requires an entity id and a new name");
  }

  const config = entityConfig(kind);
  const oldFile = path.join(project.root, config.dir, `${oldId}.md`);
  requireKebabId(oldId, `${kind} id`);
  assertSafeProjectPath(oldFile, project.root);
  if (!fs.existsSync(oldFile)) {
    throw new Error(`${kind} ${oldId} does not exist`);
  }

  const markdown = readMarkdown(oldFile, project.root);
  const newId = kind === "chapter" ? oldId : kebabCase(name);
  const newFile = path.join(project.root, config.dir, `${newId}.md`);
  assertSafeProjectPath(newFile, project.root);
  if (newFile !== oldFile && fs.existsSync(newFile)) {
    throw new Error(`${kind} ${newId} already exists`);
  }

  const data = { ...markdown.data, [config.titleField]: name };
  writeFile(oldFile, replaceFrontmatter(markdown.rawMarkdown, data), { root: project.root });
  if (newFile !== oldFile) {
    fs.renameSync(oldFile, newFile);
    replaceEntityReferences(project.root, oldId, newId);
  }

  const reindexed = reindexProject(project.root);
  return { kind, oldId, id: newId, file: newFile, changed: [newFile].concat(reindexed.changed) };
}

export function removeEntity(root, options) {
  const project = scanProject(root);
  const kind = normalizeKind(options.kind);
  const id = String(options.id ?? "").trim();
  if (!id) {
    throw new Error("remove requires an entity id");
  }

  const config = entityConfig(kind);
  const file = path.join(project.root, config.dir, `${id}.md`);
  requireKebabId(id, `${kind} id`);
  assertSafeProjectPath(file, project.root);
  if (!fs.existsSync(file)) {
    throw new Error(`${kind} ${id} does not exist`);
  }

  fs.rmSync(file);
  removeEntityReferences(project.root, id);
  const reindexed = reindexProject(project.root);
  return { kind, id, file, changed: [file].concat(reindexed.changed) };
}

function storyBible(options) {
  return `${stringifyFrontmatter({
    title: options.title,
    "schema-version": STORY_SCHEMA_VERSION,
    genre: options.genre,
    "sub-genre": options.subGenre,
    "setting-era": options.settingEra,
    status: "planning",
    themes: options.themes,
    pov: options.pov,
    tense: options.tense
  })}# ${options.title}

## Synopsis

${options.synopsis}

## Tone & Style

Add notes on the story's voice, texture, and emotional register.

## Notes

`;
}

function characterIndex(storyId, characters, relationshipMap, familyTrees) {
  const rows = characters.length === 0
    ? ["| *No characters yet* | | | |"]
    : characters.map((character) => `| ${character.name} | ${character.role} | ${character.status} | [${character.id}](${character.id}.md) |`);

  return `${stringifyFrontmatter({ type: "character-registry", story: storyId })}# Characters

## Registry

| Name | Role | Status | File |
|------|------|--------|------|
${rows.join("\n")}

## Relationship Map

${relationshipMap || "*No relationships defined yet.*"}

## Family Trees

${familyTrees || "*No family trees defined yet.*"}
`;
}

function worldIndex(storyId, locations, systems, factions, artifacts, overview) {
  const locationRows = locations.length === 0
    ? ["| *No locations yet* | | | |"]
    : locations.map((location) => `| ${location.name} | ${titleCaseSlug(location.type)} | ${location.region} | [${location.id}](locations/${location.id}.md) |`);
  const systemRows = systems.length === 0
    ? ["| *No systems yet* | | |"]
    : systems.map((system) => `| ${system.name} | ${titleCaseSlug(system.type)} | [${system.id}](systems/${system.id}.md) |`);
  const factionRows = factions.length === 0
    ? ["| *No factions yet* | | | |"]
    : factions.map((faction) => `| ${faction.name} | ${titleCaseSlug(faction.type)} | ${faction.status} | [${faction.id}](factions/${faction.id}.md) |`);
  const artifactRows = artifacts.length === 0
    ? ["| *No artifacts yet* | | | |"]
    : artifacts.map((artifact) => `| ${artifact.name} | ${titleCaseSlug(artifact.type)} | ${artifact.status} | [${artifact.id}](artifacts/${artifact.id}.md) |`);

  return `${stringifyFrontmatter({ type: "world-registry", story: storyId })}# Worldbuilding

## World Overview

${overview || "*Describe the world at a high level here.*"}

## Locations

| Name | Type | Region | File |
|------|------|--------|------|
${locationRows.join("\n")}

## Systems

| Name | Type | File |
|------|------|------|
${systemRows.join("\n")}

## Factions

| Name | Type | Status | File |
|------|------|--------|------|
${factionRows.join("\n")}

## Artifacts

| Name | Type | Status | File |
|------|------|--------|------|
${artifactRows.join("\n")}
`;
}

function plotIndex(storyId, structure, arcs, storyStructure, themeTracking) {
  const arcRows = arcs.length === 0
    ? ["| *No arcs yet* | | | |"]
    : arcs.map((arc) => `| ${arc.name} | ${arc.type} | ${arc.status} | [${arc.id}](arcs/${arc.id}.md) |`);

  return `${stringifyFrontmatter({ type: "plot-registry", story: storyId, structure })}# Plot Structure

## Story Structure

${storyStructure || "**Model:** Three-Act Structure (adjust as needed)"}

## Arcs

| Name | Type | Status | File |
|------|------|--------|------|
${arcRows.join("\n")}

## Theme Tracking

${themeTracking || `| Theme | Arcs | Chapters |
|-------|------|----------|
| *No themes tracked yet* | | |`}
`;
}

function chapterIndex(storyId, chapters) {
  const rows = chapters.length === 0
    ? ["| *No chapters yet* | | | | | |"]
    : chapters.map((chapter) => `| ${chapter.number} | ${chapter.title} | ${chapter.pov} | ${chapter.status} | ${chapter.wordCount} | [${chapter.id}](${path.basename(chapter.file)}) |`);
  const total = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);

  return `${stringifyFrontmatter({ type: "chapter-registry", story: storyId })}# Chapters

## Registry

| # | Title | POV | Status | Word Count | File |
|---|-------|-----|--------|------------|------|
${rows.join("\n")}

## Total Word Count: ${total}
`;
}

function timeline(storyId) {
  return `${stringifyFrontmatter({ type: "timeline", story: storyId })}# Story Timeline

| When | Event | Arc | Chapter |
|------|-------|-----|---------|
| *No events yet* | | | |
`;
}

function sceneIndex(storyId, scenes) {
  const rows = scenes.length === 0
    ? ["| *No scenes yet* | | | | | |"]
    : scenes.map((scene) => `| ${scene.chapter} | ${scene.scene} | ${scene.title} | ${scene.pov} | ${scene.status} | [${scene.id}](${scene.id}.md) |`);

  return `${stringifyFrontmatter({ type: "scene-registry", story: storyId })}# Scenes

## Registry

| Chapter | Scene | Title | POV | Status | File |
|---------|-------|-------|-----|--------|------|
${rows.join("\n")}
`;
}

function continuityState(storyId) {
  return `${stringifyFrontmatter({
    type: "continuity-state",
    story: storyId,
    "current-chapter": 0,
    "character-state": [],
    "object-state": [],
    "knowledge-state": []
  })}# Continuity State

## Current Story State

Track facts that must carry forward between chapters.

## Character State

| Character | Location | Physical State | Emotional State | Knowledge |
|-----------|----------|----------------|-----------------|-----------|
| *No state entries yet* | | | | |

## Object State

| Artifact | Owner | Location | Status |
|----------|-------|----------|--------|
| *No object state entries yet* | | | |

## Knowledge State

| Character | Knows | Learned In |
|-----------|-------|------------|
| *No knowledge entries yet* | | |
`;
}

function questionIndex(storyId, questions) {
  const rows = questions.length === 0
    ? ["| *No questions yet* | | | |"]
    : questions.map((question) => `| ${question.title} | ${question.status} | ${question.introduced} | [${question.id}](${question.id}.md) |`);

  return `${stringifyFrontmatter({ type: "question-registry", story: storyId })}# Continuity Questions

## Registry

| Question | Status | Introduced | File |
|----------|--------|------------|------|
${rows.join("\n")}
`;
}

function promiseIndex(storyId, promises) {
  const rows = promises.length === 0
    ? ["| *No promises yet* | | | |"]
    : promises.map((promise) => `| ${promise.title} | ${promise.status} | ${promise.planted} | [${promise.id}](${promise.id}.md) |`);

  return `${stringifyFrontmatter({ type: "promise-registry", story: storyId })}# Promises And Payoffs

## Registry

| Promise | Status | Planted | File |
|---------|--------|---------|------|
${rows.join("\n")}
`;
}

function glossaryIndex(storyId, terms) {
  const rows = terms.length === 0
    ? ["| *No terms yet* | | |"]
    : terms.map((term) => `| ${term.term} | ${term.category} | [${term.id}](terms/${term.id}.md) |`);

  return `${stringifyFrontmatter({ type: "glossary-registry", story: storyId })}# Glossary

## Registry

| Term | Category | File |
|------|----------|------|
${rows.join("\n")}
`;
}

function buildProjectActions(project, validation, links, continuity) {
  const actions = [];
  if (validation.errors.length > 0) {
    actions.push(action("P0", "Fix validation errors", `Run story validate . and repair ${validation.errors.length} schema or registry errors.`));
  }
  if (links.errors.length > 0) {
    actions.push(action("P0", "Fix broken references", `Run story links . and repair ${links.errors.length} missing references or backlinks.`));
  }
  if (continuity.errors.length > 0) {
    actions.push(action("P0", "Fix continuity contradictions", `Run story continuity . and repair ${continuity.errors.length} deterministic continuity errors.`));
  }
  if (continuity.warnings.length > 0) {
    actions.push(action("P1", "Review continuity warnings", `Run story continuity . and review ${continuity.warnings.length} continuity warnings.`));
  }
  const staleChapters = [];
  const chaptersWithoutScenes = [];
  let nextNumber = 1;
  for (const chapter of project.chapters) {
    if (chapter.declaredWordCount !== chapter.wordCount) {
      staleChapters.push(chapter);
    }
    let hasScene = false;
    for (const scene of project.scenes) {
      if (scene.chapter === chapter.id) {
        hasScene = true;
      }
    }
    if (!hasScene) {
      chaptersWithoutScenes.push(chapter);
    }
    nextNumber = Math.max(nextNumber, chapter.number + 1);
  }
  if (staleChapters.length > 0) {
    actions.push(action("P1", "Refresh word counts", `Run story wordcount . --write for ${staleChapters.length} chapters with stale counts.`));
  }
  if (chaptersWithoutScenes.length > 0) {
    actions.push(action("P1", "Add scene records", `Create machine-readable scene files for ${chaptersWithoutScenes.length} chapters so continuity has durable state.`));
  }
  const openQuestions = [];
  for (const question of project.questions) {
    if (question.status === "open") {
      openQuestions.push(question);
    }
  }
  if (openQuestions.length > 0) {
    actions.push(action("P2", "Track open questions", `${openQuestions.length} mysteries or continuity questions are still open.`));
  }
  const pendingPromises = [];
  for (const promise of project.promises) {
    if (promise.status === "planned" || promise.status === "planted") {
      pendingPromises.push(promise);
    }
  }
  if (pendingPromises.length > 0) {
    actions.push(action("P2", "Review promises and payoffs", `${pendingPromises.length} setup/payoff promises need planting or payoff decisions.`));
  }
  const activeArcNames = [];
  for (const arc of project.arcs) {
    if (arc.status !== "resolved" && activeArcNames.length < 3) {
      activeArcNames.push(arc.name);
    }
  }
  const nextLabel = activeArcNames.length > 0
    ? `advance ${activeArcNames.join(", ")}`
    : "establish the next story beat";
  actions.push(action("P2", `Draft chapter ${nextNumber}`, `Use story add chapter "Chapter ${nextNumber}" --number ${nextNumber}, then outline scenes to ${nextLabel}.`));
  if (project.characters.length === 0) {
    actions.push(action("P2", "Create first character", "Use story add character \"Name\" --role protagonist before drafting prose."));
  }
  if (actions.length === 1 && validation.ok && links.ok && continuity.ok && continuity.warnings.length === 0 && staleChapters.length === 0 && chaptersWithoutScenes.length === 0) {
    actions.unshift(action("P3", "Project is mechanically healthy", "No deterministic maintenance issues are blocking the next writing pass."));
  }
  return actions;
}

function action(priority, title, detail) {
  return { priority, title, detail };
}

function appendActionLines(lines, actions) {
  if (actions.length === 0) {
    lines.push("- No actions found");
    return;
  }

  for (const item of actions) {
    lines.push(`- [${item.priority}] ${item.title}: ${item.detail}`);
  }
}

function buildEntity(project, kind, name, options) {
  if (kind === "chapter") {
    const number = Number(options.number ?? project.chapters.reduce((max, chapter) => Math.max(max, chapter.number), 0) + 1);
    const id = `chapter-${String(number).padStart(2, "0")}`;
    return entityResult(project, kind, id, chapterFile(name, number, options));
  }

  if (kind === "scene") {
    const chapter = String(options.chapter ?? project.chapters.at(-1)?.id ?? "chapter-01").trim();
    requireKebabId(chapter, "chapter id");
    const scene = Number(options.scene ?? nextSceneNumber(project, chapter));
    const id = `${chapter}-scene-${String(scene).padStart(2, "0")}`;
    return entityResult(project, kind, id, sceneFile(name, chapter, scene, options));
  }

  const id = kebabCase(name);
  switch (kind) {
    case "character":
      return entityResult(project, kind, id, characterFile(name, options));
    case "location":
      return entityResult(project, kind, id, locationFile(name, options));
    case "system":
      return entityResult(project, kind, id, systemFile(name, options));
    case "faction":
      return entityResult(project, kind, id, factionFile(name, options));
    case "artifact":
      return entityResult(project, kind, id, artifactFile(name, options));
    case "arc":
      return entityResult(project, kind, id, arcFile(name, options));
    case "question":
      return entityResult(project, kind, id, questionFile(name, options));
    case "promise":
      return entityResult(project, kind, id, promiseFile(name, options));
    case "term":
      return entityResult(project, kind, id, termFile(name, options));
    case "fact":
      return entityResult(project, kind, id, factFile(id, {
        statement: name,
        truthStatus: options["truth-status"],
        establishedIn: options["established-in"],
        resolvedIn: options["resolved-in"],
        tags: normalizeList(options.tag, [])
      }));
    case "knowledge":
      return entityResult(project, kind, id, knowledgeFile(id, []));
    case "relationship":
      return buildRelationship(project, kind, options);
    default:
      entityConfig(kind);
  }
}

// A relationship is identified by its participants, not by its display name, so
// the same pair can never be filed twice under two different titles.
function buildRelationship(project, kind, options) {
  const participants = normalizeList(options.character, [])
    .map((value) => String(value).trim())
    .filter(Boolean);

  if (participants.length < 2) {
    throw new Error("A relationship needs at least two --character values");
  }

  for (const participant of participants) {
    requireKebabId(participant, "relationship participant");
  }

  const sorted = [...participants].sort();
  return entityResult(project, kind, sorted.join("-"), relationshipFile(sorted.join("-"), sorted, {
    publicStatus: options["public-status"],
    privateStatus: options["private-status"],
    lastMajorChange: options["last-major-change"]
  }));
}

function candidateFile(chapter, id, number, options) {
  return `${stringifyFrontmatter({
    type: "chapter-candidate",
    chapter,
    candidate: id,
    title: options.title ?? titleCaseSlug(chapter),
    number,
    status: "pending",
    pov: options.pov ?? "",
    "plan-version": options["plan-version"] ?? "",
    "render-packet-version": options["render-packet-version"] ?? "",
    review: "",
    characters: normalizeList(options.character, []),
    mentions: normalizeList(options.mention, []),
    locations: normalizeList(options.location, []),
    "arcs-advanced": normalizeList(options.arc, []),
    "story-time": { date: "", time: "", elapsed: "" },
    "state-characters": [],
    "state-objects": [],
    "state-relationships": [],
    "knowledge-delta": [],
    "promise-delta": [],
    "question-delta": [],
    "active-threads": [],
    "reader-knowledge": []
  })}# ${options.title ?? titleCaseSlug(chapter)}

## Chapter Text

Draft prose goes here. This file is a candidate, not canon: nothing in it
affects story state until \`story accept\` commits it.
`;
}

function entityResult(project, kind, id, markdown) {
  const config = entityConfig(kind);
  return { id, markdown, file: path.join(project.root, config.dir, `${id}.md`) };
}

function entityConfig(kind) {
  const configs = {
    character: { dir: "characters", titleField: "name" },
    location: { dir: path.join("worldbuilding", "locations"), titleField: "name" },
    system: { dir: path.join("worldbuilding", "systems"), titleField: "name" },
    faction: { dir: path.join("worldbuilding", "factions"), titleField: "name" },
    artifact: { dir: path.join("worldbuilding", "artifacts"), titleField: "name" },
    arc: { dir: path.join("plot", "arcs"), titleField: "name" },
    chapter: { dir: "chapters", titleField: "title" },
    scene: { dir: "scenes", titleField: "title" },
    question: { dir: path.join("continuity", "questions"), titleField: "title" },
    promise: { dir: path.join("continuity", "promises"), titleField: "title" },
    term: { dir: path.join("glossary", "terms"), titleField: "term" },
    fact: { dir: path.join("continuity", "facts"), titleField: "statement" },
    knowledge: { dir: path.join("continuity", "knowledge"), titleField: "character" },
    relationship: { dir: path.join("continuity", "relationships"), titleField: "id" }
  };
  const config = configs[kind];
  if (!config) {
    throw new Error(`Unsupported entity kind: ${kind}`);
  }
  return config;
}

function normalizeKind(kind) {
  const normalized = String(kind ?? "").trim().toLowerCase().replace(/s$/, "");
  if (normalized === "glossary" || normalized === "glossary-term") {
    return "term";
  }
  return normalized;
}

function requireKebabId(id, label) {
  if (!isKebabId(id)) {
    throw new Error(`${label} must be a kebab-case id`);
  }
}

function isKebabId(value) {
  const text = String(value ?? "").trim();
  return text !== "" && text === kebabCase(text);
}

function characterFile(name, options) {
  return `${stringifyFrontmatter({
    name,
    role: options.role ?? "supporting",
    status: options.status ?? "alive",
    aliases: [],
    relationships: [],
    locations: normalizeList(options.locations ?? options.location, []),
    tags: [],
    arc: options.arc ?? ""
  })}# ${name}

## Appearance

Add physical details that matter on the page.

## Personality & Traits

Add behavior, temperament, habits, and contradictions.

## Backstory

Add only story-relevant history.

## Motivations & Goals

External want, internal need, and the conflict between them.

## Voice & Speech Patterns

Add 2-3 example lines.

## Character Arc

- **Starting state:**
- **Key turning points:**
- **Ending state:**

## Timeline

| When | Event | Relevance |
|------|-------|-----------|
| | | |
`;
}

function locationFile(name, options) {
  return `${stringifyFrontmatter({
    name,
    type: options.type ?? "other",
    region: options.region ?? "",
    population: options.population ?? "",
    "controlled-by": options["controlled-by"] ?? "",
    "notable-characters": normalizeList(options.characters ?? options.character, []),
    tags: [],
    status: options.status ?? "unknown"
  })}# ${name}

## Description

Add sensory details and first impressions.

## History

Add relevant history.

## Culture & Customs

Add social norms, rituals, or local patterns.

## Notable Features

Add landmarks or practical story elements.

## Current State

Add what is true at the current story moment.
`;
}

function systemFile(name, options) {
  return `${stringifyFrontmatter({
    name,
    type: options.type ?? "other",
    prevalence: options.prevalence ?? "uncommon"
  })}# ${name}

## Overview

Summarize the system and why it matters.

## Rules & Limitations

Define costs, limits, and exceptions.

## History

Add origin and changes over time.

## Practitioners

Add users, institutions, or gatekeepers.

## Impact on Society

Add consequences for daily life and conflict.
`;
}

function factionFile(name, options) {
  return `${stringifyFrontmatter({
    name,
    type: options.type ?? "other",
    status: options.status ?? "active",
    members: normalizeList(options.members ?? options.member ?? options.characters ?? options.character, []),
    locations: normalizeList(options.locations ?? options.location, []),
    tags: []
  })}# ${name}

## Purpose

What the faction wants and why it exists.

## Power Base

Resources, influence, territory, leverage, or rituals.

## Members

Important members and their roles.

## Conflicts

Internal and external pressures.
`;
}

function artifactFile(name, options) {
  return `${stringifyFrontmatter({
    name,
    type: options.type ?? "object",
    status: options.status ?? "active",
    owner: options.owner ?? "",
    location: options.location ?? "",
    tags: []
  })}# ${name}

## Description

What it is and how readers recognize it.

## Function

What it can do, cannot do, costs, and constraints.

## History

Where it came from and why it matters.

## Current State

Who has it, where it is, and what changed recently.
`;
}

function arcFile(name, options) {
  return `${stringifyFrontmatter({
    name,
    type: options.type ?? "subplot",
    status: options.status ?? "planned",
    characters: normalizeList(options.characters ?? options.character, []),
    themes: normalizeList(options.themes ?? options.theme, []),
    acts: normalizeList(options.acts ?? options.act, [])
  })}# ${name}

## Setup

Initial state and inciting pressure.

## Rising Action

1. First escalation
2. Second escalation
3. Reversal or complication

## Climax

Decision point or highest tension.

## Resolution

What changes because of this arc.

## Plot Points

| # | Plot Point | Act | Chapter | Status | Notes |
|---|------------|-----|---------|--------|-------|
| 1 | | | | planned | |

## Foreshadowing

| Planted | Payoff | Chapter Planted | Chapter Payoff | Status |
|---------|--------|-----------------|----------------|--------|
| | | | | planned |
`;
}

function chapterFile(title, number, options) {
  return `${stringifyFrontmatter({
    title,
    number,
    pov: options.pov ?? "",
    locations: normalizeList(options.locations ?? options.location, []),
    characters: normalizeList(options.characters ?? options.character, []),
    "arcs-advanced": normalizeList(options.arcs ?? options.arc, []),
    status: options.status ?? "outline",
    "word-count": 0
  })}# Chapter ${number}: ${title}

## Outline

1. Opening beat
2. Escalation
3. Turn or decision

---

## Chapter Text

`;
}

function sceneFile(title, chapter, scene, options) {
  return `${stringifyFrontmatter({
    title,
    chapter,
    scene,
    pov: options.pov ?? "",
    location: options.location ?? "",
    characters: normalizeList(options.characters ?? options.character, []),
    "arcs-advanced": normalizeList(options.arcs ?? options.arc, []),
    status: options.status ?? "outline",
    "state-changes": []
  })}# ${title}

## Purpose

What this scene changes.

## Continuity Notes

Character state, object state, knowledge changes, and timeline facts.
`;
}

function questionFile(title, options) {
  return `${stringifyFrontmatter({
    title,
    status: options.status ?? "open",
    introduced: options.introduced ?? "",
    resolved: options.resolved ?? "",
    characters: normalizeList(options.characters ?? options.character, [])
  })}# ${title}

## Question

What the reader or continuity tracker needs answered.

## Evidence

Known clues, constraints, and contradictions.

## Resolution Plan

How and when this should resolve.
`;
}

function promiseFile(title, options) {
  return `${stringifyFrontmatter({
    title,
    status: options.status ?? "planned",
    planted: options.planted ?? "",
    payoff: options.payoff ?? "",
    arcs: normalizeList(options.arcs ?? options.arc, []),
    characters: normalizeList(options.characters ?? options.character, [])
  })}# ${title}

## Setup

What is promised to the reader.

## Payoff

How the story should answer the setup.

## Tracking Notes

Keep planted and payoff chapters current.
`;
}

function termFile(term, options) {
  return `${stringifyFrontmatter({
    term,
    category: options.category ?? "term",
    aliases: normalizeList(options.aliases ?? options.alias, [])
  })}# ${term}

## Definition

Define the term in story context.

## Usage Notes

How agents should use this term consistently.
`;
}

function nextSceneNumber(project, chapter) {
  return project.scenes
    .filter((scene) => scene.chapter === chapter)
    .reduce((max, scene) => Math.max(max, scene.scene), 0) + 1;
}

function ensureDirectory(directory, changed, root) {
  if (!fs.existsSync(directory)) {
    assertLexicallyInsideRoot(directory, root);
    fs.mkdirSync(directory, { recursive: true });
    assertSafeProjectDirectory(directory, root);
    changed.push(directory);
    return;
  }

  assertSafeProjectDirectory(directory, root);
}

function ensureFile(filePath, contents, changed, root) {
  if (!fs.existsSync(filePath)) {
    writeFile(filePath, contents, { root });
    changed.push(filePath);
    return;
  }

  assertSafeProjectPath(filePath, root);
}

function replaceEntityReferences(root, oldId, newId) {
  // Only replace whole ids: an id can be a substring of another id or of a
  // prose word, so matches adjacent to id characters must be left alone.
  const pattern = new RegExp(`(?<![a-z0-9-])${escapeRegExp(oldId)}(?![a-z0-9-])`, "g");
  for (const file of markdownFiles(root)) {
    const text = safeRead(file, root);
    const updated = text.replace(pattern, newId);
    if (updated !== text) {
      writeFile(file, updated, { root });
    }
  }
}

function removeEntityReferences(root, id) {
  for (const file of markdownFiles(root)) {
    if (!fs.existsSync(file)) {
      continue;
    }
    const markdown = readMarkdown(file, root);
    const data = removeReferenceFromData(markdown.data, id);
    if (JSON.stringify(data) !== JSON.stringify(markdown.data)) {
      writeFile(file, replaceFrontmatter(markdown.rawMarkdown, data), { root });
    }
  }
}

function applyEntityBacklinks(root, kind, id, data) {
  if (kind === "location") {
    for (const characterId of asArray(data["notable-characters"])) {
      if (isKebabId(characterId)) {
        addFrontmatterListValue(root, path.join("characters", `${characterId}.md`), "locations", id);
      }
    }
  }

  if (kind === "character") {
    for (const locationId of asArray(data.locations)) {
      if (isKebabId(locationId)) {
        addFrontmatterListValue(root, path.join("worldbuilding", "locations", `${locationId}.md`), "notable-characters", id);
      }
    }
  }
}

function addFrontmatterListValue(root, relativePath, field, value) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath) || !value) {
    return;
  }

  assertSafeProjectPath(filePath, root);
  const markdown = readMarkdown(filePath, root);
  const list = asArray(markdown.data[field]);
  if (!list.includes(value)) {
    writeFile(filePath, replaceFrontmatter(markdown.rawMarkdown, {
      ...markdown.data,
      [field]: list.concat(value)
    }), { root });
  }
}

function removeReferenceFromData(data, id) {
  const next = {};
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      const items = [];
      for (const item of value) {
        const objectHasReference = item && typeof item === "object" && Object.values(item).includes(id);
        if (item !== id && !objectHasReference) {
          items.push(item && typeof item === "object" && !Array.isArray(item) ? removeReferenceFromData(item, id) : item);
        }
      }
      next[key] = items;
    } else {
      next[key] = value === id ? "" : value;
    }
  }
  return next;
}

function markdownFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory() && entry.name !== "dist" && !entry.name.startsWith(".")) {
      files.push(...markdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function manuscriptParts(project) {
  if (project.chapters.length === 0) {
    throw new Error("No chapters found to export");
  }

  const chapters = [];
  for (const chapter of project.chapters) {
    const markdown = readMarkdown(chapter.file, project.root);
    chapters.push({
      number: chapter.number,
      title: chapter.title,
      body: chapterProse(markdown.body).trim()
    });
  }

  return {
    title: project.story.data.title,
    chapters
  };
}

function writeEpub(outFile, storyId, manuscript, writeOptions = {}) {
  const chapterEntries = [];
  const chapterItems = [];
  const spineItems = [];
  for (const chapter of manuscript.chapters) {
    const id = `chapter-${String(chapter.number).padStart(2, "0")}`;
    chapterEntries.push({
      name: `OEBPS/${id}.xhtml`,
      content: chapterXhtml(chapter)
    });
    chapterItems.push(`<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="${id}"/>`);
  }

  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  writeZip(outFile, [
    { name: "mimetype", content: "application/epub+zip" },
    { name: "META-INF/container.xml", content: `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>` },
    { name: "OEBPS/content.opf", content: `<?xml version="1.0" encoding="UTF-8"?><package version="3.0" unique-identifier="book-id" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${xmlEscape(storyId)}</dc:identifier><dc:title>${xmlEscape(manuscript.title)}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">${modified}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${chapterItems.join("")}</manifest><spine>${spineItems.join("")}</spine></package>` },
    { name: "OEBPS/nav.xhtml", content: navXhtml(manuscript) },
    ...chapterEntries
  ], writeOptions);
}

function navXhtml(manuscript) {
  const links = [];
  for (const chapter of manuscript.chapters) {
    links.push(`<li><a href="chapter-${String(chapter.number).padStart(2, "0")}.xhtml">Chapter ${chapter.number}: ${xmlEscape(chapter.title)}</a></li>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${xmlEscape(manuscript.title)}</title></head><body><nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><ol>${links.join("")}</ol></nav></body></html>`;
}

function chapterXhtml(chapter) {
  const paragraphs = [];
  for (const paragraph of markdownParagraphs(chapter.body)) {
    paragraphs.push(`<p>${xmlEscape(paragraph)}</p>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${xmlEscape(chapter.title)}</title></head><body><h1>Chapter ${chapter.number}: ${xmlEscape(chapter.title)}</h1>${paragraphs.join("")}</body></html>`;
}

function writeDocx(outFile, manuscript, writeOptions = {}) {
  const bodyParts = [paragraphXml(manuscript.title, "Title")];
  for (const chapter of manuscript.chapters) {
    bodyParts.push(paragraphXml(`Chapter ${chapter.number}: ${chapter.title}`, "Heading1"));
    for (const paragraph of markdownParagraphs(chapter.body)) {
      bodyParts.push(paragraphXml(paragraph));
    }
  }
  const body = bodyParts.join("");

  writeZip(outFile, [
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/_rels/document.xml.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "word/styles.xml", content: `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:spacing w:after="240"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="56"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:spacing w:before="480" w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>` },
    { name: "word/document.xml", content: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>` }
  ], writeOptions);
}

function paragraphXml(text, style = "") {
  const styleXml = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${styleXml}<w:r><w:t>${xmlEscape(text)}</w:t></w:r></w:p>`;
}

// A thematic break: three or more of the same marker, optionally spaced.
const SCENE_BREAK_PATTERN = /^([*_-])( ?\1){2,}$/;

function markdownParagraphs(markdown) {
  const paragraphs = [];
  for (const paragraph of markdown
    .replace(/^#+\s+/gm, "")
    .split(/\n{2,}/)) {
    const trimmed = paragraph.replace(/\s+/g, " ").trim();
    if (trimmed) {
      paragraphs.push(SCENE_BREAK_PATTERN.test(trimmed) ? "* * *" : trimmed);
    }
  }
  return paragraphs;
}

function writeZip(outFile, entries, writeOptions = {}) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, "utf8");
    const crc = crc32(content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + content.length;
  }

  let centralSize = 0;
  for (const part of centralParts) {
    centralSize += part.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  writeFile(outFile, Buffer.concat(localParts.concat(centralParts, end)), writeOptions);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = [];
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE.push(value >>> 0);
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Candidates live outside canon in `work/chapters/<chapter>/`. Reading them is
// deliberately separate from readEntityFiles: a candidate is not an entity, and
// it must never be mistaken for one.
function readCandidates(root) {
  const workRoot = path.join(root, "work", "chapters");
  if (!fs.existsSync(workRoot)) {
    return [];
  }

  assertSafeProjectDirectory(workRoot, root);
  const candidates = [];

  for (const chapterDir of fs.readdirSync(workRoot, { withFileTypes: true })) {
    if (!chapterDir.isDirectory()) {
      continue;
    }

    const directory = path.join(workRoot, chapterDir.name);
    assertSafeProjectDirectory(directory, root);

    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        continue;
      }

      const file = path.join(directory, entry.name);
      const markdown = readMarkdown(file, root);
      if (markdown.data.type !== "chapter-candidate") {
        continue;
      }

      const data = markdown.data;
      candidates.push({
        id: path.basename(entry.name, ".md"),
        file,
        chapter: data.chapter ?? chapterDir.name,
        title: data.title ?? titleCaseSlug(chapterDir.name),
        number: Number(data.number ?? chapterNumberFromFile(file) ?? 0),
        status: data.status ?? "pending",
        pov: data.pov ?? "",
        review: data.review ?? "",
        planVersion: data["plan-version"] ?? "",
        renderPacketVersion: data["render-packet-version"] ?? "",
        characters: asArray(data.characters),
        mentions: asArray(data.mentions),
        locations: asArray(data.locations),
        arcsAdvanced: asArray(data["arcs-advanced"]),
        storyTime: asMapping(data["story-time"]),
        stateCharacters: asArray(data["state-characters"]),
        stateObjects: asArray(data["state-objects"]),
        stateRelationships: asArray(data["state-relationships"]),
        knowledgeDelta: asArray(data["knowledge-delta"]),
        promiseDelta: asArray(data["promise-delta"]),
        questionDelta: asArray(data["question-delta"]),
        activeThreads: asArray(data["active-threads"]),
        readerKnowledge: asArray(data["reader-knowledge"]),
        body: markdown.body,
        rawData: data,
        rawMarkdown: markdown.rawMarkdown
      });
    }
  }

  return candidates;
}

function readTransactions(root) {
  const directory = path.join(root, "transactions");
  if (!fs.existsSync(directory)) {
    return [];
  }

  assertSafeProjectDirectory(directory, root);
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const file = path.join(directory, name);
      assertSafeProjectPath(file, root);
      return {
        id: path.basename(name, ".json"),
        file,
        data: JSON.parse(fs.readFileSync(file, "utf8"))
      };
    });
}

function readEntityFiles(root, relativeDir, mapEntity) {
  const directory = path.join(root, relativeDir);
  if (!fs.existsSync(directory)) {
    return [];
  }

  assertSafeProjectDirectory(directory, root);
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "_index.md")
    .map((entry) => entry.name)
    .sort()
    .map((file) => {
      const fullPath = path.join(directory, file);
      const markdown = readMarkdown(fullPath, root);
      return mapEntity(path.basename(file, ".md"), fullPath, markdown.data, markdown);
    });
}

function writeChanged(filePath, contents, changed, root) {
  if (safeRead(filePath, root) !== contents) {
    writeFile(filePath, contents, { root });
    changed.push(filePath);
  }
}

function resolveOutputPath(project, out, defaultRelativePath, enforceRoot) {
  const rawOut = out ?? defaultRelativePath;
  const outFile = path.resolve(project.root, rawOut);
  const shouldEnforceRoot = enforceRoot ?? !path.isAbsolute(String(rawOut));
  return {
    outFile,
    enforceRoot: shouldEnforceRoot,
    writeOptions: shouldEnforceRoot ? { root: project.root } : {}
  };
}

function asMapping(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeList(value, fallback) {
  const values = value === undefined || value === true ? [] : Array.isArray(value) ? value : [value];
  const list = [];
  for (const valueItem of values) {
    for (const part of String(valueItem).split(",")) {
      const trimmed = part.trim();
      if (trimmed) {
        list.push(trimmed);
      }
    }
  }
  return list.length > 0 ? list : fallback;
}

function normalizeBuildFormat(value) {
  const format = String(value).trim().toLowerCase();
  if (format === "markdown" || format === "md") {
    return "markdown";
  }

  if (format === "epub" || format === "docx") {
    return format;
  }

  throw new Error(`Unsupported build format: ${value}. Supported formats: markdown, epub, docx`);
}

function validateStoryFrontmatter(project, errors) {
  const data = project.story.data;
  requireFields(data, ["title", "schema-version", "genre", "status", "themes", "pov", "tense"], "story.md", errors);
  requireScalar(data, "title", "story.md", errors);
  requireScalar(data, "genre", "story.md", errors);
  requireScalar(data, "status", "story.md", errors);
  requireArray(data, "themes", "story.md", errors);
  requireScalar(data, "pov", "story.md", errors);
  requireScalar(data, "tense", "story.md", errors);
  validateEnum(data, "status", STORY_STATUSES, "story.md", errors);
  validateEnum(data, "tense", STORY_TENSES, "story.md", errors);

  const declaredVersion = data["schema-version"];
  if (declaredVersion !== undefined
    && declaredVersion !== STORY_SCHEMA_VERSION
    && !LEGACY_SCHEMA_VERSIONS.has(declaredVersion)) {
    errors.push(`story.md schema-version must be ${STORY_SCHEMA_VERSION} (legacy ${[...LEGACY_SCHEMA_VERSIONS].join(", ")} still accepted)`);
  }
}

function validateIndexFrontmatter(project, errors) {
  for (const [relativePath, expectedType] of INDEX_SCHEMAS) {
    const label = relativePath;
    const data = readMarkdown(path.join(project.root, relativePath), project.root).data;
    requireFields(data, ["type", "story"], label, errors);
    requireScalar(data, "type", label, errors);
    requireScalar(data, "story", label, errors);

    if (data.type !== undefined && data.type !== expectedType) {
      errors.push(`${label} type must be ${expectedType}`);
    }

    if (data.story !== undefined && data.story !== project.storyId) {
      errors.push(`${label} story must be ${project.storyId}`);
    }

    if (relativePath === path.join("plot", "_index.md")) {
      requireFields(data, ["structure"], label, errors);
      requireScalar(data, "structure", label, errors);
    }
  }
}

function validateCharacters(project, errors) {
  for (const character of project.characters) {
    const label = relative(project, character.file);
    const data = readMarkdown(character.file, project.root).data;
    validateEntityId(character.id, label, errors);
    requireFields(data, ["name", "role", "status"], label, errors);
    requireScalar(data, "name", label, errors);
    requireScalar(data, "role", label, errors);
    requireScalar(data, "status", label, errors);
    validateEnum(data, "role", CHARACTER_ROLES, label, errors);
    validateEnum(data, "status", CHARACTER_STATUSES, label, errors);
    if (data["died-in"] !== undefined) {
      requireScalar(data, "died-in", label, errors);
    }
    validateStringArray(data, "aliases", label, errors);
    validateStringArray(data, "locations", label, errors);
    validateStringArray(data, "tags", label, errors);
    validateRelationships(data, label, errors);
  }
}

function validateLocations(project, errors) {
  for (const location of project.locations) {
    const label = relative(project, location.file);
    const data = readMarkdown(location.file, project.root).data;
    validateEntityId(location.id, label, errors);
    requireFields(data, ["name", "type"], label, errors);
    requireScalar(data, "name", label, errors);
    requireScalar(data, "type", label, errors);
    validateStringArray(data, "notable-characters", label, errors);
    validateStringArray(data, "tags", label, errors);
  }
}

function validateSystems(project, errors) {
  for (const system of project.systems) {
    const label = relative(project, system.file);
    const data = readMarkdown(system.file, project.root).data;
    validateEntityId(system.id, label, errors);
    requireFields(data, ["name", "type"], label, errors);
    requireScalar(data, "name", label, errors);
    requireScalar(data, "type", label, errors);
    if (data.prevalence !== undefined) {
      requireScalar(data, "prevalence", label, errors);
    }
  }
}

function validateFactions(project, errors) {
  for (const faction of project.factions) {
    const label = relative(project, faction.file);
    const data = readMarkdown(faction.file, project.root).data;
    validateEntityId(faction.id, label, errors);
    requireFields(data, ["name", "type", "status"], label, errors);
    requireScalar(data, "name", label, errors);
    requireScalar(data, "type", label, errors);
    requireScalar(data, "status", label, errors);
    validateEnum(data, "type", FACTION_TYPES, label, errors);
    validateEnum(data, "status", FACTION_STATUSES, label, errors);
    validateStringArray(data, "members", label, errors);
    validateStringArray(data, "locations", label, errors);
    validateStringArray(data, "tags", label, errors);
  }
}

function validateArtifacts(project, errors) {
  for (const artifact of project.artifacts) {
    const label = relative(project, artifact.file);
    const data = readMarkdown(artifact.file, project.root).data;
    validateEntityId(artifact.id, label, errors);
    requireFields(data, ["name", "type", "status"], label, errors);
    requireScalar(data, "name", label, errors);
    requireScalar(data, "type", label, errors);
    requireScalar(data, "status", label, errors);
    requireScalar(data, "owner", label, errors);
    requireScalar(data, "location", label, errors);
    validateEnum(data, "type", ARTIFACT_TYPES, label, errors);
    validateEnum(data, "status", ARTIFACT_STATUSES, label, errors);
    validateStringArray(data, "tags", label, errors);
  }
}

function validateArcs(project, errors) {
  for (const arc of project.arcs) {
    const label = relative(project, arc.file);
    const data = readMarkdown(arc.file, project.root).data;
    validateEntityId(arc.id, label, errors);
    requireFields(data, ["name", "type", "status"], label, errors);
    requireScalar(data, "name", label, errors);
    requireScalar(data, "type", label, errors);
    requireScalar(data, "status", label, errors);
    validateEnum(data, "type", ARC_TYPES, label, errors);
    validateEnum(data, "status", ARC_STATUSES, label, errors);
    validateStringArray(data, "characters", label, errors);
    validateStringArray(data, "themes", label, errors);
    validateStringArray(data, "acts", label, errors);
  }
}

function validateChapters(project, errors) {
  const seenNumbers = new Map();

  for (const chapter of project.chapters) {
    const label = relative(project, chapter.file);
    const data = readMarkdown(chapter.file, project.root).data;
    const filenameNumber = chapterNumberFromFile(chapter.file);

    validateEntityId(chapter.id, label, errors);
    requireFields(data, ["title", "number", "status"], label, errors);
    requireScalar(data, "title", label, errors);
    requireScalar(data, "status", label, errors);
    requireInteger(data, "number", label, errors);
    validateEnum(data, "status", CHAPTER_STATUSES, label, errors);
    validateStringArray(data, "locations", label, errors);
    validateStringArray(data, "characters", label, errors);
    validateStringArray(data, "mentions", label, errors);
    validateStringArray(data, "arcs-advanced", label, errors);
    if (data.pov !== undefined) {
      requireScalar(data, "pov", label, errors);
    }
    if (data["word-count"] !== undefined) {
      requireInteger(data, "word-count", label, errors);
    }

    if (filenameNumber === 0) {
      errors.push(`${label} filename must match chapter-{NN}.md`);
    } else if (Number.isInteger(data.number) && data.number !== filenameNumber) {
      errors.push(`${label} number must match filename chapter number ${filenameNumber}`);
    }

    if (Number.isInteger(data.number)) {
      if (data.number <= 0) {
        errors.push(`${label} number must be greater than 0`);
      }

      const existing = seenNumbers.get(data.number);
      if (existing) {
        errors.push(`${label} duplicates chapter number ${data.number} from ${existing}`);
      } else {
        seenNumbers.set(data.number, label);
      }
    }
  }
}

function validateScenes(project, errors) {
  for (const scene of project.scenes) {
    const label = relative(project, scene.file);
    const data = readMarkdown(scene.file, project.root).data;
    validateEntityId(scene.id, label, errors);
    requireFields(data, ["title", "chapter", "scene", "status"], label, errors);
    requireScalar(data, "title", label, errors);
    requireScalar(data, "chapter", label, errors);
    requireScalar(data, "status", label, errors);
    requireInteger(data, "scene", label, errors);
    validateEnum(data, "status", SCENE_STATUSES, label, errors);
    validateStringArray(data, "characters", label, errors);
    validateStringArray(data, "mentions", label, errors);
    validateStringArray(data, "arcs-advanced", label, errors);
    validateObjectArray(data, "state-changes", label, errors);
    if (data.pov !== undefined) {
      requireScalar(data, "pov", label, errors);
    }
    if (data.location !== undefined) {
      requireScalar(data, "location", label, errors);
    }
    if (Number.isInteger(data.scene) && data.scene <= 0) {
      errors.push(`${label} scene must be greater than 0`);
    }
  }
}

function validateContinuityState(project, errors) {
  const label = path.join("continuity", "state.md");
  const data = project.continuity.data;
  requireFields(data, ["type", "story", "current-chapter"], label, errors);
  requireScalar(data, "type", label, errors);
  requireScalar(data, "story", label, errors);
  requireInteger(data, "current-chapter", label, errors);
  validateObjectArray(data, "character-state", label, errors);
  validateObjectArray(data, "object-state", label, errors);
  validateObjectArray(data, "knowledge-state", label, errors);
  if (data.type !== undefined && data.type !== "continuity-state") {
    errors.push(`${label} type must be continuity-state`);
  }
  if (data.story !== undefined && data.story !== project.storyId) {
    errors.push(`${label} story must be ${project.storyId}`);
  }
}

function validateQuestions(project, errors) {
  for (const question of project.questions) {
    const label = relative(project, question.file);
    const data = readMarkdown(question.file, project.root).data;
    validateEntityId(question.id, label, errors);
    requireFields(data, ["title", "status"], label, errors);
    requireScalar(data, "title", label, errors);
    requireScalar(data, "status", label, errors);
    requireScalar(data, "introduced", label, errors);
    requireScalar(data, "resolved", label, errors);
    validateEnum(data, "status", QUESTION_STATUSES, label, errors);
    validateStringArray(data, "characters", label, errors);
  }
}

function validatePromises(project, errors) {
  for (const promise of project.promises) {
    const label = relative(project, promise.file);
    const data = readMarkdown(promise.file, project.root).data;
    validateEntityId(promise.id, label, errors);
    requireFields(data, ["title", "status"], label, errors);
    requireScalar(data, "title", label, errors);
    requireScalar(data, "status", label, errors);
    requireScalar(data, "planted", label, errors);
    requireScalar(data, "payoff", label, errors);
    validateEnum(data, "status", PROMISE_STATUSES, label, errors);
    validateStringArray(data, "arcs", label, errors);
    validateStringArray(data, "characters", label, errors);
  }
}

function validateGlossaryTerms(project, errors) {
  for (const term of project.glossaryTerms) {
    const label = relative(project, term.file);
    const data = readMarkdown(term.file, project.root).data;
    validateEntityId(term.id, label, errors);
    requireFields(data, ["term", "category"], label, errors);
    requireScalar(data, "term", label, errors);
    requireScalar(data, "category", label, errors);
    validateEnum(data, "category", TERM_CATEGORIES, label, errors);
    validateStringArray(data, "aliases", label, errors);
  }
}

// Structural checks only: file type, required scalars, and shape. Referential
// and ordering checks live in the epistemic/state/relationship modules and run
// under `story continuity`.
function validateV3Structure(project, errors) {
  for (const fact of project.facts) {
    const label = relative(project, fact.file);
    validateEntityId(fact.id, label, errors);
    requireFields(fact.rawData, ["statement"], label, errors);
    requireScalar(fact.rawData, "statement", label, errors);
    requireExactType(fact.rawData, "fact", label, errors);
  }

  for (const record of project.knowledge) {
    const label = relative(project, record.file);
    validateEntityId(record.id, label, errors);
    requireFields(record.rawData, ["character", "facts"], label, errors);
    requireScalar(record.rawData, "character", label, errors);
    validateObjectArray(record.rawData, "facts", label, errors);
    requireExactType(record.rawData, "knowledge-record", label, errors);
  }

  for (const relationship of project.relationships) {
    const label = relative(project, relationship.file);
    validateEntityId(relationship.id, label, errors);
    requireFields(relationship.rawData, ["participants"], label, errors);
    validateStringArray(relationship.rawData, "participants", label, errors);
    requireExactType(relationship.rawData, "relationship", label, errors);
  }

  for (const snapshot of project.stateSnapshots) {
    const label = relative(project, snapshot.file);
    requireFields(snapshot.rawData, ["sequence"], label, errors);
    requireInteger(snapshot.rawData, "sequence", label, errors);
    validateObjectArray(snapshot.rawData, "characters", label, errors);
    validateObjectArray(snapshot.rawData, "objects", label, errors);
    validateObjectArray(snapshot.rawData, "relationships", label, errors);
    requireExactType(snapshot.rawData, "state-snapshot", label, errors);
  }

  if (project.currentState) {
    const label = path.join("continuity", "state", "current.md");
    requireExactType(project.currentState.data, "state-current", label, errors);
  }
}

function requireExactType(data, expected, label, errors) {
  if (data.type !== undefined && data.type !== expected) {
    errors.push(`${label} type must be ${expected}`);
  }
}

function validateEntityId(id, label, errors) {
  if (id !== kebabCase(id)) {
    errors.push(`${label} filename id must be kebab-case`);
  }
}

function requireScalar(data, field, label, errors) {
  if (data[field] !== undefined && (Array.isArray(data[field]) || typeof data[field] === "object")) {
    errors.push(`${label} frontmatter field ${field} must be a scalar`);
  }
}

function requireArray(data, field, label, errors) {
  if (data[field] !== undefined && !Array.isArray(data[field])) {
    errors.push(`${label} frontmatter field ${field} must be a list`);
  }
}

function requireInteger(data, field, label, errors) {
  if (data[field] !== undefined && !Number.isInteger(data[field])) {
    errors.push(`${label} frontmatter field ${field} must be an integer`);
  }
}

function validateStringArray(data, field, label, errors) {
  if (data[field] === undefined) {
    return;
  }

  if (!Array.isArray(data[field])) {
    errors.push(`${label} frontmatter field ${field} must be a list`);
    return;
  }

  for (const item of data[field]) {
    if (typeof item !== "string" || item.trim() === "") {
      errors.push(`${label} frontmatter field ${field} must contain only non-empty strings`);
    }
  }
}

function validateObjectArray(data, field, label, errors) {
  if (data[field] === undefined) {
    return;
  }

  if (!Array.isArray(data[field])) {
    errors.push(`${label} frontmatter field ${field} must be a list`);
    return;
  }

  for (const item of data[field]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${label} frontmatter field ${field} must contain objects`);
    }
  }
}

function validateRelationships(data, label, errors) {
  if (data.relationships === undefined) {
    return;
  }

  if (!Array.isArray(data.relationships)) {
    errors.push(`${label} frontmatter field relationships must be a list`);
    return;
  }

  for (const relationship of data.relationships) {
    if (!relationship || typeof relationship !== "object" || Array.isArray(relationship)) {
      errors.push(`${label} frontmatter field relationships must contain objects`);
      continue;
    }

    if (typeof relationship.character !== "string" || relationship.character.trim() === "") {
      errors.push(`${label} relationship is missing character`);
    } else if (relationship.character !== kebabCase(relationship.character)) {
      errors.push(`${label} relationship character ${relationship.character} must be kebab-case`);
    }

    if (typeof relationship.type !== "string" || relationship.type.trim() === "") {
      errors.push(`${label} relationship to ${relationship.character ?? "unknown"} is missing type`);
    }
  }
}

function validateEnum(data, field, allowed, label, errors) {
  if (data[field] !== undefined && typeof data[field] === "string" && !allowed.has(data[field])) {
    errors.push(`${label} frontmatter field ${field} has unsupported value ${data[field]}`);
  }
}

function inverseRelationshipType(type) {
  if (RELATIONSHIP_INVERSES.has(type)) {
    return RELATIONSHIP_INVERSES.get(type);
  }

  return SYMMETRIC_RELATIONSHIPS.has(type) ? type : "";
}

function formatCheck(result) {
  const status = result.ok ? "ok" : "failed";
  return `${status} (${result.errors.length} errors, ${result.warnings.length} warnings)`;
}

function requireFields(data, fields, label, errors) {
  for (const field of fields) {
    if (data[field] === undefined || data[field] === "") {
      errors.push(`${label} is missing frontmatter field ${field}`);
    }
  }
}

function chapterNumberFromFile(file) {
  const match = /chapter-(\d+)/.exec(path.basename(file));
  return match ? Number.parseInt(match[1], 10) : 0;
}

function relative(project, file) {
  return path.relative(project.root, file);
}
