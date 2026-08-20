#!/usr/bin/env node

// src/cli.js
import path10 from "node:path";

// src/import.js
import fs3 from "node:fs";
import path9 from "node:path";

// src/frontmatter.js
var FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
function parseFrontmatter(markdown, filePath = "markdown") {
  const match = FRONTMATTER_PATTERN.exec(markdown);
  if (!match) {
    throw new Error(`${filePath} is missing YAML frontmatter`);
  }
  return {
    data: parseYaml(match[1]),
    body: markdown.slice(match[0].length),
    raw: match[1]
  };
}
function stringifyFrontmatter(data) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      appendList(lines, key, value);
    } else if (isPlainObject(value)) {
      appendMapping(lines, key, value);
    } else {
      lines.push(`${key}: ${formatScalar(value)}`);
    }
  }
  lines.push("---", "", "");
  return lines.join(`
`);
}
function replaceFrontmatter(markdown, data) {
  const match = FRONTMATTER_PATTERN.exec(markdown);
  if (!match) {
    throw new Error("Cannot replace missing YAML frontmatter");
  }
  return `${stringifyFrontmatter(data)}${markdown.slice(match[0].length)}`;
}
function appendList(lines, key, value) {
  if (value.length === 0) {
    lines.push(`${key}: []`);
    return;
  }
  lines.push(`${key}:`);
  for (const item of value) {
    if (isPlainObject(item)) {
      const entries = Object.entries(item);
      const [firstKey, firstValue] = entries[0];
      lines.push(`  - ${firstKey}: ${formatScalar(firstValue)}`);
      for (const [childKey, childValue] of entries.slice(1)) {
        lines.push(`    ${childKey}: ${formatScalar(childValue)}`);
      }
    } else {
      lines.push(`  - ${formatScalar(item)}`);
    }
  }
}
function appendMapping(lines, key, value) {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    lines.push(`${key}: {}`);
    return;
  }
  lines.push(`${key}:`);
  for (const [childKey, childValue] of entries) {
    if (Array.isArray(childValue) || isPlainObject(childValue)) {
      throw new Error(`Frontmatter mapping ${key}.${childKey} must be a scalar`);
    }
    lines.push(`  ${childKey}: ${formatScalar(childValue)}`);
  }
}
function parseYaml(source) {
  const lines = source.split(/\r?\n/);
  const data = {};
  for (let index = 0;index < lines.length; ) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) {
      index += 1;
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line);
    if (!pair) {
      throw new Error(`Unsupported frontmatter line: ${line}`);
    }
    const [, key, rest = ""] = pair;
    if (rest !== "") {
      data[key] = parseScalar(rest);
      index += 1;
      continue;
    }
    const block = parseBlock(lines, index + 1);
    if (block.nextIndex === index + 1) {
      data[key] = "";
      index += 1;
      continue;
    }
    data[key] = block.value;
    index = block.nextIndex;
  }
  return data;
}
function parseBlock(lines, startIndex) {
  if (/^  -(?:\s|$)/.test(lines[startIndex] ?? "")) {
    const parsed2 = parseArray(lines, startIndex);
    return { value: parsed2.items, nextIndex: parsed2.nextIndex };
  }
  const parsed = parseMapping(lines, startIndex);
  return { value: parsed.entries, nextIndex: parsed.nextIndex };
}
function parseMapping(lines, startIndex) {
  const entries = {};
  let index = startIndex;
  while (index < lines.length) {
    const childMatch = /^  ([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(lines[index]);
    if (!childMatch) {
      break;
    }
    entries[childMatch[1]] = parseScalar(childMatch[2] ?? "");
    index += 1;
  }
  return { entries, nextIndex: index };
}
function parseArray(lines, startIndex) {
  const items = [];
  let index = startIndex;
  while (index < lines.length) {
    const itemMatch = /^  -(?:\s+(.*))?$/.exec(lines[index]);
    if (!itemMatch) {
      break;
    }
    const itemText = itemMatch[1] ?? "";
    const objectMatch = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(itemText);
    if (!objectMatch) {
      items.push(parseScalar(itemText));
      index += 1;
      continue;
    }
    const item = {
      [objectMatch[1]]: parseScalar(objectMatch[2])
    };
    index += 1;
    while (index < lines.length) {
      const childMatch = /^    ([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[index]);
      if (!childMatch) {
        break;
      }
      item[childMatch[1]] = parseScalar(childMatch[2]);
      index += 1;
    }
    items.push(item);
  }
  return { items, nextIndex: index };
}
function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "[]") {
    return [];
  }
  if (trimmed === "{}") {
    return {};
  }
  if (/^-?\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    return Number.parseFloat(trimmed);
  }
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
function formatScalar(value) {
  if (typeof value === "number") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  if (text === "" || text === "[]" || text === "{}" || /^-?\d+(\.\d+)?$/.test(text) || /^\s|\s$/.test(text) || /[:#\n"']/.test(text)) {
    return JSON.stringify(text);
  }
  return text;
}
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// src/markdown.js
function kebabCase(value) {
  return String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/['']/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function titleCaseSlug(slug) {
  return String(slug).split("-").filter(Boolean).map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ");
}
function wordCount(markdown) {
  const normalized = markdown.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ").replace(/\[[^\]]+\]\([^)]+\)/g, " ").replace(/[#>*_~|:-]/g, " ");
  const words = normalized.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g);
  return words ? words.length : 0;
}
function chapterProse(markdownBody) {
  const chapterTextMatch = /^## Chapter Text\s*$/im.exec(markdownBody);
  if (chapterTextMatch) {
    return markdownBody.slice(chapterTextMatch.index + chapterTextMatch[0].length);
  }
  const outlineMatch = /^## Outline\s*$/im.exec(markdownBody);
  if (!outlineMatch) {
    return stripLeadingH1(markdownBody);
  }
  const afterOutline = markdownBody.slice(outlineMatch.index + outlineMatch[0].length);
  const dividerMatch = /^\s*---\s*$/m.exec(afterOutline);
  return dividerMatch ? afterOutline.slice(dividerMatch.index + dividerMatch[0].length) : afterOutline;
}
function extractSection(markdown, heading) {
  const escaped = escapeRegExp(heading);
  const pattern = new RegExp(`^## ${escaped}\\s*$`, "im");
  const match = pattern.exec(markdown);
  if (!match) {
    return "";
  }
  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const next = /^##\s+/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function stripLeadingH1(markdownBody) {
  const match = /^(?:[ \t]*\r?\n)*[ \t]{0,3}#(?!#)[ \t]+[^\r\n]*(?:\r?\n|$)/.exec(markdownBody);
  return match ? markdownBody.slice(match[0].length) : markdownBody;
}

// src/story.js
import { Buffer } from "node:buffer";
import { createHash as createHash2 } from "node:crypto";
import fs2 from "node:fs";
import path8 from "node:path";

// src/continuity.js
import path from "node:path";
var DEFAULT_CHEKHOV_CHAPTER_GAP = 3;
var PRE_STORY = "pre-story";
function checkContinuity(project) {
  const errors = [];
  const warnings = [];
  const context = {
    chapterNumbers: new Map(project.chapters.map((chapter) => [chapter.id, chapter.number])),
    characters: new Map(project.characters.map((character) => [character.id, character])),
    locations: new Set(project.locations.map((location) => location.id)),
    artifacts: new Map(project.artifacts.map((artifact) => [artifact.id, artifact])),
    factions: new Set(project.factions.map((faction) => faction.id)),
    latestChapter: project.chapters.reduce((max, chapter) => Math.max(max, chapter.number), 0),
    chekhovGap: Number(project.story.data["chekhov-gap"] ?? DEFAULT_CHEKHOV_CHAPTER_GAP)
  };
  checkCharacterDeaths(project, context, errors);
  checkChapterCasts(project, warnings);
  checkSceneCasts(project, warnings);
  checkChapterSequence(project, warnings);
  checkPromises(project, context, errors, warnings);
  checkQuestions(project, context, errors);
  checkStoryCompletion(project, errors);
  checkContinuityState(project, context, errors, warnings);
  return { ok: errors.length === 0, errors, warnings };
}
function checkCharacterDeaths(project, context, errors) {
  for (const character of project.characters) {
    if (!character.diedIn) {
      continue;
    }
    const label = relative(project, character.file);
    if (character.status !== "deceased") {
      errors.push(`${label} has died-in ${character.diedIn} but status ${character.status || "unset"}; set status: deceased`);
    }
    const deathNumber = context.chapterNumbers.get(character.diedIn);
    if (deathNumber === undefined) {
      errors.push(`${label} died-in references missing chapter ${character.diedIn}`);
      continue;
    }
    for (const chapter of project.chapters) {
      if (chapter.number > deathNumber && castIncludes(chapter, character.id)) {
        errors.push(`${relative(project, chapter.file)} lists ${character.id}, who died in ${character.diedIn}; move posthumous appearances to mentions`);
      }
    }
    for (const scene of project.scenes) {
      const sceneChapterNumber = context.chapterNumbers.get(scene.chapter);
      if (sceneChapterNumber !== undefined && sceneChapterNumber > deathNumber && castIncludes(scene, character.id)) {
        errors.push(`${relative(project, scene.file)} lists ${character.id}, who died in ${character.diedIn}; move posthumous appearances to mentions`);
      }
    }
  }
}
function checkChapterCasts(project, warnings) {
  for (const chapter of project.chapters) {
    if (chapter.pov && !chapter.characters.includes(chapter.pov)) {
      warnings.push(`${relative(project, chapter.file)} POV character ${chapter.pov} is not listed in characters`);
    }
  }
}
function checkSceneCasts(project, warnings) {
  const chapters = new Map(project.chapters.map((chapter) => [chapter.id, chapter]));
  for (const scene of project.scenes) {
    const label = relative(project, scene.file);
    if (scene.pov && !scene.characters.includes(scene.pov)) {
      warnings.push(`${label} POV character ${scene.pov} is not listed in characters`);
    }
    const chapter = chapters.get(scene.chapter);
    if (!chapter) {
      continue;
    }
    for (const characterId of scene.characters) {
      if (!chapter.characters.includes(characterId) && !chapter.mentions.includes(characterId)) {
        warnings.push(`${label} lists ${characterId} but ${relative(project, chapter.file)} does not list them in characters or mentions`);
      }
    }
    if (scene.location && chapter.locations.length > 0 && !chapter.locations.includes(scene.location)) {
      warnings.push(`${label} is set in ${scene.location} but ${relative(project, chapter.file)} does not list that location`);
    }
  }
}
function checkChapterSequence(project, warnings) {
  const numbers = project.chapters.map((chapter) => chapter.number).filter((number) => Number.isInteger(number) && number > 0).sort((left, right) => left - right);
  for (let index = 1;index < numbers.length; index += 1) {
    if (numbers[index] > numbers[index - 1] + 1) {
      warnings.push(`Chapter numbering skips from ${numbers[index - 1]} to ${numbers[index]}`);
    }
  }
}
function checkPromises(project, context, errors, warnings) {
  for (const promise of project.promises) {
    const label = relative(project, promise.file);
    const plantedNumber = context.chapterNumbers.get(promise.planted);
    const payoffNumber = context.chapterNumbers.get(promise.payoff);
    if (plantedNumber !== undefined && payoffNumber !== undefined && payoffNumber < plantedNumber) {
      errors.push(`${label} pays off in ${promise.payoff} before it is planted in ${promise.planted}`);
    }
    if (promise.status === "paid-off" && !promise.payoff) {
      errors.push(`${label} is paid-off but has no payoff chapter`);
    }
    if (promise.status === "planted" && !promise.planted) {
      errors.push(`${label} is planted but has no planted chapter`);
    }
    if (promise.status === "planned" && promise.planted) {
      warnings.push(`${label} records planted chapter ${promise.planted} but status is still planned`);
    }
    if (promise.status === "planted" && plantedNumber !== undefined && context.latestChapter - plantedNumber >= context.chekhovGap) {
      warnings.push(`${label} was planted in ${promise.planted}, ${context.latestChapter - plantedNumber} chapters ago, and has no payoff yet`);
    }
  }
}
function checkQuestions(project, context, errors) {
  for (const question of project.questions) {
    const label = relative(project, question.file);
    const introducedNumber = context.chapterNumbers.get(question.introduced);
    const resolvedNumber = context.chapterNumbers.get(question.resolved);
    if (introducedNumber !== undefined && resolvedNumber !== undefined && resolvedNumber < introducedNumber) {
      errors.push(`${label} resolves in ${question.resolved} before it is introduced in ${question.introduced}`);
    }
    if ((question.status === "answered" || question.status === "resolved") && !question.resolved) {
      errors.push(`${label} is ${question.status} but has no resolved chapter`);
    }
    if (question.status === "open" && question.resolved) {
      errors.push(`${label} records resolved chapter ${question.resolved} but status is still open`);
    }
  }
}
function checkStoryCompletion(project, errors) {
  if (project.story.data.status !== "complete") {
    return;
  }
  for (const promise of project.promises) {
    if (promise.status === "planned" || promise.status === "planted") {
      errors.push(`story.md is complete but ${relative(project, promise.file)} is still ${promise.status}`);
    }
  }
  for (const question of project.questions) {
    if (question.status === "open") {
      errors.push(`story.md is complete but ${relative(project, question.file)} is still open`);
    }
  }
}
function checkContinuityState(project, context, errors, warnings) {
  if (!project.continuity) {
    return;
  }
  const label = path.join("continuity", "state.md");
  const data = project.continuity.data;
  const currentChapter = data["current-chapter"];
  if (Number.isInteger(currentChapter)) {
    if (currentChapter > context.latestChapter) {
      errors.push(`${label} current-chapter ${currentChapter} is ahead of the latest chapter ${context.latestChapter}`);
    } else if (currentChapter < context.latestChapter) {
      warnings.push(`${label} current-chapter ${currentChapter} is behind the latest chapter ${context.latestChapter}; update continuity state after drafting`);
    }
  }
  for (const [index, entry] of stateEntries(data["character-state"]).entries()) {
    const entryLabel = `${label} character-state[${index}]`;
    if (!requireMapping(entry, entryLabel, errors)) {
      continue;
    }
    if (!entry.character || !context.characters.has(entry.character)) {
      errors.push(`${entryLabel} references missing character ${entry.character || "(unset)"}`);
    }
    if (entry.location && !context.locations.has(entry.location)) {
      errors.push(`${entryLabel} references missing location ${entry.location}`);
    }
  }
  for (const [index, entry] of stateEntries(data["knowledge-state"]).entries()) {
    const entryLabel = `${label} knowledge-state[${index}]`;
    if (!requireMapping(entry, entryLabel, errors)) {
      continue;
    }
    if (!entry.character || !context.characters.has(entry.character)) {
      errors.push(`${entryLabel} references missing character ${entry.character || "(unset)"}`);
    }
    if (!entry.knows) {
      errors.push(`${entryLabel} is missing knows`);
    }
    if (entry["learned-in"] && entry["learned-in"] !== PRE_STORY && !context.chapterNumbers.has(entry["learned-in"])) {
      errors.push(`${entryLabel} references missing chapter ${entry["learned-in"]}`);
    }
  }
  for (const [index, entry] of stateEntries(data["object-state"]).entries()) {
    const entryLabel = `${label} object-state[${index}]`;
    if (!requireMapping(entry, entryLabel, errors)) {
      continue;
    }
    const artifact = context.artifacts.get(entry.artifact);
    if (!entry.artifact || !artifact) {
      errors.push(`${entryLabel} references missing artifact ${entry.artifact || "(unset)"}`);
    }
    if (entry.owner && !context.characters.has(entry.owner) && !context.factions.has(entry.owner)) {
      errors.push(`${entryLabel} references missing owner ${entry.owner}`);
    }
    if (entry.location && !context.locations.has(entry.location)) {
      errors.push(`${entryLabel} references missing location ${entry.location}`);
    }
    if (entry.status && artifact && artifact.status && entry.status !== artifact.status) {
      warnings.push(`${entryLabel} status ${entry.status} conflicts with ${relative(project, artifact.file)} status ${artifact.status}`);
    }
  }
}
function castIncludes(record, characterId) {
  return record.pov === characterId || record.characters.includes(characterId);
}
function stateEntries(value) {
  return Array.isArray(value) ? value : [];
}
function requireMapping(entry, entryLabel, errors) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    errors.push(`${entryLabel} must be a mapping`);
    return false;
  }
  return true;
}
function relative(project, file) {
  return path.relative(project.root, file);
}

// src/project-io.js
import fs from "node:fs";
import path2 from "node:path";
function readMarkdown(filePath, root) {
  if (root) {
    assertSafeProjectPath(filePath, root);
  }
  const rawMarkdown = fs.readFileSync(filePath, "utf8");
  const parsed = parseFrontmatter(rawMarkdown, filePath);
  return { ...parsed, rawMarkdown };
}
function writeFile(filePath, contents, options = {}) {
  const target = prepareWriteTarget(filePath, options.root);
  fs.writeFileSync(target, contents, "utf8");
}
function safeRead(filePath, root) {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  if (root) {
    assertSafeProjectPath(filePath, root);
  }
  return fs.readFileSync(filePath, "utf8");
}
function prepareWriteTarget(filePath, root) {
  const target = path2.resolve(filePath);
  if (root) {
    assertLexicallyInsideRoot(target, root);
  }
  fs.mkdirSync(path2.dirname(target), { recursive: true });
  if (root) {
    assertSafeProjectParent(target, root);
  }
  rejectSymlinkTarget(target);
  return target;
}
function assertSafeProjectPath(filePath, root) {
  const target = path2.resolve(filePath);
  assertLexicallyInsideRoot(target, root);
  assertSafeProjectParent(target, root);
  rejectSymlinkTarget(target);
}
function assertSafeProjectDirectory(directory, root) {
  const target = path2.resolve(directory);
  assertLexicallyInsideRoot(target, root);
  const stats = lstatIfExists(target);
  if (stats) {
    if (stats.isSymbolicLink()) {
      throw new Error(`Refusing to use symlinked project directory: ${target}`);
    }
    if (!stats.isDirectory()) {
      throw new Error(`Project path is not a directory: ${target}`);
    }
  }
  const rootReal = fs.realpathSync(path2.resolve(root));
  const directoryReal = fs.realpathSync(target);
  if (!isPathInside(rootReal, directoryReal)) {
    throw new Error(`Refusing to use project directory outside root: ${target}`);
  }
}
function assertSafeProjectParent(filePath, root) {
  const rootReal = fs.realpathSync(path2.resolve(root));
  const parentReal = fs.realpathSync(path2.dirname(path2.resolve(filePath)));
  if (!isPathInside(rootReal, parentReal)) {
    throw new Error(`Refusing to access project path outside root: ${filePath}`);
  }
}
function assertLexicallyInsideRoot(filePath, root) {
  const rootPath = path2.resolve(root);
  const target = path2.resolve(filePath);
  if (!isPathInside(rootPath, target)) {
    throw new Error(`Refusing to access path outside project root: ${target}`);
  }
}
function rejectSymlinkTarget(filePath) {
  if (lstatIfExists(filePath)?.isSymbolicLink()) {
    throw new Error(`Refusing to write through symlink: ${filePath}`);
  }
}
function lstatIfExists(filePath) {
  return fs.lstatSync(filePath, { throwIfNoEntry: false }) ?? null;
}
function isPathInside(root, target) {
  const relativePath = path2.relative(root, target);
  return relativePath === "" || !relativePath.startsWith("..") && !path2.isAbsolute(relativePath);
}

// src/epistemic.js
import path3 from "node:path";
var TRUTH_STATUSES = new Set(["true", "false", "ambiguous", "undetermined"]);
var EPISTEMIC_STATUSES = new Set(["knows", "believes", "suspects", "doubts", "misbelieves", "unknown"]);
var CONFIDENCE_LEVELS = new Set(["low", "medium", "high"]);
var PRE_STORY2 = "pre-story";
function checkEpistemicGraph(project) {
  const errors = [];
  const warnings = [];
  checkFacts(project, errors, warnings);
  checkKnowledge(project, errors, warnings);
  return { ok: errors.length === 0, errors, warnings };
}
function checkFacts(project, errors, warnings) {
  for (const fact of project.facts) {
    const label = relative2(project, fact.file);
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
      warnings.push(`${label} has no established-in chapter; set it or ${PRE_STORY2}`);
    }
  }
}
function checkKnowledge(project, errors, warnings) {
  const characters = new Set(project.characters.map((character) => character.id));
  const facts = new Set(project.facts.map((fact) => fact.id));
  const currentPosition = currentStatePosition(project);
  for (const record of project.knowledge) {
    const label = relative2(project, record.file);
    if (record.declaredCharacter && record.declaredCharacter !== record.id) {
      errors.push(`${label} declares character ${record.declaredCharacter} but the filename is ${record.id}`);
    }
    if (!characters.has(record.character)) {
      errors.push(`${label} references missing character ${record.character || "(unset)"}`);
    }
    const seenFacts = new Map;
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
        errors.push(previous === entry.status ? `${entryLabel} duplicates fact ${entry.fact}` : `${entryLabel} contradicts an earlier entry for fact ${entry.fact}: ${previous} then ${entry.status}`);
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
        warnings.push(`${entryLabel} is status ${entry.status} with no learned-in chapter; set it or ${PRE_STORY2}`);
      }
    }
  }
}
function chapterPosition(project, value, label, field, errors) {
  const text = String(value ?? "").trim();
  if (text === "") {
    return null;
  }
  if (text === PRE_STORY2) {
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
function currentStatePosition(project) {
  if (!project.stateSnapshots || project.stateSnapshots.length === 0) {
    return null;
  }
  const latest = project.stateSnapshots[project.stateSnapshots.length - 1];
  return chapterPosition(project, latest.chapter, "", "", null) ?? 0;
}
function currentStateLabel(project) {
  const latest = project.stateSnapshots[project.stateSnapshots.length - 1];
  return latest && latest.chapter ? latest.chapter : PRE_STORY2;
}
function relative2(project, file) {
  return path3.relative(project.root, file);
}

// src/relationships.js
import path4 from "node:path";
function checkRelationships(project) {
  const errors = [];
  const warnings = [];
  const characters = new Set(project.characters.map((character) => character.id));
  const pairs = new Map;
  for (const relationship of project.relationships) {
    const label = relative3(project, relationship.file);
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
      errors.push(`${label} duplicates the participants of ${relative3(project, pairs.get(key))}`);
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
function relative3(project, file) {
  return path4.relative(project.root, file);
}

// src/projection.js
var VISIBLE_STATUSES = ["knows", "believes", "suspects", "doubts", "misbelieves"];
var OBSERVABLE_STATE_FIELDS = ["location", "physical"];
var CONCEALED_OBJECT_STATUSES = new Set(["hidden", "lost", "destroyed", "unknown"]);
function projectContext(project, options = {}) {
  const chapterId = String(options.chapter ?? "").trim();
  const povId = String(options.pov ?? "").trim();
  const chapter = resolveChapter(project, chapterId);
  const povCharacter = project.characters.find((item) => item.id === povId);
  if (!povCharacter) {
    throw new Error(`Unknown POV character: ${povId || "(unset)"}`);
  }
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
  const number = Number(String(chapterId).replace(/[^0-9]/g, ""));
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`Unknown chapter: ${chapterId}`);
  }
  return { id: chapterId, number, characters: [], locations: [] };
}
function enteringSnapshot(project, number) {
  return project.stateSnapshots.find((snapshot) => snapshot.sequence === number - 1) ?? null;
}
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
    if (establishedAfter(project, fact, chapterNumber)) {
      continue;
    }
    if (learnedAfter(project, entry, chapterNumber)) {
      continue;
    }
    buckets[entry.status].push({
      fact: fact.id,
      statement: fact.statement,
      "learned-in": entry["learned-in"] ?? "",
      ...entry.confidence ? { confidence: entry.confidence } : {},
      ...entry.source ? { source: entry.source } : {}
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
  if (text === "" || text === PRE_STORY2) {
    return 0;
  }
  const chapter = project.chapters.find((item) => item.id === text);
  if (chapter) {
    return chapter.number;
  }
  const parsed = Number(text.replace(/[^0-9]/g, ""));
  return Number.isInteger(parsed) ? parsed : 0;
}
function projectRelationships(project, snapshot, povId) {
  const merged = new Map;
  const key = (participants) => [...participants].sort().join("+");
  const pov = project.characters.find((character) => character.id === povId);
  for (const entry of pov ? pov.relationships : []) {
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
      state: { ...relationship.state, ...live ? withoutId(live) : {} },
      "public-status": relationship.publicStatus,
      "private-status": relationship.privateStatus
    });
  }
  return [...merged.values()];
}
function projectPresentCharacters(project, snapshot, chapter, povId) {
  const cast = chapter.characters.length > 0 ? chapter.characters : snapshot ? snapshot.characters.map((entry) => entry.id) : [];
  return cast.filter((id) => id !== povId).map((id) => project.characters.find((character) => character.id === id)).filter(Boolean).map((character) => {
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
function projectObjects(project, snapshot, povId, povState) {
  if (!snapshot) {
    return [];
  }
  const here = povState ? povState.location : "";
  return snapshot.objects.filter((entry) => entry.owner === povId || here && entry.location === here && !CONCEALED_OBJECT_STATUSES.has(String(entry.status ?? ""))).map((entry) => {
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

// src/arcs.js
import path5 from "node:path";
var HARD_CONSTRAINT_KINDS = new Set([
  "knowledge",
  "possession",
  "location",
  "reveal",
  "survival",
  "other"
]);
function checkArcs(project) {
  const errors = [];
  const warnings = [];
  const chapters = new Set(project.chapters.map((chapter) => chapter.id));
  const characters = new Set(project.characters.map((character) => character.id));
  const facts = new Set(project.facts.map((fact) => fact.id));
  const artifacts = new Set(project.artifacts.map((artifact) => artifact.id));
  const sealed = new Set(project.sealedArcs.map((plan) => plan.id));
  for (const arc of project.arcs) {
    const label = relative4(project, arc.file);
    for (const chapterId of arc.chapters) {
      if (!chapters.has(chapterId)) {
        warnings.push(`${label} plans chapter ${chapterId}, which is not canon yet`);
      }
    }
    if (arc.sealedVersion && !sealed.has(arc.sealedVersion)) {
      errors.push(`${label} derives from sealed plan ${arc.sealedVersion}, which does not exist`);
    }
    checkConstraints(project, arc, label, { chapters, characters, facts, artifacts }, errors, warnings);
  }
  for (const plan of project.sealedArcs) {
    const label = relative4(project, plan.file);
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
    for (const [field, set, kind] of [
      ["character", known.characters, "character"],
      ["fact", known.facts, "fact"],
      ["artifact", known.artifacts, "artifact"]
    ]) {
      if (constraint[field] && !set.has(constraint[field])) {
        errors.push(`${entryLabel} references missing ${kind} ${constraint[field]}`);
      }
    }
    if (constraint.until && !known.chapters.has(constraint.until)) {
      if (/^chapter-\d+$/.test(String(constraint.until))) {
        warnings.push(`${entryLabel} expires at ${constraint.until}, which is not canon yet`);
      } else {
        errors.push(`${entryLabel} until ${constraint.until} is not a chapter id`);
      }
    }
  }
}
function constraintsForChapter(project, chapterId, chapterNumber) {
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
function relative4(project, file) {
  return path5.relative(project.root, file);
}
function checkCausalChains(project) {
  const errors = [];
  const warnings = [];
  const characters = new Set(project.characters.map((character) => character.id));
  const facts = new Set(project.facts.map((fact) => fact.id));
  for (const arc of project.arcs) {
    const label = relative4(project, arc.file);
    checkArcCharacters(arc, label, characters, errors);
    checkChain(project, arc, label, characters, facts, errors, warnings);
  }
  return { ok: errors.length === 0, errors, warnings };
}
function checkArcCharacters(arc, label, characters, errors) {
  const seen = new Set;
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

// src/arc-simulation.js
var ARC_SIMULATION_VERSION = 1;
var GUIDANCE = {
  task: "Simulate what each character does across this arc, on the page and off it, given their goal, pressure, resources, and what they actually know at the arc's opening.",
  "hard-constraints": "Mandatory. A simulated action that violates one of these is wrong, however plausible it seems.",
  knowledge: "Each character's knowledge block is what they hold at the arc's opening. Do not have them act on anything outside it unless a step in your chain makes them learn it first.",
  "offscreen-actions": "Antagonists and absent characters keep acting while the POV is elsewhere. Say what they do, not only what the reader sees.",
  "deceased-characters": "A character marked with a simulation-note takes no new action. They shape the arc only through what they left behind.",
  "causal-chain": "Return an ordered chain of cause and effect. Where a step makes someone learn a canonical fact, name it in `learns` so the constraint checker can verify it.",
  "not-a-beat-sheet": "This is causal reasoning, not an outline. Leave room for the drafting to find better local action."
};
function buildArcSimulation(project, options = {}) {
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
    "open-questions": project.questions.filter((question) => question.status === "open").map((question) => ({ id: question.id, title: question.title, introduced: question.introduced })),
    "unpaid-promises": project.promises.filter((promise) => promise.status === "planted").map((promise) => ({ id: promise.id, title: promise.title, planted: promise.planted })),
    "causal-chain": arc.causalChain
  };
}
function buildCharacterBriefs(project, arc, opening) {
  const declared = new Map(arc.arcCharacters.filter((entry) => entry && typeof entry === "object" && entry.id).map((entry) => [entry.id, entry]));
  const ids = [...new Set([...declared.keys(), ...arc.characters])];
  return ids.map((id) => {
    const character = project.characters.find((item) => item.id === id);
    if (!character) {
      return null;
    }
    const entry = declared.get(id) ?? {};
    const projection = safeProjection(project, opening, id);
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
  }).filter(Boolean);
}
function interiorFields(character) {
  const fields = {};
  for (const key of ["internal-need", "fear", "false-belief", "private-information", "stress-response"]) {
    if (character.causality[key]) {
      fields[key] = character.causality[key];
    }
  }
  return fields;
}
function canAct(character) {
  return character.status !== "deceased";
}
function safeProjection(project, chapterId, povId) {
  try {
    return projectContext(project, { chapter: chapterId, pov: povId });
  } catch {
    return null;
  }
}

// src/render-packet.js
var RENDER_PACKET_VERSION = 1;
var GUIDANCE2 = {
  "hard-constraints": "Mandatory. Do not violate any of these.",
  "possible-beats": "Optional. Suggestions only; discard any that do not serve the scene.",
  freedom: "You may discover better local action, dialogue, blocking, or emotional turns than the ones suggested, provided every hard constraint, the POV character's knowledge, and canonical state remain intact.",
  "not-a-script": "Do not transcribe planning notes into prose. Write the scene."
};
var VOICE_FIELDS = ["speech-principle", "avoidance-pattern"];
function buildRenderPacket(project, options = {}) {
  const projection = projectContext(project, options);
  const chapter = project.chapters.find((item) => item.id === projection.chapter);
  const chapterNumber2 = chapter ? chapter.number : chapterNumberFrom(projection.chapter);
  const scene = findScene(project, projection.chapter, options.scene);
  return {
    version: RENDER_PACKET_VERSION,
    chapter: projection.chapter,
    scene: scene ? scene.id : "",
    pov: projection.pov,
    guidance: GUIDANCE2,
    narrative: {
      tense: projection.narrative.tense,
      person: projection.narrative.pov,
      genre: projection.narrative.genre,
      distance: options.distance ?? "close",
      "style-profile": options["style-profile"] ?? ""
    },
    "scene-contract": buildSceneContract(scene, projection),
    "hard-constraints": buildHardConstraints(project, projection, scene, chapterNumber2),
    knowledge: projection.knowledge,
    relationships: projection.relationships,
    "voice-cards": buildVoiceCards(project, projection),
    "reveal-budget": buildRevealBudget(project, projection, chapterNumber2),
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
function buildHardConstraints(project, projection, scene, chapterNumber2) {
  const arcConstraints = constraintsForChapter(project, projection.chapter, chapterNumber2);
  const mandatoryFacts = [];
  const forbiddenOutcomes = [];
  const continuityRequirements = [];
  for (const constraint of arcConstraints) {
    const text = String(constraint.constraint ?? "");
    if (!text) {
      continue;
    }
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
  for (const constraint of scene ? scene.hardConstraints : []) {
    const text = typeof constraint === "string" ? constraint : String(constraint?.constraint ?? "");
    if (text) {
      continuityRequirements.push(text);
    }
  }
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
  return ids.map((id) => project.characters.find((character) => character.id === id)).filter(Boolean).map((character) => {
    const card = { id: character.id, name: character.name };
    for (const field of VOICE_FIELDS) {
      if (character.causality[field]) {
        card[field] = character.causality[field];
      }
    }
    return card;
  }).filter((card) => card.id === projection.pov || Object.keys(card).length > 2);
}
function buildRevealBudget(project, projection, chapterNumber2) {
  return project.facts.filter((fact) => fact.resolvedIn === projection.chapter).filter((fact) => knownToPov(projection, fact.id)).map((fact) => ({ fact: fact.id, statement: fact.statement }));
}
function knownToPov(projection, factId) {
  return Object.values(projection.knowledge).some((entries) => entries.some((entry) => entry.fact === factId));
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
  for (const beat of scene ? scene.softBeats : []) {
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

// src/prose-diagnostics.js
var MIN_PHRASE_WORDS = 5;
var MAX_PHRASE_WORDS = 12;
var MIN_OPENING_RUN = 3;
var MIN_SHAPE_RUN = 4;
var LENGTH_BAND = 5;
var MIN_LENGTH_RUN = 4;
function analyzeProse(chapters, options = {}) {
  const limit = Number(options.limit ?? 10);
  const perChapter = chapters.map((chapter) => {
    const sentences = splitSentences(chapter.text);
    const paragraphs = splitParagraphs(chapter.text);
    return {
      chapter: chapter.id,
      words: countWords(chapter.text),
      sentences: sentences.length,
      paragraphs: paragraphs.length,
      "repeated-phrases": repeatedPhrases(chapter.text, limit),
      "opening-runs": openingRuns(sentences),
      "length-runs": lengthRuns(sentences),
      "shape-runs": shapeRuns(paragraphs),
      dialogue: dialogueStats(chapter.text, sentences)
    };
  });
  return {
    chapters: perChapter,
    "cross-chapter": {
      "repeated-phrases": crossChapterPhrases(chapters, limit),
      "ending-echoes": endingEchoes(chapters)
    },
    note: "Signals to look at, not a quality judgement. Repetition is sometimes deliberate."
  };
}
function repeatedPhrases(text, limit) {
  return rankPhrases(collectPhrases(normalizeWords(text)), limit).map(({ phrase, count }) => ({ phrase, count }));
}
function crossChapterPhrases(chapters, limit) {
  const seen = new Map;
  for (const chapter of chapters) {
    const words = normalizeWords(chapter.text);
    for (const [phrase, positions] of collectPhrases(words)) {
      const entry = seen.get(phrase) ?? { count: 0, chapters: new Set };
      entry.count += positions;
      entry.chapters.add(chapter.id);
      seen.set(phrase, entry);
    }
  }
  const shared = [...seen.entries()].filter(([, entry]) => entry.chapters.size > 1).map(([phrase, entry]) => ({ phrase, count: entry.count, chapters: [...entry.chapters] })).sort((left, right) => right.phrase.length - left.phrase.length || right.count - left.count);
  const kept = [];
  for (const candidate of shared) {
    if (!kept.some((item) => item.phrase.includes(candidate.phrase))) {
      kept.push(candidate);
    }
    if (kept.length >= limit) {
      break;
    }
  }
  return kept;
}
function collectPhrases(words) {
  const counts = new Map;
  for (let size = MIN_PHRASE_WORDS;size <= MAX_PHRASE_WORDS; size += 1) {
    for (let index = 0;index + size <= words.length; index += 1) {
      const phrase = words.slice(index, index + size).join(" ");
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }
  return counts;
}
function rankPhrases(counts, limit) {
  const repeated = [...counts.entries()].filter(([, count]) => count > 1).map(([phrase, count]) => ({ phrase, count })).sort((left, right) => right.phrase.length - left.phrase.length || right.count - left.count);
  const kept = [];
  for (const candidate of repeated) {
    if (!kept.some((item) => item.phrase.includes(candidate.phrase) && item.count >= candidate.count)) {
      kept.push(candidate);
    }
    if (kept.length >= limit) {
      break;
    }
  }
  return kept;
}
function openingRuns(sentences) {
  const runs = [];
  let start = 0;
  for (let index = 1;index <= sentences.length; index += 1) {
    const previous = firstWord(sentences[index - 1]);
    const current = index < sentences.length ? firstWord(sentences[index]) : null;
    if (current !== previous) {
      const length = index - start;
      if (length >= MIN_OPENING_RUN && previous) {
        runs.push({ word: previous, length, "starts-at-sentence": start + 1 });
      }
      start = index;
    }
  }
  return runs;
}
function lengthRuns(sentences) {
  const lengths = sentences.map((sentence) => countWords(sentence));
  const runs = [];
  let start = 0;
  while (start < lengths.length) {
    let end = start + 1;
    while (end < lengths.length) {
      const window = lengths.slice(start, end + 1);
      if (Math.max(...window) - Math.min(...window) > LENGTH_BAND) {
        break;
      }
      end += 1;
    }
    const length = end - start;
    if (length >= MIN_LENGTH_RUN) {
      const band = lengths.slice(start, end);
      runs.push({
        length,
        "starts-at-sentence": start + 1,
        "word-range": [Math.min(...band), Math.max(...band)]
      });
      start = end;
    } else {
      start += 1;
    }
  }
  return runs;
}
function shapeRuns(paragraphs) {
  const shapes = paragraphs.map((paragraph) => splitSentences(paragraph).length);
  const runs = [];
  let start = 0;
  for (let index = 1;index <= shapes.length; index += 1) {
    if (index === shapes.length || shapes[index] !== shapes[start]) {
      const length = index - start;
      if (length >= MIN_SHAPE_RUN) {
        runs.push({ length, "starts-at-paragraph": start + 1, "sentences-each": shapes[start] });
      }
      start = index;
    }
  }
  return runs;
}
function endingEchoes(chapters) {
  const endings = chapters.map((chapter) => {
    const sentences = splitSentences(chapter.text);
    const last = sentences[sentences.length - 1] ?? "";
    return { chapter: chapter.id, sentence: last.trim(), opening: normalizeWords(last).slice(0, 3).join(" ") };
  });
  const echoes = [];
  for (let left = 0;left < endings.length; left += 1) {
    for (let right = left + 1;right < endings.length; right += 1) {
      if (endings[left].opening && endings[left].opening === endings[right].opening) {
        echoes.push({
          chapters: [endings[left].chapter, endings[right].chapter],
          "shared-opening": endings[left].opening
        });
      }
    }
  }
  return { endings, echoes };
}
function dialogueStats(text, sentences) {
  const lines = [...text.matchAll(/[""]([^""]{2,})[""]|"([^"]{2,})"/g)].map((match) => (match[1] ?? match[2] ?? "").trim()).filter(Boolean);
  const totalWords = countWords(text);
  const dialogueWords = lines.reduce((sum, line) => sum + countWords(line), 0);
  const questions = lines.filter((line) => line.includes("?")).length;
  const contractions = lines.filter((line) => /\w['']\w/.test(line)).length;
  return {
    lines: lines.length,
    "share-of-words": totalWords === 0 ? 0 : round(dialogueWords / totalWords),
    "mean-line-words": lines.length === 0 ? 0 : round(dialogueWords / lines.length),
    "question-rate": lines.length === 0 ? 0 : round(questions / lines.length),
    "contraction-rate": lines.length === 0 ? 0 : round(contractions / lines.length),
    "narration-sentences": sentences.length - lines.length,
    note: "Aggregate only. Per-speaker voice convergence needs a reader, not a counter."
  };
}
function splitParagraphs(text) {
  return text.split(/\r?\n\s*\r?\n/).map((paragraph) => paragraph.trim()).filter((paragraph) => paragraph !== "" && !/^#{1,6}\s/.test(paragraph) && !/^[*_-]{3,}$/.test(paragraph));
}
function splitSentences(text) {
  return text.replace(/\s+/g, " ").split(/(?<=[.!?])["""']?\s+(?=[A-Z"""'])/).map((sentence) => sentence.trim()).filter((sentence) => sentence !== "" && !/^#{1,6}\s/.test(sentence));
}
function normalizeWords(text) {
  return text.toLowerCase().match(/[a-z0-9]+(?:[''][a-z]+)?/g) ?? [];
}
function countWords(text) {
  return normalizeWords(text).length;
}
function firstWord(sentence) {
  return normalizeWords(sentence)[0] ?? null;
}
function round(value) {
  return Math.round(value * 100) / 100;
}
function formatProseReport(report) {
  const newline = String.fromCharCode(10);
  const lines = [];
  for (const chapter of report.chapters) {
    lines.push(`${chapter.chapter}: ${chapter.words} words, ${chapter.sentences} sentences, ${chapter.paragraphs} paragraphs`);
    for (const phrase of chapter["repeated-phrases"]) {
      lines.push(`  repeated x${phrase.count}: "${phrase.phrase}"`);
    }
    for (const run of chapter["opening-runs"]) {
      lines.push(`  ${run.length} sentences in a row open with "${run.word}" (from sentence ${run["starts-at-sentence"]})`);
    }
    for (const run of chapter["length-runs"]) {
      lines.push(`  ${run.length} sentences in a row of ${run["word-range"][0]}-${run["word-range"][1]} words (from sentence ${run["starts-at-sentence"]})`);
    }
    for (const run of chapter["shape-runs"]) {
      lines.push(`  ${run.length} paragraphs in a row of ${run["sentences-each"]} sentence(s) (from paragraph ${run["starts-at-paragraph"]})`);
    }
    const dialogue = chapter.dialogue;
    if (dialogue.lines > 0) {
      lines.push(`  dialogue: ${dialogue.lines} lines, ${Math.round(dialogue["share-of-words"] * 100)}% of words, ${dialogue["mean-line-words"]} words per line`);
    }
  }
  const cross = report["cross-chapter"];
  if (cross["repeated-phrases"].length > 0) {
    lines.push("across chapters:");
    for (const phrase of cross["repeated-phrases"]) {
      lines.push(`  repeated x${phrase.count} in ${phrase.chapters.join(", ")}: "${phrase.phrase}"`);
    }
  }
  for (const echo of cross["ending-echoes"].echoes) {
    lines.push(`  ${echo.chapters.join(" and ")} both end starting "${echo["shared-opening"]}"`);
  }
  lines.push("");
  lines.push(report.note);
  return `${lines.join(newline)}${newline}`;
}

// src/transactions.js
import { createHash } from "node:crypto";
import path6 from "node:path";

// src/v3-templates.js
function factIndex(storyId, facts) {
  const rows = facts.length === 0 ? "| *No facts yet* | | | |" : facts.map((fact) => `| [${fact.id}](${fact.id}.md) | ${fact.truthStatus || ""} | ${fact.establishedIn || ""} | ${fact.resolvedIn || ""} |`).join(`
`);
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
function knowledgeIndex(storyId, records) {
  const rows = records.length === 0 ? "| *No knowledge records yet* | |" : records.map((record) => `| [${record.character}](${record.character}.md) | ${record.facts.length} |`).join(`
`);
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
function relationshipIndex(storyId, relationships) {
  const rows = relationships.length === 0 ? "| *No relationships yet* | | |" : relationships.map((item) => `| [${item.id}](${item.id}.md) | ${item.participants.join(", ")} | ${item.lastMajorChange || ""} |`).join(`
`);
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
function stateIndex(storyId, snapshots) {
  const rows = snapshots.length === 0 ? "| *No snapshots yet* | | |" : snapshots.map((snapshot) => `| [${snapshot.id}](${snapshot.id}.md) | ${snapshot.sequence} | ${snapshot.chapter || "pre-story"} |`).join(`
`);
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
function stateSnapshot(storyId, options = {}) {
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
function currentState(storyId, snapshot) {
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
function factFile(id, options = {}) {
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
function knowledgeFile(character, facts = []) {
  return `${stringifyFrontmatter({
    type: "knowledge-record",
    character,
    facts
  })}# Knowledge: ${character}

## Notes

Epistemic state only. Add one entry per fact this character has any relation to.
`;
}
function relationshipFile(id, participants, options = {}) {
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
function sealedArcPlan(arc, version, options = {}) {
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

// src/transactions.js
var CANDIDATE_STATUSES = new Set(["pending", "accepted", "rejected"]);
function planAcceptance(project, options = {}) {
  const chapterId = String(options.chapter ?? "").trim();
  const candidateId = String(options.candidate ?? "").trim();
  const candidate = project.candidates.find((item) => item.chapter === chapterId && item.id === candidateId);
  if (!candidate) {
    throw new Error(`No candidate ${candidateId || "(unset)"} for ${chapterId || "(unset)"}`);
  }
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
      "candidate-file": toPosix(path6.relative(project.root, candidate.file)),
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
    { file: path6.join(project.root, "chapters", `${candidate.chapter}.md`), contents: chapterMarkdown },
    { file: path6.join(project.root, "continuity", "state", `${candidate.chapter}.md`), contents: snapshot },
    ...knowledgeWrites,
    ...factWrites,
    ...promiseWrites,
    ...questionWrites,
    { file: path6.join(project.root, "plot", "timeline.md"), contents: appendTimelineRow(project, candidate) },
    {
      file: path6.join(project.root, "transactions", `${candidate.chapter}.json`),
      contents: `${JSON.stringify(transaction, null, 2)}
`
    },
    { file: candidate.file, contents: withCandidateStatus(candidate, "accepted") }
  ];
  return { candidate, transaction, writes, bodyHash, previous };
}
function planRejection(project, options = {}) {
  const chapterId = String(options.chapter ?? "").trim();
  const candidateId = String(options.candidate ?? "").trim();
  const candidate = project.candidates.find((item) => item.chapter === chapterId && item.id === candidateId);
  if (!candidate) {
    throw new Error(`No candidate ${candidateId || "(unset)"} for ${chapterId || "(unset)"}`);
  }
  if (candidate.status === "accepted") {
    throw new Error(`${candidate.id} was already accepted for ${candidate.chapter}`);
  }
  return {
    candidate,
    writes: [{
      file: candidate.file,
      contents: withCandidateStatus(candidate, "rejected", options.reason)
    }]
  };
}
function checkTransactions(project) {
  const errors = [];
  const warnings = [];
  const chapters = new Map(project.chapters.map((chapter) => [chapter.id, chapter]));
  for (const transaction of project.transactions) {
    const label = toPosix(path6.relative(project.root, transaction.file));
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
      errors.push(`${label} body-sha256 does not match ${toPosix(path6.relative(project.root, chapter.file))}; the chapter changed after acceptance`);
    }
    const after = transaction.data["state-after"];
    if (after && !project.stateSnapshots.some((snapshot) => snapshot.chapter === after)) {
      errors.push(`${label} state-after ${after} has no state snapshot`);
    }
  }
  for (const candidate of project.candidates) {
    const label = toPosix(path6.relative(project.root, candidate.file));
    if (candidate.status === "rejected" && chapters.has(candidate.chapter) && project.transactions.some((item) => item.id === candidate.chapter && item.data.candidate === candidate.id)) {
      errors.push(`${label} is rejected but a transaction records it as accepted`);
    }
  }
  for (const chapter of project.chapters) {
    if (project.candidates.length > 0 && !project.transactions.some((item) => item.id === chapter.id)) {
      warnings.push(`${toPosix(path6.relative(project.root, chapter.file))} is canonical but has no acceptance transaction`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}
function hashBody(markdown) {
  const prose = chapterProse(markdown).replace(/\r\n/g, `
`).trim();
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
    if (learned && learned !== PRE_STORY2 && learned !== candidate.chapter) {
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
function buildSnapshot(project, candidate, previous) {
  return stateSnapshot(project.storyId, {
    chapter: candidate.chapter,
    sequence: candidate.number,
    storyTime: hasContent(candidate.storyTime) ? candidate.storyTime : previous ? previous.storyTime : {},
    characters: mergeById(previous ? previous.characters : [], candidate.stateCharacters),
    objects: mergeById(previous ? previous.objects : [], candidate.stateObjects),
    relationships: mergeById(previous ? previous.relationships : [], candidate.stateRelationships),
    activeThreads: candidate.activeThreads.length > 0 ? candidate.activeThreads : previous ? previous.activeThreads : [],
    readerKnowledge: candidate.readerKnowledge.length > 0 ? candidate.readerKnowledge : previous ? previous.readerKnowledge : [],
    note: `Durable state after ${candidate.chapter}.`
  });
}
function hasContent(mapping) {
  return Object.values(mapping ?? {}).some((value) => String(value ?? "").trim() !== "");
}
function mergeById(previous, delta) {
  const merged = new Map;
  for (const entry of previous) {
    if (entry && entry.id) {
      merged.set(entry.id, { ...entry });
    }
  }
  for (const entry of delta) {
    if (entry && entry.id) {
      merged.set(entry.id, { ...merged.get(entry.id) ?? {}, ...entry });
    }
  }
  return [...merged.values()].sort((left, right) => String(left.id).localeCompare(String(right.id)));
}
function buildKnowledgeWrites(project, candidate) {
  const byCharacter = new Map;
  for (const entry of candidate.knowledgeDelta) {
    const list = byCharacter.get(entry.character) ?? [];
    list.push(entry);
    byCharacter.set(entry.character, list);
  }
  const writes = [];
  for (const [character, entries] of byCharacter) {
    const record = project.knowledge.find((item) => item.character === character);
    const existing = record ? record.facts.filter((item) => !entries.some((entry) => entry.fact === item.fact)) : [];
    const facts = existing.concat(entries.map((entry) => {
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
    })).sort((left, right) => String(left.fact).localeCompare(String(right.fact)));
    const file = record ? record.file : path6.join(project.root, "continuity", "knowledge", `${character}.md`);
    const contents = record ? replaceFrontmatter(record.rawMarkdown, { ...record.rawData, facts }) : `${stringifyFrontmatter({ type: "knowledge-record", character, facts })}# Knowledge: ${character}
`;
    writes.push({ file, contents });
  }
  return writes;
}
function buildFactWrites(project, candidate) {
  const writes = [];
  const stamped = new Set;
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
    const record = records.find((item) => item.id === entry[kind]);
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
  const body = candidate.body.startsWith(`
`) ? candidate.body : `
${candidate.body}`;
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
  return markdown.endsWith(`
`) ? `${markdown}${row}
` : `${markdown}
${row}
`;
}
function withCandidateStatus(candidate, status, reason) {
  const next = { ...candidate.rawData, status };
  if (reason) {
    next["review-note"] = String(reason);
  }
  return replaceFrontmatter(candidate.rawMarkdown, next);
}
function toPosix(value) {
  return value.split(path6.sep).join("/");
}

// src/state.js
import path7 from "node:path";
function checkStateSnapshots(project) {
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
function resolveCurrentSnapshot(project) {
  if (project.stateSnapshots.length === 0) {
    return null;
  }
  return project.stateSnapshots[project.stateSnapshots.length - 1];
}
function checkSequence(project, errors) {
  let expected = 0;
  for (const snapshot of project.stateSnapshots) {
    const label = relative5(project, snapshot.file);
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
    errors.push(`${relative5(project, first.file)} is the first snapshot but does not start at sequence 0`);
  }
}
function checkChapterBinding(project, errors, warnings) {
  const chapters = new Map(project.chapters.map((chapter) => [chapter.id, chapter]));
  const covered = new Set;
  for (const snapshot of project.stateSnapshots) {
    const label = relative5(project, snapshot.file);
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
  for (const chapter of project.chapters) {
    if (!covered.has(chapter.id)) {
      warnings.push(`${relative5(project, chapter.file)} is canonical but has no state snapshot; accept the chapter or add continuity/state/${chapter.id}.md`);
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
    const label = relative5(project, snapshot.file);
    for (const [index, entry] of snapshot.characters.entries()) {
      const entryLabel = `${label} characters[${index}]`;
      if (!requireMapping2(entry, entryLabel, errors)) {
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
      if (!requireMapping2(entry, entryLabel, errors)) {
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
      if (!requireMapping2(entry, entryLabel, errors)) {
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
function requireMapping2(entry, entryLabel, errors) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    errors.push(`${entryLabel} must be a mapping`);
    return false;
  }
  return true;
}
function currentLabel() {
  return path7.join("continuity", "state", "current.md");
}
function relative5(project, file) {
  return path7.relative(project.root, file);
}

// src/story.js
var STORY_SCHEMA_VERSION = 3;
var LEGACY_SCHEMA_VERSIONS = new Set([2]);
var V3_DIRECTORIES = [
  path8.join("continuity", "facts"),
  path8.join("continuity", "knowledge"),
  path8.join("continuity", "relationships"),
  path8.join("continuity", "state")
];
var REQUIRED_PATHS = [
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
var INDEX_SCHEMAS = [
  [path8.join("characters", "_index.md"), "character-registry"],
  [path8.join("worldbuilding", "_index.md"), "world-registry"],
  [path8.join("plot", "_index.md"), "plot-registry"],
  [path8.join("plot", "timeline.md"), "timeline"],
  [path8.join("chapters", "_index.md"), "chapter-registry"],
  [path8.join("scenes", "_index.md"), "scene-registry"],
  [path8.join("continuity", "questions", "_index.md"), "question-registry"],
  [path8.join("continuity", "promises", "_index.md"), "promise-registry"],
  [path8.join("glossary", "_index.md"), "glossary-registry"]
];
var CHARACTER_CAUSALITY_FIELDS = [
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
var STORY_STATUSES = new Set(["planning", "drafting", "in-progress", "revising", "complete", "abandoned"]);
var STORY_TENSES = new Set(["past", "present", "future", "mixed"]);
var CHARACTER_ROLES = new Set(["protagonist", "antagonist", "supporting", "minor", "narrator", "deuteragonist"]);
var CHARACTER_STATUSES = new Set(["alive", "deceased", "unknown", "missing"]);
var ARC_TYPES = new Set(["main", "subplot", "character", "thematic"]);
var ARC_STATUSES = new Set(["planned", "in-progress", "resolved"]);
var CHAPTER_STATUSES = new Set(["outline", "draft", "revised", "final", "complete"]);
var SCENE_STATUSES = new Set(["outline", "draft", "revised", "final", "complete"]);
var FACTION_TYPES = new Set(["family", "guild", "government", "military", "religion", "company", "community", "criminal", "other"]);
var FACTION_STATUSES = new Set(["active", "hidden", "declining", "defeated", "disbanded", "unknown"]);
var ARTIFACT_TYPES = new Set(["object", "weapon", "document", "technology", "relic", "symbol", "resource", "other"]);
var ARTIFACT_STATUSES = new Set(["active", "lost", "destroyed", "hidden", "transferred", "unknown"]);
var QUESTION_STATUSES = new Set(["open", "answered", "resolved", "dropped"]);
var PROMISE_STATUSES = new Set(["planned", "planted", "paid-off", "dropped"]);
var TERM_CATEGORIES = new Set(["person", "place", "faction", "artifact", "concept", "term", "other"]);
var RELATIONSHIP_INVERSES = new Map([
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
var SYMMETRIC_RELATIONSHIPS = new Set([
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
function createStoryProject(options) {
  const title = String(options.title ?? "").trim();
  if (!title) {
    throw new Error("A story title is required");
  }
  const storyId = kebabCase(title);
  const root = path8.resolve(options.cwd ?? process.cwd(), options.dir ?? storyId);
  if (fs2.existsSync(root) && !options.force) {
    throw new Error(`${root} already exists. Use --force to overwrite starter files.`);
  }
  const themes = normalizeList(options.themes, ["change"]);
  fs2.mkdirSync(path8.join(root, "characters"), { recursive: true });
  fs2.mkdirSync(path8.join(root, "worldbuilding", "locations"), { recursive: true });
  fs2.mkdirSync(path8.join(root, "worldbuilding", "systems"), { recursive: true });
  fs2.mkdirSync(path8.join(root, "worldbuilding", "factions"), { recursive: true });
  fs2.mkdirSync(path8.join(root, "worldbuilding", "artifacts"), { recursive: true });
  fs2.mkdirSync(path8.join(root, "plot", "arcs"), { recursive: true });
  fs2.mkdirSync(path8.join(root, "chapters"), { recursive: true });
  fs2.mkdirSync(path8.join(root, "scenes"), { recursive: true });
  fs2.mkdirSync(path8.join(root, "continuity", "questions"), { recursive: true });
  fs2.mkdirSync(path8.join(root, "continuity", "promises"), { recursive: true });
  fs2.mkdirSync(path8.join(root, "glossary", "terms"), { recursive: true });
  writeFile(path8.join(root, "story.md"), storyBible({
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
  writeFile(path8.join(root, "characters", "_index.md"), characterIndex(storyId, [], "", ""), { root });
  writeFile(path8.join(root, "worldbuilding", "_index.md"), worldIndex(storyId, [], [], [], [], ""), { root });
  writeFile(path8.join(root, "plot", "_index.md"), plotIndex(storyId, "three-act", [], "", ""), { root });
  writeFile(path8.join(root, "plot", "timeline.md"), timeline(storyId), { root });
  writeFile(path8.join(root, "chapters", "_index.md"), chapterIndex(storyId, []), { root });
  writeFile(path8.join(root, "scenes", "_index.md"), sceneIndex(storyId, []), { root });
  writeFile(path8.join(root, "continuity", "state.md"), continuityState(storyId), { root });
  writeFile(path8.join(root, "continuity", "questions", "_index.md"), questionIndex(storyId, []), { root });
  writeFile(path8.join(root, "continuity", "promises", "_index.md"), promiseIndex(storyId, []), { root });
  writeFile(path8.join(root, "glossary", "_index.md"), glossaryIndex(storyId, []), { root });
  migrateToV3(root, storyId, []);
  return { root, storyId, files: REQUIRED_PATHS.filter((entry) => entry.endsWith(".md")) };
}
function scanProject(root) {
  const projectRoot = path8.resolve(root);
  const story = readMarkdown(path8.join(projectRoot, "story.md"), projectRoot);
  const storyId = kebabCase(story.data.title ?? path8.basename(projectRoot));
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
      causality: Object.fromEntries(CHARACTER_CAUSALITY_FIELDS.filter((field) => data[field] !== undefined && data[field] !== "").map((field) => [field, data[field]]))
    })),
    locations: readEntityFiles(projectRoot, path8.join("worldbuilding", "locations"), (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      region: data.region ?? "",
      notableCharacters: asArray(data["notable-characters"])
    })),
    systems: readEntityFiles(projectRoot, path8.join("worldbuilding", "systems"), (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? ""
    })),
    factions: readEntityFiles(projectRoot, path8.join("worldbuilding", "factions"), (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      status: data.status ?? "",
      members: asArray(data.members),
      locations: asArray(data.locations)
    })),
    artifacts: readEntityFiles(projectRoot, path8.join("worldbuilding", "artifacts"), (id, file, data) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      status: data.status ?? "",
      owner: data.owner ?? "",
      location: data.location ?? ""
    })),
    arcs: readEntityFiles(projectRoot, path8.join("plot", "arcs"), (id, file, data, markdown) => ({
      id,
      file,
      name: data.name ?? titleCaseSlug(id),
      type: data.type ?? "",
      status: data.status ?? "",
      characters: asArray(data.characters),
      themes: asArray(data.themes),
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
    sealedArcs: readEntityFiles(projectRoot, path8.join("plot", "arcs", "sealed"), (id, file, data) => ({
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
      chapter: String(data.chapter ?? ""),
      scene: Number(data.scene ?? sceneNumberFromFile(file) ?? 0),
      pov: data.pov ?? "",
      location: data.location ?? "",
      status: data.status ?? "",
      characters: asArray(data.characters),
      mentions: asArray(data.mentions),
      arcsAdvanced: asArray(data["arcs-advanced"]),
      stateChanges: asArray(data["state-changes"]),
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
    questions: readEntityFiles(projectRoot, path8.join("continuity", "questions"), (id, file, data, markdown) => ({
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
    promises: readEntityFiles(projectRoot, path8.join("continuity", "promises"), (id, file, data, markdown) => ({
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
    glossaryTerms: readEntityFiles(projectRoot, path8.join("glossary", "terms"), (id, file, data) => ({
      id,
      file,
      term: data.term ?? titleCaseSlug(id),
      category: data.category ?? "",
      aliases: asArray(data.aliases)
    })),
    facts: readEntityFiles(projectRoot, path8.join("continuity", "facts"), (id, file, data, markdown) => ({
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
    knowledge: readEntityFiles(projectRoot, path8.join("continuity", "knowledge"), (id, file, data, markdown) => ({
      id,
      file,
      declaredCharacter: data.character ?? "",
      character: data.character || id,
      facts: asArray(data.facts),
      rawData: data,
      rawMarkdown: markdown.rawMarkdown
    })),
    relationships: readEntityFiles(projectRoot, path8.join("continuity", "relationships"), (id, file, data) => ({
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
    stateSnapshots: readEntityFiles(projectRoot, path8.join("continuity", "state"), (id, file, data) => ({
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
    })).filter((snapshot) => snapshot.id !== "current").sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id)),
    candidates: readCandidates(projectRoot),
    transactions: readTransactions(projectRoot),
    timeline: safeRead(path8.join(projectRoot, "plot", "timeline.md"), projectRoot),
    currentState: fs2.existsSync(path8.join(projectRoot, "continuity", "state", "current.md")) ? readMarkdown(path8.join(projectRoot, "continuity", "state", "current.md"), projectRoot) : null,
    continuity: fs2.existsSync(path8.join(projectRoot, "continuity", "state.md")) ? readMarkdown(path8.join(projectRoot, "continuity", "state.md"), projectRoot) : null
  };
}
function validateProject(root) {
  const projectRoot = path8.resolve(root);
  const errors = [];
  const warnings = [];
  for (const requiredPath of REQUIRED_PATHS) {
    if (!fs2.existsSync(path8.join(projectRoot, requiredPath))) {
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
    [path8.join("characters", "_index.md"), project.characters.map((item) => `](${item.id}.md)`)],
    [path8.join("worldbuilding", "_index.md"), project.locations.map((item) => `](locations/${item.id}.md)`).concat(project.systems.map((item) => `](systems/${item.id}.md)`)).concat(project.factions.map((item) => `](factions/${item.id}.md)`)).concat(project.artifacts.map((item) => `](artifacts/${item.id}.md)`))],
    [path8.join("plot", "_index.md"), project.arcs.map((item) => `](arcs/${item.id}.md)`)],
    [path8.join("chapters", "_index.md"), project.chapters.map((item) => `](${path8.basename(item.file)})`)],
    [path8.join("scenes", "_index.md"), project.scenes.map((item) => `](${item.id}.md)`)],
    [path8.join("continuity", "questions", "_index.md"), project.questions.map((item) => `](${item.id}.md)`)],
    [path8.join("continuity", "promises", "_index.md"), project.promises.map((item) => `](${item.id}.md)`)],
    [path8.join("glossary", "_index.md"), project.glossaryTerms.map((item) => `](terms/${item.id}.md)`)]
  ];
  for (const [indexPath, links] of indexChecks) {
    const markdown = safeRead(path8.join(projectRoot, indexPath), projectRoot);
    for (const link of links) {
      if (!markdown.includes(link)) {
        warnings.push(`${indexPath} is missing registry link ${link}`);
      }
    }
  }
  for (const chapter of project.chapters) {
    if (chapter.declaredWordCount !== chapter.wordCount) {
      warnings.push(`${path8.relative(projectRoot, chapter.file)} declares ${chapter.declaredWordCount} words but contains ${chapter.wordCount}`);
    }
    if (!project.scenes.some((scene) => scene.chapter === chapter.id)) {
      warnings.push(`${path8.relative(projectRoot, chapter.file)} has no machine-readable scene records`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}
function validateLinks(root) {
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
        errors.push(`${relative6(project, character.file)} references missing character ${target}`);
      } else if (!characters.get(target).relationships.some((entry) => entry.character === character.id)) {
        errors.push(`${relative6(project, character.file)} relationship to ${target} is missing backlink`);
      } else {
        const backlink = characters.get(target).relationships.find((entry) => entry.character === character.id);
        const expectedType = inverseRelationshipType(relationship.type);
        if (expectedType && backlink.type !== expectedType) {
          errors.push(`${relative6(project, character.file)} relationship ${relationship.type} to ${target} expects backlink type ${expectedType}, got ${backlink.type}`);
        }
      }
    }
    for (const locationId of character.locations) {
      if (!locations.has(locationId)) {
        errors.push(`${relative6(project, character.file)} references missing location ${locationId}`);
      } else if (!locations.get(locationId).notableCharacters.includes(character.id)) {
        errors.push(`${relative6(project, character.file)} location ${locationId} is missing notable-character backlink`);
      }
    }
  }
  for (const location of project.locations) {
    for (const characterId of location.notableCharacters) {
      if (!characters.has(characterId)) {
        errors.push(`${relative6(project, location.file)} references missing character ${characterId}`);
      } else if (!characters.get(characterId).locations.includes(location.id)) {
        errors.push(`${relative6(project, location.file)} notable character ${characterId} is missing location backlink`);
      }
    }
  }
  for (const arc of project.arcs) {
    for (const characterId of arc.characters) {
      if (!characters.has(characterId)) {
        errors.push(`${relative6(project, arc.file)} references missing character ${characterId}`);
      }
    }
  }
  for (const chapter of project.chapters) {
    if (chapter.pov && !characters.has(chapter.pov)) {
      errors.push(`${relative6(project, chapter.file)} references missing POV character ${chapter.pov}`);
    }
    for (const characterId of chapter.characters.concat(chapter.mentions)) {
      if (!characters.has(characterId)) {
        errors.push(`${relative6(project, chapter.file)} references missing character ${characterId}`);
      }
    }
    for (const locationId of chapter.locations) {
      if (!locations.has(locationId)) {
        errors.push(`${relative6(project, chapter.file)} references missing location ${locationId}`);
      }
    }
    for (const arcId of chapter.arcsAdvanced) {
      if (!arcs.has(arcId)) {
        errors.push(`${relative6(project, chapter.file)} references missing arc ${arcId}`);
      }
    }
  }
  for (const faction of project.factions) {
    for (const characterId of faction.members) {
      if (!characters.has(characterId)) {
        errors.push(`${relative6(project, faction.file)} references missing member ${characterId}`);
      }
    }
    for (const locationId of faction.locations) {
      if (!locations.has(locationId)) {
        errors.push(`${relative6(project, faction.file)} references missing location ${locationId}`);
      }
    }
  }
  for (const artifact of project.artifacts) {
    if (artifact.owner && !characters.has(artifact.owner) && !factions.has(artifact.owner)) {
      errors.push(`${relative6(project, artifact.file)} references missing owner ${artifact.owner}`);
    }
    if (artifact.location && !locations.has(artifact.location)) {
      errors.push(`${relative6(project, artifact.file)} references missing location ${artifact.location}`);
    }
  }
  for (const scene of project.scenes) {
    if (scene.chapter && !chapters.has(scene.chapter)) {
      errors.push(`${relative6(project, scene.file)} references missing chapter ${scene.chapter}`);
    }
    if (scene.pov && !characters.has(scene.pov)) {
      errors.push(`${relative6(project, scene.file)} references missing POV character ${scene.pov}`);
    }
    if (scene.location && !locations.has(scene.location)) {
      errors.push(`${relative6(project, scene.file)} references missing location ${scene.location}`);
    }
    for (const characterId of scene.characters.concat(scene.mentions)) {
      if (!characters.has(characterId)) {
        errors.push(`${relative6(project, scene.file)} references missing character ${characterId}`);
      }
    }
    for (const arcId of scene.arcsAdvanced) {
      if (!arcs.has(arcId)) {
        errors.push(`${relative6(project, scene.file)} references missing arc ${arcId}`);
      }
    }
  }
  for (const question of project.questions) {
    for (const chapterId of [question.introduced, question.resolved].filter(Boolean)) {
      if (!chapters.has(chapterId)) {
        errors.push(`${relative6(project, question.file)} references missing chapter ${chapterId}`);
      }
    }
    for (const characterId of question.characters) {
      if (!characters.has(characterId)) {
        errors.push(`${relative6(project, question.file)} references missing character ${characterId}`);
      }
    }
  }
  for (const promise of project.promises) {
    for (const chapterId of [promise.planted, promise.payoff].filter(Boolean)) {
      if (!chapters.has(chapterId)) {
        errors.push(`${relative6(project, promise.file)} references missing chapter ${chapterId}`);
      }
    }
    for (const arcId of promise.arcs) {
      if (!arcs.has(arcId)) {
        errors.push(`${relative6(project, promise.file)} references missing arc ${arcId}`);
      }
    }
    for (const characterId of promise.characters) {
      if (!characters.has(characterId)) {
        errors.push(`${relative6(project, promise.file)} references missing character ${characterId}`);
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}
function checkProjectContinuity(root) {
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
function projectReport(root) {
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
function formatProjectReport(report, options = {}) {
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
  lines.push("", "Checks:", `- Validate: ${formatCheck(report.validation)}`, `- Links: ${formatCheck(report.links)}`, `- Continuity: ${formatCheck(report.continuity)}`);
  if (options.actionable) {
    lines.push("", "Next Actions:");
    appendActionLines(lines, report.actions);
  }
  return `${lines.join(`
`)}
`;
}
function projectActions(root) {
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
function formatActionReport(report) {
  const lines = [
    `# Next Writing Actions: ${report.title}`,
    "",
    `Checks: validate ${formatCheck(report.validation)}, links ${formatCheck(report.links)}, continuity ${formatCheck(report.continuity)}`,
    "",
    "Actions:"
  ];
  appendActionLines(lines, report.actions);
  return `${lines.join(`
`)}
`;
}
function formatDoctorReport(report) {
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
  return `${lines.join(`
`)}
`;
}
function reindexProject(root) {
  const project = scanProject(root);
  const changed = [];
  const charactersIndexPath = path8.join(project.root, "characters", "_index.md");
  const worldIndexPath = path8.join(project.root, "worldbuilding", "_index.md");
  const plotIndexPath = path8.join(project.root, "plot", "_index.md");
  const chaptersIndexPath = path8.join(project.root, "chapters", "_index.md");
  const scenesIndexPath = path8.join(project.root, "scenes", "_index.md");
  const questionsIndexPath = path8.join(project.root, "continuity", "questions", "_index.md");
  const promisesIndexPath = path8.join(project.root, "continuity", "promises", "_index.md");
  const glossaryIndexPath = path8.join(project.root, "glossary", "_index.md");
  const existingCharacters = safeRead(charactersIndexPath, project.root);
  const existingWorld = safeRead(worldIndexPath, project.root);
  const existingPlot = safeRead(plotIndexPath, project.root);
  const plotFrontmatter = parseFrontmatter(existingPlot, "plot/_index.md").data;
  writeChanged(charactersIndexPath, characterIndex(project.storyId, project.characters, extractSection(existingCharacters, "Relationship Map"), extractSection(existingCharacters, "Family Trees")), changed, project.root);
  writeChanged(worldIndexPath, worldIndex(project.storyId, project.locations, project.systems, project.factions, project.artifacts, extractSection(existingWorld, "World Overview")), changed, project.root);
  writeChanged(plotIndexPath, plotIndex(project.storyId, plotFrontmatter.structure ?? "three-act", project.arcs, extractSection(existingPlot, "Story Structure"), extractSection(existingPlot, "Theme Tracking")), changed, project.root);
  writeChanged(chaptersIndexPath, chapterIndex(project.storyId, project.chapters), changed, project.root);
  writeChanged(scenesIndexPath, sceneIndex(project.storyId, project.scenes), changed, project.root);
  writeChanged(questionsIndexPath, questionIndex(project.storyId, project.questions), changed, project.root);
  writeChanged(promisesIndexPath, promiseIndex(project.storyId, project.promises), changed, project.root);
  writeChanged(glossaryIndexPath, glossaryIndex(project.storyId, project.glossaryTerms), changed, project.root);
  reindexV3(project, changed);
  return { changed };
}
function reindexV3(project, changed) {
  const factsDir = path8.join(project.root, "continuity", "facts");
  const knowledgeDir = path8.join(project.root, "continuity", "knowledge");
  const relationshipsDir = path8.join(project.root, "continuity", "relationships");
  const stateDir = path8.join(project.root, "continuity", "state");
  if (fs2.existsSync(factsDir)) {
    writeChanged(path8.join(factsDir, "_index.md"), factIndex(project.storyId, project.facts), changed, project.root);
  }
  if (fs2.existsSync(knowledgeDir)) {
    writeChanged(path8.join(knowledgeDir, "_index.md"), knowledgeIndex(project.storyId, project.knowledge), changed, project.root);
  }
  if (fs2.existsSync(relationshipsDir)) {
    writeChanged(path8.join(relationshipsDir, "_index.md"), relationshipIndex(project.storyId, project.relationships), changed, project.root);
  }
  if (fs2.existsSync(stateDir)) {
    writeChanged(path8.join(stateDir, "_index.md"), stateIndex(project.storyId, project.stateSnapshots), changed, project.root);
    writeChanged(path8.join(stateDir, "current.md"), currentState(project.storyId, resolveCurrentSnapshot(project)), changed, project.root);
    syncLegacyStatePointer(project, changed);
  }
}
function syncLegacyStatePointer(project, changed) {
  const latest = resolveCurrentSnapshot(project);
  if (!project.continuity || !latest) {
    return;
  }
  if (project.continuity.data["current-chapter"] === latest.sequence) {
    return;
  }
  const statePath = path8.join(project.root, "continuity", "state.md");
  writeChanged(statePath, replaceFrontmatter(project.continuity.rawMarkdown, {
    ...project.continuity.data,
    "current-chapter": latest.sequence
  }), changed, project.root);
}
function computeWordCounts(root, options = {}) {
  const project = scanProject(root);
  const chapters = [];
  for (const chapter of project.chapters) {
    chapters.push({
      number: chapter.number,
      title: chapter.title,
      file: path8.relative(project.root, chapter.file),
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
function exportManuscript(root, options = {}) {
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
  writeFile(output.outFile, `${lines.join(`
`).trimEnd()}
`, output.writeOptions);
  return { outFile: output.outFile, chapters: project.chapters.length };
}
function buildBook(root, options = {}) {
  const format = normalizeBuildFormat(options.format ?? "markdown");
  const project = scanProject(root);
  const extension = format === "markdown" ? "md" : format;
  const output = resolveOutputPath(project, options.out, path8.join("dist", `${project.storyId}.${extension}`));
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
function migrateProject(root) {
  const projectRoot = path8.resolve(root);
  const storyPath = path8.join(projectRoot, "story.md");
  const story = readMarkdown(storyPath, projectRoot);
  const storyId = kebabCase(story.data.title ?? path8.basename(projectRoot));
  const changed = [];
  for (const directory of [
    path8.join("worldbuilding", "factions"),
    path8.join("worldbuilding", "artifacts"),
    "scenes",
    path8.join("continuity", "questions"),
    path8.join("continuity", "promises"),
    path8.join("glossary", "terms")
  ]) {
    ensureDirectory(path8.join(projectRoot, directory), changed, projectRoot);
  }
  ensureFile(path8.join(projectRoot, "scenes", "_index.md"), sceneIndex(storyId, []), changed, projectRoot);
  ensureFile(path8.join(projectRoot, "continuity", "state.md"), continuityState(storyId), changed, projectRoot);
  ensureFile(path8.join(projectRoot, "continuity", "questions", "_index.md"), questionIndex(storyId, []), changed, projectRoot);
  ensureFile(path8.join(projectRoot, "continuity", "promises", "_index.md"), promiseIndex(storyId, []), changed, projectRoot);
  ensureFile(path8.join(projectRoot, "glossary", "_index.md"), glossaryIndex(storyId, []), changed, projectRoot);
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
function migrateToV3(projectRoot, storyId, changed) {
  for (const directory of V3_DIRECTORIES) {
    ensureDirectory(path8.join(projectRoot, directory), changed, projectRoot);
  }
  ensureFile(path8.join(projectRoot, "continuity", "facts", "_index.md"), factIndex(storyId, []), changed, projectRoot);
  ensureFile(path8.join(projectRoot, "continuity", "knowledge", "_index.md"), knowledgeIndex(storyId, []), changed, projectRoot);
  ensureFile(path8.join(projectRoot, "continuity", "relationships", "_index.md"), relationshipIndex(storyId, []), changed, projectRoot);
  const preStorySnapshot = { id: "chapter-00", sequence: 0, chapter: "" };
  ensureFile(path8.join(projectRoot, "continuity", "state", "_index.md"), stateIndex(storyId, [preStorySnapshot]), changed, projectRoot);
  ensureFile(path8.join(projectRoot, "continuity", "state", "chapter-00.md"), stateSnapshot(storyId, {
    chapter: "",
    sequence: 0,
    note: "Durable state before chapter one opens. Seeded by migration; review and fill in."
  }), changed, projectRoot);
  ensureFile(path8.join(projectRoot, "continuity", "state", "current.md"), currentState(storyId, {
    id: "chapter-00",
    chapter: "",
    sequence: 0
  }), changed, projectRoot);
  migrateKnowledgeState(projectRoot, changed);
  migrateChapterSnapshots(projectRoot, storyId, changed);
}
function migrateChapterSnapshots(projectRoot, storyId, changed) {
  const chapters = readChapterNumbers(projectRoot);
  if (chapters.length === 0) {
    return;
  }
  const contiguous = chapters.every((chapter, index) => chapter.number === index + 1);
  if (!contiguous) {
    return;
  }
  const legacy = legacyDurableState(projectRoot);
  const latest = chapters[chapters.length - 1];
  for (const chapter of chapters) {
    const isLatest = chapter.id === latest.id;
    ensureFile(path8.join(projectRoot, "continuity", "state", `${chapter.id}.md`), stateSnapshot(storyId, {
      chapter: chapter.id,
      sequence: chapter.number,
      provisional: true,
      characters: isLatest ? legacy.characters : [],
      objects: isLatest ? legacy.objects : [],
      note: isLatest ? "Provisional. Reconstructed at migration from continuity/state.md. Review before relying on it." : "Provisional. v2 did not record per-chapter state, so this snapshot is intentionally empty."
    }), changed, projectRoot);
  }
  writeChanged(path8.join(projectRoot, "continuity", "state", "current.md"), currentState(storyId, {
    id: latest.id,
    chapter: latest.id,
    sequence: latest.number
  }), changed, projectRoot);
}
function readChapterNumbers(projectRoot) {
  const directory = path8.join(projectRoot, "chapters");
  if (!fs2.existsSync(directory)) {
    return [];
  }
  return fs2.readdirSync(directory).filter((name) => name.endsWith(".md") && name !== "_index.md").map((name) => {
    const id = path8.basename(name, ".md");
    const data = readMarkdown(path8.join(directory, name), projectRoot).data;
    return { id, number: Number(data.number ?? chapterNumberFromFile(name) ?? 0) };
  }).filter((chapter) => Number.isInteger(chapter.number) && chapter.number > 0).sort((left, right) => left.number - right.number);
}
function legacyDurableState(projectRoot) {
  const data = readMarkdown(path8.join(projectRoot, "continuity", "state.md"), projectRoot).data;
  const mappings = (value) => asArray(value).filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry));
  return {
    characters: mappings(data["character-state"]).map(({ character, ...rest }) => ({ id: character, ...rest })),
    objects: mappings(data["object-state"]).map(({ artifact, ...rest }) => ({ id: artifact, ...rest }))
  };
}
function migrateKnowledgeState(projectRoot, changed) {
  const legacyPath = path8.join(projectRoot, "continuity", "state.md");
  const entries = asArray(readMarkdown(legacyPath, projectRoot).data["knowledge-state"]).filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)).filter((entry) => entry.character && entry.knows);
  const chapters = new Set(fs2.existsSync(path8.join(projectRoot, "chapters")) ? fs2.readdirSync(path8.join(projectRoot, "chapters")).filter((name) => name.endsWith(".md") && name !== "_index.md").map((name) => path8.basename(name, ".md")) : []);
  const resolves = (value) => {
    const text = String(value ?? "").trim();
    return text !== "" && (text === PRE_STORY2 || chapters.has(text));
  };
  const byCharacter = new Map;
  for (const entry of entries) {
    const factId = kebabCase(entry.knows);
    if (!factId) {
      continue;
    }
    const learnedIn = entry["learned-in"];
    const carried = resolves(learnedIn);
    const unresolved = Boolean(learnedIn) && !carried;
    ensureFile(path8.join(projectRoot, "continuity", "facts", `${factId}.md`), factFile(factId, {
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
        ...carried ? { "learned-in": learnedIn } : {},
        ...unresolved ? { notes: `migration could not resolve learned-in ${learnedIn}; set it by hand` } : {}
      });
    }
    byCharacter.set(entry.character, record);
  }
  for (const [character, facts] of byCharacter) {
    ensureFile(path8.join(projectRoot, "continuity", "knowledge", `${character}.md`), knowledgeFile(character, facts), changed, projectRoot);
  }
}
function recordKnowledge(root, options) {
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
  if (learnedIn && learnedIn !== PRE_STORY2 && !project.chapters.some((item) => item.id === learnedIn)) {
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
  const file = path8.join(project.root, "continuity", "knowledge", `${character}.md`);
  const existing = fs2.existsSync(file) ? readMarkdown(file, project.root) : null;
  const entries = existing ? asArray(existing.data.facts).filter((item) => item && item.fact !== fact) : [];
  const facts = entries.concat([entry]).sort((left, right) => String(left.fact).localeCompare(String(right.fact)));
  const markdown = existing ? replaceFrontmatter(existing.rawMarkdown, { ...existing.data, facts }) : knowledgeFile(character, facts);
  writeFile(file, markdown, { root: project.root });
  const reindexed = reindexProject(project.root);
  return { character, fact, status, file, changed: [file].concat(reindexed.changed) };
}
function stateReport(root, options = {}) {
  const project = scanProject(root);
  const requested = String(options.chapter ?? "").trim();
  const snapshot = requested ? project.stateSnapshots.find((item) => item.chapter === requested || item.id === requested) : resolveCurrentSnapshot(project);
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
    trajectory: character ? characterTrajectory(project, character) : [],
    history: project.stateSnapshots.map((item) => ({
      id: item.id,
      sequence: item.sequence,
      chapter: item.chapter,
      provisional: item.provisional
    }))
  };
}
function characterTrajectory(project, character) {
  const steps = [];
  let previous = null;
  for (const snapshot of project.stateSnapshots) {
    const entry = snapshot.characters.find((item) => item && item.id === character);
    if (!entry) {
      continue;
    }
    const { id, ...fields } = entry;
    const changed = Object.entries(fields).filter(([key, value]) => value !== "" && (!previous || previous[key] !== value)).map(([key, value]) => ({ field: key, value }));
    if (changed.length > 0) {
      steps.push({ chapter: snapshot.chapter || "pre-story", sequence: snapshot.sequence, changed });
    }
    previous = fields;
  }
  return steps;
}
function knowledgeReport(root, options = {}) {
  const project = scanProject(root);
  const requested = String(options.character ?? "").trim();
  const statements = new Map(project.facts.map((fact) => [fact.id, fact.statement]));
  const records = project.knowledge.filter((record) => !requested || record.character === requested).map((record) => ({
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
function formatStateReport(report) {
  const lines = [];
  if (!report.snapshot) {
    lines.push("No state snapshots yet.");
    return `${lines.join(`
`)}
`;
  }
  const snapshot = report.snapshot;
  lines.push(`State ${snapshot.id} (sequence ${snapshot.sequence}, chapter ${snapshot.chapter || "pre-story"})`);
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
  return `${lines.join(`
`)}
`;
}
function appendStateSection(lines, title, entries) {
  if (entries.length === 0) {
    return;
  }
  lines.push(`${title}:`);
  for (const entry of entries) {
    const detail = Object.entries(entry).filter(([key, value]) => key !== "id" && value !== "").map(([key, value]) => `${key}=${value}`).join(" ");
    lines.push(`  ${entry.id}${detail ? ` ${detail}` : ""}`);
  }
}
function formatKnowledgeReport(report) {
  if (report.records.length === 0) {
    return `No knowledge records yet.
`;
  }
  const lines = [];
  for (const record of report.records) {
    lines.push(`${record.character}:`);
    if (record.facts.length === 0) {
      lines.push("  (no tracked facts)");
      continue;
    }
    for (const entry of record.facts) {
      const suffix = [entry.learnedIn && `learned-in ${entry.learnedIn}`, entry.confidence && `confidence ${entry.confidence}`].filter(Boolean).join(", ");
      lines.push(`  ${entry.status.padEnd(11)} ${entry.fact}${suffix ? ` (${suffix})` : ""}`);
    }
  }
  return `${lines.join(`
`)}
`;
}
function commitWrites(root, writes) {
  const originals = writes.map((write) => ({
    file: write.file,
    existed: fs2.existsSync(write.file),
    contents: fs2.existsSync(write.file) ? fs2.readFileSync(write.file) : null
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
        fs2.writeFileSync(original.file, original.contents);
      } else {
        fs2.rmSync(original.file, { force: true });
      }
    }
    throw error;
  }
  return written;
}
function listCandidates(root, options = {}) {
  const project = scanProject(root);
  const chapter = String(options.chapter ?? "").trim();
  return {
    root: project.root,
    candidates: project.candidates.filter((candidate) => !chapter || candidate.chapter === chapter).map((candidate) => ({
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
function acceptCandidate(root, options = {}) {
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
function rejectCandidate(root, options = {}) {
  const project = scanProject(root);
  const plan = planRejection(project, options);
  const written = commitWrites(project.root, plan.writes);
  return {
    chapter: plan.candidate.chapter,
    candidate: plan.candidate.id,
    changed: written
  };
}
function readTransactionRecord(root, options = {}) {
  const project = scanProject(root);
  const chapter = String(options.chapter ?? "").trim();
  const transaction = project.transactions.find((item) => item.id === chapter);
  if (!transaction) {
    throw new Error(`No transaction for ${chapter || "(unset)"}`);
  }
  return transaction.data;
}
function sealArc(root, options = {}) {
  const project = scanProject(root);
  const arcId = String(options.arc ?? "").trim();
  const arc = project.arcs.find((item) => item.id === arcId);
  if (!arc) {
    throw new Error(`Unknown arc: ${arcId || "(unset)"}`);
  }
  const version = project.sealedArcs.filter((plan) => plan.arc === arc.id).reduce((max, plan) => Math.max(max, plan.version), 0) + 1;
  const id = `${arc.id}-v${version}`;
  const file = path8.join(project.root, "plot", "arcs", "sealed", `${id}.md`);
  if (fs2.existsSync(file)) {
    throw new Error(`${relative6(project, file)} already exists`);
  }
  const sourceHash = createHash2("sha256").update(JSON.stringify(arc.rawData), "utf8").digest("hex");
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
function contextProjection(root, options = {}) {
  return projectContext(scanProject(root), options);
}
function formatContextProjection(projection) {
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
function proseDiagnostics(root, options = {}) {
  const project = scanProject(root);
  const requested = String(options.chapter ?? "").trim();
  const chapters = project.chapters.filter((chapter) => !requested || chapter.id === requested).map((chapter) => ({ id: chapter.id, text: chapterProse(parseFrontmatter(chapter.rawMarkdown, chapter.file).body) }));
  if (requested && chapters.length === 0) {
    throw new Error(`Unknown chapter: ${requested}`);
  }
  return analyzeProse(chapters, options);
}
function arcSimulation(root, options = {}) {
  const project = scanProject(root);
  const brief = buildArcSimulation(project, options);
  if (!options.write) {
    return { brief, file: "" };
  }
  const file = path8.join(project.root, "plot", "arcs", "simulations", `${brief.arc}-v${brief["plan-version"] || 1}.json`);
  writeFile(file, `${JSON.stringify(brief, null, 2)}${String.fromCharCode(10)}`, { root: project.root });
  return { brief, file };
}
function renderPacket(root, options = {}) {
  const project = scanProject(root);
  const packet = buildRenderPacket(project, options);
  if (!options.write) {
    return { packet, file: "" };
  }
  const version = Number(options.version ?? 1);
  const file = path8.join(project.root, "work", "chapters", packet.chapter, `render-packet-v${version}.json`);
  writeFile(file, `${JSON.stringify(packet, null, 2)}${String.fromCharCode(10)}`, { root: project.root });
  return { packet, file };
}
function createCandidate(root, options = {}) {
  const project = scanProject(root);
  const chapter = String(options.chapter ?? "").trim();
  requireKebabId(chapter, "chapter id");
  const number = Number(options.number ?? Number(String(chapter).replace(/[^0-9]/g, "")) ?? 0);
  const existing = project.candidates.filter((candidate) => candidate.chapter === chapter);
  const id = `candidate-${String(existing.length + 1).padStart(3, "0")}`;
  const file = path8.join(project.root, "work", "chapters", chapter, `${id}.md`);
  if (fs2.existsSync(file)) {
    throw new Error(`${relative6(project, file)} already exists`);
  }
  writeFile(file, candidateFile(chapter, id, number, options), { root: project.root });
  return { chapter, candidate: id, file };
}
function createEntity(root, options) {
  const project = scanProject(root);
  const kind = normalizeKind(options.kind);
  const name = String(options.name ?? "").trim();
  if (!name) {
    throw new Error(`A ${kind} name is required`);
  }
  const entity = buildEntity(project, kind, name, options);
  if (fs2.existsSync(entity.file)) {
    throw new Error(`${relative6(project, entity.file)} already exists`);
  }
  writeFile(entity.file, entity.markdown, { root: project.root });
  applyEntityBacklinks(project.root, kind, entity.id, readMarkdown(entity.file, project.root).data);
  const reindexed = reindexProject(project.root);
  return { kind, id: entity.id, file: entity.file, changed: [entity.file].concat(reindexed.changed) };
}
function renameEntity(root, options) {
  const project = scanProject(root);
  const kind = normalizeKind(options.kind);
  const oldId = String(options.id ?? "").trim();
  const name = String(options.name ?? "").trim();
  if (!oldId || !name) {
    throw new Error("rename requires an entity id and a new name");
  }
  const config = entityConfig(kind);
  const oldFile = path8.join(project.root, config.dir, `${oldId}.md`);
  requireKebabId(oldId, `${kind} id`);
  assertSafeProjectPath(oldFile, project.root);
  if (!fs2.existsSync(oldFile)) {
    throw new Error(`${kind} ${oldId} does not exist`);
  }
  const markdown = readMarkdown(oldFile, project.root);
  const newId = kind === "chapter" ? oldId : kebabCase(name);
  const newFile = path8.join(project.root, config.dir, `${newId}.md`);
  assertSafeProjectPath(newFile, project.root);
  if (newFile !== oldFile && fs2.existsSync(newFile)) {
    throw new Error(`${kind} ${newId} already exists`);
  }
  const data = { ...markdown.data, [config.titleField]: name };
  writeFile(oldFile, replaceFrontmatter(markdown.rawMarkdown, data), { root: project.root });
  if (newFile !== oldFile) {
    fs2.renameSync(oldFile, newFile);
    replaceEntityReferences(project.root, oldId, newId);
  }
  const reindexed = reindexProject(project.root);
  return { kind, oldId, id: newId, file: newFile, changed: [newFile].concat(reindexed.changed) };
}
function removeEntity(root, options) {
  const project = scanProject(root);
  const kind = normalizeKind(options.kind);
  const id = String(options.id ?? "").trim();
  if (!id) {
    throw new Error("remove requires an entity id");
  }
  const config = entityConfig(kind);
  const file = path8.join(project.root, config.dir, `${id}.md`);
  requireKebabId(id, `${kind} id`);
  assertSafeProjectPath(file, project.root);
  if (!fs2.existsSync(file)) {
    throw new Error(`${kind} ${id} does not exist`);
  }
  fs2.rmSync(file);
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
  const rows = characters.length === 0 ? ["| *No characters yet* | | | |"] : characters.map((character) => `| ${character.name} | ${character.role} | ${character.status} | [${character.id}](${character.id}.md) |`);
  return `${stringifyFrontmatter({ type: "character-registry", story: storyId })}# Characters

## Registry

| Name | Role | Status | File |
|------|------|--------|------|
${rows.join(`
`)}

## Relationship Map

${relationshipMap || "*No relationships defined yet.*"}

## Family Trees

${familyTrees || "*No family trees defined yet.*"}
`;
}
function worldIndex(storyId, locations, systems, factions, artifacts, overview) {
  const locationRows = locations.length === 0 ? ["| *No locations yet* | | | |"] : locations.map((location) => `| ${location.name} | ${titleCaseSlug(location.type)} | ${location.region} | [${location.id}](locations/${location.id}.md) |`);
  const systemRows = systems.length === 0 ? ["| *No systems yet* | | |"] : systems.map((system) => `| ${system.name} | ${titleCaseSlug(system.type)} | [${system.id}](systems/${system.id}.md) |`);
  const factionRows = factions.length === 0 ? ["| *No factions yet* | | | |"] : factions.map((faction) => `| ${faction.name} | ${titleCaseSlug(faction.type)} | ${faction.status} | [${faction.id}](factions/${faction.id}.md) |`);
  const artifactRows = artifacts.length === 0 ? ["| *No artifacts yet* | | | |"] : artifacts.map((artifact) => `| ${artifact.name} | ${titleCaseSlug(artifact.type)} | ${artifact.status} | [${artifact.id}](artifacts/${artifact.id}.md) |`);
  return `${stringifyFrontmatter({ type: "world-registry", story: storyId })}# Worldbuilding

## World Overview

${overview || "*Describe the world at a high level here.*"}

## Locations

| Name | Type | Region | File |
|------|------|--------|------|
${locationRows.join(`
`)}

## Systems

| Name | Type | File |
|------|------|------|
${systemRows.join(`
`)}

## Factions

| Name | Type | Status | File |
|------|------|--------|------|
${factionRows.join(`
`)}

## Artifacts

| Name | Type | Status | File |
|------|------|--------|------|
${artifactRows.join(`
`)}
`;
}
function plotIndex(storyId, structure, arcs, storyStructure, themeTracking) {
  const arcRows = arcs.length === 0 ? ["| *No arcs yet* | | | |"] : arcs.map((arc) => `| ${arc.name} | ${arc.type} | ${arc.status} | [${arc.id}](arcs/${arc.id}.md) |`);
  return `${stringifyFrontmatter({ type: "plot-registry", story: storyId, structure })}# Plot Structure

## Story Structure

${storyStructure || "**Model:** Three-Act Structure (adjust as needed)"}

## Arcs

| Name | Type | Status | File |
|------|------|--------|------|
${arcRows.join(`
`)}

## Theme Tracking

${themeTracking || `| Theme | Arcs | Chapters |
|-------|------|----------|
| *No themes tracked yet* | | |`}
`;
}
function chapterIndex(storyId, chapters) {
  const rows = chapters.length === 0 ? ["| *No chapters yet* | | | | | |"] : chapters.map((chapter) => `| ${chapter.number} | ${chapter.title} | ${chapter.pov} | ${chapter.status} | ${chapter.wordCount} | [${chapter.id}](${path8.basename(chapter.file)}) |`);
  const total = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  return `${stringifyFrontmatter({ type: "chapter-registry", story: storyId })}# Chapters

## Registry

| # | Title | POV | Status | Word Count | File |
|---|-------|-----|--------|------------|------|
${rows.join(`
`)}

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
  const rows = scenes.length === 0 ? ["| *No scenes yet* | | | | | |"] : scenes.map((scene) => `| ${scene.chapter} | ${scene.scene} | ${scene.title} | ${scene.pov} | ${scene.status} | [${scene.id}](${scene.id}.md) |`);
  return `${stringifyFrontmatter({ type: "scene-registry", story: storyId })}# Scenes

## Registry

| Chapter | Scene | Title | POV | Status | File |
|---------|-------|-------|-----|--------|------|
${rows.join(`
`)}
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
  const rows = questions.length === 0 ? ["| *No questions yet* | | | |"] : questions.map((question) => `| ${question.title} | ${question.status} | ${question.introduced} | [${question.id}](${question.id}.md) |`);
  return `${stringifyFrontmatter({ type: "question-registry", story: storyId })}# Continuity Questions

## Registry

| Question | Status | Introduced | File |
|----------|--------|------------|------|
${rows.join(`
`)}
`;
}
function promiseIndex(storyId, promises) {
  const rows = promises.length === 0 ? ["| *No promises yet* | | | |"] : promises.map((promise) => `| ${promise.title} | ${promise.status} | ${promise.planted} | [${promise.id}](${promise.id}.md) |`);
  return `${stringifyFrontmatter({ type: "promise-registry", story: storyId })}# Promises And Payoffs

## Registry

| Promise | Status | Planted | File |
|---------|--------|---------|------|
${rows.join(`
`)}
`;
}
function glossaryIndex(storyId, terms) {
  const rows = terms.length === 0 ? ["| *No terms yet* | | |"] : terms.map((term) => `| ${term.term} | ${term.category} | [${term.id}](terms/${term.id}.md) |`);
  return `${stringifyFrontmatter({ type: "glossary-registry", story: storyId })}# Glossary

## Registry

| Term | Category | File |
|------|----------|------|
${rows.join(`
`)}
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
  const nextLabel = activeArcNames.length > 0 ? `advance ${activeArcNames.join(", ")}` : "establish the next story beat";
  actions.push(action("P2", `Draft chapter ${nextNumber}`, `Use story add chapter "Chapter ${nextNumber}" --number ${nextNumber}, then outline scenes to ${nextLabel}.`));
  if (project.characters.length === 0) {
    actions.push(action("P2", "Create first character", 'Use story add character "Name" --role protagonist before drafting prose.'));
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
    const id2 = `chapter-${String(number).padStart(2, "0")}`;
    return entityResult(project, kind, id2, chapterFile(name, number, options));
  }
  if (kind === "scene") {
    const chapter = String(options.chapter ?? project.chapters.at(-1)?.id ?? "chapter-01").trim();
    requireKebabId(chapter, "chapter id");
    const scene = Number(options.scene ?? nextSceneNumber(project, chapter));
    const id2 = `${chapter}-scene-${String(scene).padStart(2, "0")}`;
    return entityResult(project, kind, id2, sceneFile(name, chapter, scene, options));
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
function buildRelationship(project, kind, options) {
  const participants = normalizeList(options.character, []).map((value) => String(value).trim()).filter(Boolean);
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
  return { id, markdown, file: path8.join(project.root, config.dir, `${id}.md`) };
}
function entityConfig(kind) {
  const configs = {
    character: { dir: "characters", titleField: "name" },
    location: { dir: path8.join("worldbuilding", "locations"), titleField: "name" },
    system: { dir: path8.join("worldbuilding", "systems"), titleField: "name" },
    faction: { dir: path8.join("worldbuilding", "factions"), titleField: "name" },
    artifact: { dir: path8.join("worldbuilding", "artifacts"), titleField: "name" },
    arc: { dir: path8.join("plot", "arcs"), titleField: "name" },
    chapter: { dir: "chapters", titleField: "title" },
    scene: { dir: "scenes", titleField: "title" },
    question: { dir: path8.join("continuity", "questions"), titleField: "title" },
    promise: { dir: path8.join("continuity", "promises"), titleField: "title" },
    term: { dir: path8.join("glossary", "terms"), titleField: "term" },
    fact: { dir: path8.join("continuity", "facts"), titleField: "statement" },
    knowledge: { dir: path8.join("continuity", "knowledge"), titleField: "character" },
    relationship: { dir: path8.join("continuity", "relationships"), titleField: "id" }
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
  return project.scenes.filter((scene) => scene.chapter === chapter).reduce((max, scene) => Math.max(max, scene.scene), 0) + 1;
}
function ensureDirectory(directory, changed, root) {
  if (!fs2.existsSync(directory)) {
    assertLexicallyInsideRoot(directory, root);
    fs2.mkdirSync(directory, { recursive: true });
    assertSafeProjectDirectory(directory, root);
    changed.push(directory);
    return;
  }
  assertSafeProjectDirectory(directory, root);
}
function ensureFile(filePath, contents, changed, root) {
  if (!fs2.existsSync(filePath)) {
    writeFile(filePath, contents, { root });
    changed.push(filePath);
    return;
  }
  assertSafeProjectPath(filePath, root);
}
function replaceEntityReferences(root, oldId, newId) {
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
    if (!fs2.existsSync(file)) {
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
        addFrontmatterListValue(root, path8.join("characters", `${characterId}.md`), "locations", id);
      }
    }
  }
  if (kind === "character") {
    for (const locationId of asArray(data.locations)) {
      if (isKebabId(locationId)) {
        addFrontmatterListValue(root, path8.join("worldbuilding", "locations", `${locationId}.md`), "notable-characters", id);
      }
    }
  }
}
function addFrontmatterListValue(root, relativePath, field, value) {
  const filePath = path8.join(root, relativePath);
  if (!fs2.existsSync(filePath) || !value) {
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
  for (const entry of fs2.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path8.join(root, entry.name);
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
var SCENE_BREAK_PATTERN = /^([*_-])( ?\1){2,}$/;
function markdownParagraphs(markdown) {
  const paragraphs = [];
  for (const paragraph of markdown.replace(/^#+\s+/gm, "").split(/\n{2,}/)) {
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
    localHeader.writeUInt32LE(67324752, 0);
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
    centralHeader.writeUInt32LE(33639248, 0);
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
  end.writeUInt32LE(101010256, 0);
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
  let crc = 4294967295;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 255] ^ crc >>> 8;
  }
  return (crc ^ 4294967295) >>> 0;
}
var CRC_TABLE = [];
for (let index = 0;index < 256; index += 1) {
  let value = index;
  for (let bit = 0;bit < 8; bit += 1) {
    value = value & 1 ? 3988292384 ^ value >>> 1 : value >>> 1;
  }
  CRC_TABLE.push(value >>> 0);
}
function xmlEscape(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function readCandidates(root) {
  const workRoot = path8.join(root, "work", "chapters");
  if (!fs2.existsSync(workRoot)) {
    return [];
  }
  assertSafeProjectDirectory(workRoot, root);
  const candidates = [];
  for (const chapterDir of fs2.readdirSync(workRoot, { withFileTypes: true })) {
    if (!chapterDir.isDirectory()) {
      continue;
    }
    const directory = path8.join(workRoot, chapterDir.name);
    assertSafeProjectDirectory(directory, root);
    for (const entry of fs2.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        continue;
      }
      const file = path8.join(directory, entry.name);
      const markdown = readMarkdown(file, root);
      if (markdown.data.type !== "chapter-candidate") {
        continue;
      }
      const data = markdown.data;
      candidates.push({
        id: path8.basename(entry.name, ".md"),
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
  const directory = path8.join(root, "transactions");
  if (!fs2.existsSync(directory)) {
    return [];
  }
  assertSafeProjectDirectory(directory, root);
  return fs2.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name).sort().map((name) => {
    const file = path8.join(directory, name);
    assertSafeProjectPath(file, root);
    return {
      id: path8.basename(name, ".json"),
      file,
      data: JSON.parse(fs2.readFileSync(file, "utf8"))
    };
  });
}
function readEntityFiles(root, relativeDir, mapEntity) {
  const directory = path8.join(root, relativeDir);
  if (!fs2.existsSync(directory)) {
    return [];
  }
  assertSafeProjectDirectory(directory, root);
  return fs2.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "_index.md").map((entry) => entry.name).sort().map((file) => {
    const fullPath = path8.join(directory, file);
    const markdown = readMarkdown(fullPath, root);
    return mapEntity(path8.basename(file, ".md"), fullPath, markdown.data, markdown);
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
  const outFile = path8.resolve(project.root, rawOut);
  const shouldEnforceRoot = enforceRoot ?? !path8.isAbsolute(String(rawOut));
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
  if (declaredVersion !== undefined && declaredVersion !== STORY_SCHEMA_VERSION && !LEGACY_SCHEMA_VERSIONS.has(declaredVersion)) {
    errors.push(`story.md schema-version must be ${STORY_SCHEMA_VERSION} (legacy ${[...LEGACY_SCHEMA_VERSIONS].join(", ")} still accepted)`);
  }
}
function validateIndexFrontmatter(project, errors) {
  for (const [relativePath, expectedType] of INDEX_SCHEMAS) {
    const label = relativePath;
    const data = readMarkdown(path8.join(project.root, relativePath), project.root).data;
    requireFields(data, ["type", "story"], label, errors);
    requireScalar(data, "type", label, errors);
    requireScalar(data, "story", label, errors);
    if (data.type !== undefined && data.type !== expectedType) {
      errors.push(`${label} type must be ${expectedType}`);
    }
    if (data.story !== undefined && data.story !== project.storyId) {
      errors.push(`${label} story must be ${project.storyId}`);
    }
    if (relativePath === path8.join("plot", "_index.md")) {
      requireFields(data, ["structure"], label, errors);
      requireScalar(data, "structure", label, errors);
    }
  }
}
function validateCharacters(project, errors) {
  for (const character of project.characters) {
    const label = relative6(project, character.file);
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
    const label = relative6(project, location.file);
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
    const label = relative6(project, system.file);
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
    const label = relative6(project, faction.file);
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
    const label = relative6(project, artifact.file);
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
    const label = relative6(project, arc.file);
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
  const seenNumbers = new Map;
  for (const chapter of project.chapters) {
    const label = relative6(project, chapter.file);
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
    const label = relative6(project, scene.file);
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
  const label = path8.join("continuity", "state.md");
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
    const label = relative6(project, question.file);
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
    const label = relative6(project, promise.file);
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
    const label = relative6(project, term.file);
    const data = readMarkdown(term.file, project.root).data;
    validateEntityId(term.id, label, errors);
    requireFields(data, ["term", "category"], label, errors);
    requireScalar(data, "term", label, errors);
    requireScalar(data, "category", label, errors);
    validateEnum(data, "category", TERM_CATEGORIES, label, errors);
    validateStringArray(data, "aliases", label, errors);
  }
}
function validateV3Structure(project, errors) {
  for (const fact of project.facts) {
    const label = relative6(project, fact.file);
    validateEntityId(fact.id, label, errors);
    requireFields(fact.rawData, ["statement"], label, errors);
    requireScalar(fact.rawData, "statement", label, errors);
    requireExactType(fact.rawData, "fact", label, errors);
  }
  for (const record of project.knowledge) {
    const label = relative6(project, record.file);
    validateEntityId(record.id, label, errors);
    requireFields(record.rawData, ["character", "facts"], label, errors);
    requireScalar(record.rawData, "character", label, errors);
    validateObjectArray(record.rawData, "facts", label, errors);
    requireExactType(record.rawData, "knowledge-record", label, errors);
  }
  for (const relationship of project.relationships) {
    const label = relative6(project, relationship.file);
    validateEntityId(relationship.id, label, errors);
    requireFields(relationship.rawData, ["participants"], label, errors);
    validateStringArray(relationship.rawData, "participants", label, errors);
    requireExactType(relationship.rawData, "relationship", label, errors);
  }
  for (const snapshot of project.stateSnapshots) {
    const label = relative6(project, snapshot.file);
    requireFields(snapshot.rawData, ["sequence"], label, errors);
    requireInteger(snapshot.rawData, "sequence", label, errors);
    validateObjectArray(snapshot.rawData, "characters", label, errors);
    validateObjectArray(snapshot.rawData, "objects", label, errors);
    validateObjectArray(snapshot.rawData, "relationships", label, errors);
    requireExactType(snapshot.rawData, "state-snapshot", label, errors);
  }
  if (project.currentState) {
    const label = path8.join("continuity", "state", "current.md");
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
  const match = /chapter-(\d+)/.exec(path8.basename(file));
  return match ? Number.parseInt(match[1], 10) : 0;
}
function relative6(project, file) {
  return path8.relative(project.root, file);
}

// src/import.js
var CHAPTER_HEADING_PATTERN = /^chapter\s*(?:\d+|[ivxlc]+)?\s*[:.\-–—]*\s*(.*)$/i;
var FRONTMATTER_PATTERN2 = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
var CANDIDATE_THRESHOLD = 3;
var CANDIDATE_LIMIT = 25;
var CANDIDATE_STOPWORDS = new Set([
  "A",
  "An",
  "And",
  "At",
  "But",
  "By",
  "Dr",
  "For",
  "He",
  "Her",
  "His",
  "I",
  "If",
  "In",
  "It",
  "Its",
  "Mr",
  "Mrs",
  "Ms",
  "No",
  "Not",
  "Of",
  "On",
  "Or",
  "She",
  "That",
  "The",
  "Then",
  "They",
  "Their",
  "This",
  "To",
  "We",
  "When",
  "While",
  "With",
  "Yes",
  "You"
]);
function importManuscript(options) {
  const rawSource = String(options.source ?? "").trim();
  if (!rawSource) {
    throw new Error("An import source file or directory is required");
  }
  const cwd = options.cwd ?? process.cwd();
  const source = path9.resolve(cwd, rawSource);
  if (!fs3.existsSync(source)) {
    throw new Error(`Import source not found: ${source}`);
  }
  const chapters = splitChapters(readSourceDocuments(source));
  if (chapters.length === 0) {
    throw new Error("No chapter content found in import source");
  }
  const created = createStoryProject({
    title: options.title,
    cwd,
    dir: options.dir,
    genre: options.genre,
    subGenre: options.subGenre,
    settingEra: options.settingEra,
    themes: options.themes,
    pov: options.pov,
    tense: options.tense,
    synopsis: options.synopsis ?? `Imported from ${path9.basename(source)}. Replace with a 2-3 sentence synopsis.`,
    force: options.force
  });
  let totalWords = 0;
  chapters.forEach((chapter, index) => {
    const number = index + 1;
    const words = wordCount(chapter.prose);
    totalWords += words;
    const file = path9.join(created.root, "chapters", `chapter-${String(number).padStart(2, "0")}.md`);
    fs3.writeFileSync(file, chapterMarkdown(chapter.title, number, words, chapter.prose), "utf8");
  });
  reindexProject(created.root);
  return {
    root: created.root,
    storyId: created.storyId,
    chapters: chapters.length,
    words: totalWords,
    candidates: extractNameCandidates(chapters.map((chapter) => chapter.prose).join(`

`))
  };
}
function extractNameCandidates(prose) {
  const counts = new Map;
  for (const match of prose.matchAll(/\b[A-Z][a-z']+(?:\s+[A-Z][a-z']+)+\b/g)) {
    const words = match[0].replace(/\s+/g, " ").split(" ");
    while (words.length > 0 && CANDIDATE_STOPWORDS.has(words[0])) {
      words.shift();
    }
    if (words.length > 0) {
      addCandidate(counts, words.join(" "));
    }
  }
  for (const match of prose.matchAll(/(?<=[a-z][,;:]?\s)(?<![A-Z][a-z']*\s)[A-Z][a-z']+\b(?!\s+[A-Z][a-z'])/g)) {
    if (!CANDIDATE_STOPWORDS.has(match[0])) {
      addCandidate(counts, match[0]);
    }
  }
  return [...counts.entries()].filter(([, count]) => count >= CANDIDATE_THRESHOLD).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, CANDIDATE_LIMIT).map(([name, count]) => ({ name, count }));
}
function addCandidate(counts, name) {
  counts.set(name, (counts.get(name) ?? 0) + 1);
}
function readSourceDocuments(source) {
  if (fs3.statSync(source).isFile()) {
    return [{ name: path9.basename(source), text: fs3.readFileSync(source, "utf8") }];
  }
  const documents = fs3.readdirSync(source, { withFileTypes: true }).filter((entry) => entry.isFile() && /\.(md|markdown|txt)$/i.test(entry.name)).map((entry) => entry.name).sort().map((name) => ({ name, text: fs3.readFileSync(path9.join(source, name), "utf8") }));
  if (documents.length === 0) {
    throw new Error(`No markdown or text files found in ${source}`);
  }
  return documents;
}
function splitChapters(documents) {
  const chapters = [];
  for (const document of documents) {
    const text = document.text.replace(FRONTMATTER_PATTERN2, "").replace(/\r\n/g, `
`);
    const sections = splitByChapterHeadings(text);
    if (sections.length > 0) {
      chapters.push(...sections);
    } else {
      chapters.push(singleChapter(text, document.name));
    }
  }
  return chapters.filter((chapter) => chapter.prose !== "");
}
function splitByChapterHeadings(text) {
  const lines = text.split(`
`);
  const sections = [];
  let current = null;
  const preamble = [];
  for (const line of lines) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const chapterMatch = heading ? CHAPTER_HEADING_PATTERN.exec(heading[1].trim()) : null;
    if (chapterMatch) {
      if (current) {
        sections.push(finishChapter(current));
      }
      current = { title: chapterMatch[1].trim() || heading[1].trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (!current) {
    return [];
  }
  sections.push(finishChapter(current));
  const opening = stripTitleHeading(preamble.join(`
`)).trim();
  if (opening !== "") {
    sections.unshift({ title: "Opening", prose: opening });
  }
  return sections;
}
function finishChapter(section) {
  return { title: section.title, prose: section.lines.join(`
`).trim() };
}
function singleChapter(text, fileName) {
  const headingMatch = /^#\s+(.*)$/m.exec(text);
  if (headingMatch) {
    return {
      title: headingMatch[1].trim(),
      prose: text.slice(headingMatch.index + headingMatch[0].length).trim()
    };
  }
  return {
    title: titleCaseSlug(path9.basename(fileName, path9.extname(fileName))),
    prose: text.trim()
  };
}
function stripTitleHeading(text) {
  return text.replace(/^\s*#\s+[^\n]*\n?/, "");
}
function chapterMarkdown(title, number, words, prose) {
  return `${stringifyFrontmatter({
    title,
    number,
    pov: "",
    locations: [],
    characters: [],
    "arcs-advanced": [],
    status: "draft",
    "word-count": words
  })}# Chapter ${number}: ${title}

## Chapter Text

${prose}
`;
}

// src/cli.js
var HELP = `Usage: story <command> [options]

Commands:
  init <title>       Scaffold a story project
  import <source>    Split an existing manuscript into a new story project
  validate [path]    Check project structure, frontmatter, and registries
  reindex [path]     Rebuild registry tables from markdown files
  wordcount [path]   Count chapter prose words
  links [path]       Check cross-reference targets and backlinks
  continuity [path]  Check deterministic continuity contracts: deaths,
                    promises, questions, casts, and durable state
  state [path]       Show accepted narrative state; --chapter for a snapshot,
                    --character for one trajectory across the book
  knowledge [path]   Show character knowledge; --character to focus one
  know [path]        Record what a character knows about a fact
  candidate [path]   Scaffold a chapter candidate in work/chapters/
  candidates [path]  List candidates and whether their chapter is canon
  accept [path]      Accept a candidate: commit chapter, state, and transaction
  reject [path]      Reject a candidate without touching canon
  transaction [path] Show the acceptance transaction for a chapter
  context [path]     Build a POV-safe context projection for a chapter
  render-packet [path]
                    Build the compact prose-facing packet for a chapter
  seal-arc [path]    Freeze the current arc plan as a new sealed version
  simulate-arc [path]
                    Build the causal-simulation brief for an arc
  prose [path]       Report prose repetition signals; never fails a check
  report [path]      Summarize project inventory, progress, and checks
  next [path]        Recommend the next writing and maintenance actions
  doctor [path]      Show health checks plus actionable repair steps
  migrate [path]     Upgrade a project to the current schema
  add <kind> <name>  Create an entity file and reindex registries
  rename <kind> <id> <name>
                    Rename an entity and update id references
  remove <kind> <id>
                    Remove an entity and scrub id references
  export [path]      Combine chapters into a manuscript markdown file
  build [path]       Build a disposable book artifact in dist/

Options:
  --title <name>            Story title for import
  --dir <path>              Target directory for init or import
  --genre <name>            Story genre for init
  --sub-genre <name>        Story sub-genre for init
  --setting-era <name>      Setting era for init
  --theme <name>            Add a theme for init; repeatable
  --themes <a,b>            Add comma-separated themes for init
  --pov <style>             POV style for init
  --tense <tense>           Narrative tense for init
  --synopsis <text>         Starter synopsis for init
  --force                   Allow init to overwrite starter files
  --write                   Update chapter word-count frontmatter
  --path <path>             Target story root for add/rename/remove
  --out <file>              Output path for export/build
  --format <name>           Output format for build (markdown, epub, docx)
  --actionable              Include next actions in report
  --number <n>              Chapter number for add chapter
  --chapter <id>            Chapter id for add scene or continuity records
  --scene <n>               Scene number for add scene
  --type <name>             Entity type for add
  --role <name>             Character role for add character
  --status <name>           Entity status for add; epistemic status for know
                            (knows, believes, suspects, doubts, misbelieves,
                            unknown)
  --location <id>           Location reference for add
  --character <id>          Character reference for add; repeatable
  --member <id>             Faction member reference for add faction; repeatable
  --owner <id>              Owner reference for add artifact
  --arc <id>                Arc reference for add; repeatable
  --introduced <id>         Chapter id for add question
  --resolved <id>           Chapter id for add question
  --planted <id>            Chapter id for add promise
  --payoff <id>             Chapter id for add promise
  --category <name>         Category for add term
  --fact <id>               Fact id for know
  --learned-in <id>         Chapter id (or pre-story) for know
  --confidence <level>      Confidence for know: low, medium, high
  --source <text>           How the character learned it
  --notes <text>            Free-form note for know
  --truth-status <name>     Truth for add fact: true, false, ambiguous,
                            undetermined
  --established-in <id>     Chapter id (or pre-story) for add fact
  --tag <name>              Tag for add fact; repeatable
  --candidate <id>          Candidate id for accept/reject
  --pov <id>                POV character for context/render-packet
  --json                    Emit machine-readable JSON for context
  --write                   Write the render packet into work/chapters/
  --word-target <n>         Target word count for the render packet
  --arc <id>                Arc id for seal-arc
  --limit <n>               Max repeated phrases to report for prose
  --reason <text>           Rejection note for reject
  --title <name>            Chapter title for candidate
  --mention <id>            Mentioned character for candidate; repeatable
  --alias <name>            Alias for add term; repeatable
  -h, --help                Show this help

Option values that begin with a dash must use the --option=value form.
`;
function runCli(argv, io) {
  const parsed = parseArgs(argv);
  const cwd = io.cwd ?? process.cwd();
  const command = parsed.positionals[0];
  try {
    if (!command || command === "help" || parsed.options.help) {
      io.stdout.write(HELP);
      return 0;
    }
    if (command === "init") {
      const title = parsed.positionals.slice(1).join(" ");
      const result = createStoryProject({
        title,
        cwd,
        dir: parsed.options.dir,
        genre: parsed.options.genre,
        subGenre: parsed.options["sub-genre"],
        settingEra: parsed.options["setting-era"],
        themes: collectThemes(parsed.options),
        pov: parsed.options.pov,
        tense: parsed.options.tense,
        synopsis: parsed.options.synopsis,
        force: Boolean(parsed.options.force)
      });
      io.stdout.write(`Created story project: ${result.root}
`);
      return 0;
    }
    if (command === "import") {
      const result = importManuscript({
        source: parsed.positionals[1],
        title: parsed.options.title,
        cwd,
        dir: parsed.options.dir,
        genre: parsed.options.genre,
        subGenre: parsed.options["sub-genre"],
        settingEra: parsed.options["setting-era"],
        themes: collectThemes(parsed.options),
        pov: parsed.options.pov,
        tense: parsed.options.tense,
        synopsis: parsed.options.synopsis,
        force: Boolean(parsed.options.force)
      });
      io.stdout.write(`Imported ${result.chapters} chapters (${result.words} words) into ${result.root}
`);
      if (result.candidates.length > 0) {
        io.stdout.write(`Entity candidates (review, then create with story add):
`);
        for (const candidate of result.candidates) {
          io.stdout.write(`- ${candidate.name} (${candidate.count} mentions)
`);
        }
      }
      return 0;
    }
    const root = path10.resolve(cwd, parsed.positionals[1] ?? ".");
    if (command === "validate") {
      return reportResult(io, validateProject(root), "Project is valid", "Project validation failed");
    }
    if (command === "links") {
      return reportResult(io, validateLinks(root), "Links are valid", "Link check failed");
    }
    if (command === "continuity") {
      return reportResult(io, checkProjectContinuity(root), "Continuity is consistent", "Continuity check failed");
    }
    if (command === "state") {
      io.stdout.write(formatStateReport(stateReport(root, { chapter: parsed.options.chapter, character: parsed.options.character })));
      return 0;
    }
    if (command === "knowledge") {
      io.stdout.write(formatKnowledgeReport(knowledgeReport(root, { character: parsed.options.character })));
      return 0;
    }
    if (command === "know") {
      const result = recordKnowledge(root, parsed.options);
      io.stdout.write(`Recorded ${result.character} ${result.status} ${result.fact}
`);
      return 0;
    }
    if (command === "candidate") {
      const result = createCandidate(root, parsed.options);
      io.stdout.write(`Created ${result.candidate} for ${result.chapter}: ${result.file}` + `
`);
      return 0;
    }
    if (command === "candidates") {
      const result = listCandidates(root, { chapter: parsed.options.chapter });
      if (result.candidates.length === 0) {
        io.stdout.write("No candidates found" + `
`);
        return 0;
      }
      for (const candidate of result.candidates) {
        io.stdout.write(`${candidate.chapter} ${candidate.id} ${candidate.status} ${candidate.words} words${candidate.canonical ? " (chapter is canon)" : ""}` + `
`);
      }
      return 0;
    }
    if (command === "accept") {
      const result = acceptCandidate(root, parsed.options);
      io.stdout.write(`Accepted ${result.candidate} as ${result.chapter} (${result.stateBefore} -> ${result.stateAfter}, body ${result.bodyHash.slice(0, 12)})` + `
`);
      return 0;
    }
    if (command === "reject") {
      const result = rejectCandidate(root, parsed.options);
      io.stdout.write(`Rejected ${result.candidate} for ${result.chapter}; canon unchanged` + `
`);
      return 0;
    }
    if (command === "transaction") {
      io.stdout.write(`${JSON.stringify(readTransactionRecord(root, parsed.options), null, 2)}` + `
`);
      return 0;
    }
    if (command === "context") {
      const projection = contextProjection(root, parsed.options);
      io.stdout.write(parsed.options.json ? `${JSON.stringify(projection, null, 2)}` + `
` : formatContextProjection(projection));
      return 0;
    }
    if (command === "render-packet") {
      const result = renderPacket(root, parsed.options);
      io.stdout.write(result.file ? `Wrote render packet: ${result.file}` + `
` : `${JSON.stringify(result.packet, null, 2)}` + `
`);
      return 0;
    }
    if (command === "prose") {
      const report = proseDiagnostics(root, parsed.options);
      io.stdout.write(parsed.options.json ? `${JSON.stringify(report, null, 2)}` + `
` : formatProseReport(report));
      return 0;
    }
    if (command === "simulate-arc") {
      const result = arcSimulation(root, parsed.options);
      io.stdout.write(result.file ? `Wrote arc simulation brief: ${result.file}` + `
` : `${JSON.stringify(result.brief, null, 2)}` + `
`);
      return 0;
    }
    if (command === "seal-arc") {
      const result = sealArc(root, parsed.options);
      io.stdout.write(`Sealed ${result.arc} as ${result.id} (version ${result.version})` + `
`);
      return 0;
    }
    if (command === "report") {
      io.stdout.write(formatProjectReport(projectReport(root), { actionable: Boolean(parsed.options.actionable) }));
      return 0;
    }
    if (command === "next") {
      io.stdout.write(formatActionReport(projectActions(root)));
      return 0;
    }
    if (command === "doctor") {
      io.stdout.write(formatDoctorReport(projectActions(root)));
      return 0;
    }
    if (command === "migrate") {
      const result = migrateProject(root);
      io.stdout.write(result.changed.length === 0 ? `Project already uses the current schema
` : `Migrated project to current schema: ${result.changed.length} changes
`);
      return 0;
    }
    if (command === "add") {
      const result = createEntity(targetRoot(cwd, parsed), {
        ...parsed.options,
        kind: parsed.positionals[1],
        name: parsed.positionals.slice(2).join(" ")
      });
      io.stdout.write(`Created ${result.kind} ${result.id}: ${result.file}
`);
      return 0;
    }
    if (command === "rename") {
      const result = renameEntity(targetRoot(cwd, parsed), {
        ...parsed.options,
        kind: parsed.positionals[1],
        id: parsed.positionals[2],
        name: parsed.positionals.slice(3).join(" ")
      });
      io.stdout.write(`Renamed ${result.kind} ${result.oldId} to ${result.id}: ${result.file}
`);
      return 0;
    }
    if (command === "remove") {
      const result = removeEntity(targetRoot(cwd, parsed), {
        ...parsed.options,
        kind: parsed.positionals[1],
        id: parsed.positionals[2]
      });
      io.stdout.write(`Removed ${result.kind} ${result.id}: ${result.file}
`);
      return 0;
    }
    if (command === "reindex") {
      const result = reindexProject(root);
      io.stdout.write(result.changed.length === 0 ? `Registries already up to date
` : `Updated ${result.changed.length} registries
`);
      return 0;
    }
    if (command === "wordcount") {
      const result = computeWordCounts(root, { write: Boolean(parsed.options.write) });
      for (const chapter of result.chapters) {
        io.stdout.write(`${chapter.file}: ${chapter.wordCount}
`);
      }
      io.stdout.write(`Total: ${result.total}
`);
      return 0;
    }
    if (command === "export") {
      const result = exportManuscript(root, { out: parsed.options.out });
      io.stdout.write(`Exported ${result.chapters} chapters to ${result.outFile}
`);
      return 0;
    }
    if (command === "build") {
      const result = buildBook(root, {
        out: parsed.options.out,
        format: parsed.options.format
      });
      io.stdout.write(`Built ${result.chapters} chapters as ${result.format} to ${result.outFile}
`);
      return 0;
    }
    io.stderr.write(`Unknown command: ${command}

${HELP}`);
    return 1;
  } catch (error) {
    io.stderr.write(`${error.message}
`);
    return 1;
  }
}
function parseArgs(argv) {
  const positionals = [];
  const options = {};
  for (let index = 0;index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const equalIndex = arg.indexOf("=");
    const key = arg.slice(2, equalIndex === -1 ? undefined : equalIndex);
    const inlineValue = equalIndex === -1 ? undefined : arg.slice(equalIndex + 1);
    const nextValue = argv[index + 1];
    const hasSeparateValue = inlineValue === undefined && nextValue !== undefined && !nextValue.startsWith("-");
    const value = inlineValue ?? (hasSeparateValue ? nextValue : true);
    if (hasSeparateValue) {
      index += 1;
    }
    if (options[key] === undefined) {
      options[key] = value;
    } else {
      options[key] = Array.isArray(options[key]) ? options[key].concat(value) : [options[key], value];
    }
  }
  return { positionals, options };
}
function collectThemes(options) {
  return [].concat(options.theme ?? []).concat(options.themes ?? []).filter((value) => value !== undefined && value !== true);
}
function targetRoot(cwd, parsed) {
  return path10.resolve(cwd, parsed.options.path ?? ".");
}
function reportResult(io, result, successMessage, failureMessage) {
  const output = result.ok ? io.stdout : io.stderr;
  output.write(`${result.ok ? successMessage : failureMessage}: ${result.errors.length} errors, ${result.warnings.length} warnings
`);
  for (const error of result.errors) {
    io.stderr.write(`error: ${error}
`);
  }
  for (const warning of result.warnings) {
    output.write(`warning: ${warning}
`);
  }
  return result.ok ? 0 : 1;
}

// bin/story.js
process.exitCode = runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: process.stdout,
  stderr: process.stderr
});
