// Feature 22: prose diagnostics.
//
// These are SIGNALS, not scores. Every finding here is something a human or an
// LLM reviewer should look at, and none of it is evidence that prose is bad.
// Repetition is sometimes the point. A run of short sentences is sometimes the
// point. The diagnostics locate patterns; judging them is not mechanical.
//
// Deliberately NOT implemented, because doing so honestly is impossible:
//
//   - "AI word" blacklists. Arbitrary, and optimising against them makes prose
//     worse, not better.
//   - perplexity or burstiness as a quality proxy. It is not one.
//   - cliche density. It would require a cliche list, which is the same mistake
//     as a word blacklist wearing a different hat.
//   - over-explanation, excessive abstraction, duplicated emotional beats,
//     exposition-heavy dialogue. All real problems, none of them countable.
//   - per-speaker dialogue voice convergence. Attributing speech to speakers
//     needs reliable dialogue-tag parsing, which does not exist here. Aggregate
//     dialogue statistics are reported instead, and the per-speaker judgement is
//     left where it belongs.
//
// Nothing in this module gates anything. It never fails a check.

const MIN_PHRASE_WORDS = 5;
const MAX_PHRASE_WORDS = 12;
const MIN_OPENING_RUN = 3;
const MIN_SHAPE_RUN = 4;
const LENGTH_BAND = 5;
const MIN_LENGTH_RUN = 4;

export function analyzeProse(chapters, options = {}) {
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

// --- repeated phrases -------------------------------------------------------

// Word sequences of five or more that occur more than once. Five is long enough
// that ordinary function-word runs rarely trip it, which is why no stopword list
// is needed: introducing one would be the first step toward a blacklist.
function repeatedPhrases(text, limit) {
  return rankPhrases(collectPhrases(normalizeWords(text)), limit)
    .map(({ phrase, count }) => ({ phrase, count }));
}

function crossChapterPhrases(chapters, limit) {
  const seen = new Map();

  for (const chapter of chapters) {
    const words = normalizeWords(chapter.text);
    for (const [phrase, positions] of collectPhrases(words)) {
      const entry = seen.get(phrase) ?? { count: 0, chapters: new Set() };
      entry.count += positions;
      entry.chapters.add(chapter.id);
      seen.set(phrase, entry);
    }
  }

  const shared = [...seen.entries()]
    .filter(([, entry]) => entry.chapters.size > 1)
    .map(([phrase, entry]) => ({ phrase, count: entry.count, chapters: [...entry.chapters] }))
    .sort((left, right) => right.phrase.length - left.phrase.length || right.count - left.count);

  // Same collapse as within a chapter: report the longest repeating form once,
  // not every shorter window inside it.
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
  const counts = new Map();

  for (let size = MIN_PHRASE_WORDS; size <= MAX_PHRASE_WORDS; size += 1) {
    for (let index = 0; index + size <= words.length; index += 1) {
      const phrase = words.slice(index, index + size).join(" ");
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }

  return counts;
}

// Keep the longest form of any repeated run and drop the shorter phrases
// contained inside it, so one repetition is reported once rather than eight times.
function rankPhrases(counts, limit) {
  const repeated = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([phrase, count]) => ({ phrase, count }))
    .sort((left, right) => right.phrase.length - left.phrase.length || right.count - left.count);

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

// --- sentence and paragraph shape -------------------------------------------

// Consecutive sentences opening with the same word. Three in a row is usually
// visible on the page.
function openingRuns(sentences) {
  const runs = [];
  let start = 0;

  for (let index = 1; index <= sentences.length; index += 1) {
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

// Runs of consecutive sentences whose lengths all sit inside a narrow band --
// the mechanical shadow of monotonous rhythm.
function lengthRuns(sentences) {
  const lengths = sentences.map((sentence) => countWords(sentence));
  const runs = [];
  let start = 0;

  while (start < lengths.length) {
    // Extend while every sentence in the window stays inside the band.
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

// Consecutive paragraphs built from the same number of sentences.
function shapeRuns(paragraphs) {
  const shapes = paragraphs.map((paragraph) => splitSentences(paragraph).length);
  const runs = [];
  let start = 0;

  for (let index = 1; index <= shapes.length; index += 1) {
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

// --- chapter endings --------------------------------------------------------

// Chapters that end the same shape. Reported as pairs so the author can compare
// them directly rather than trusting a similarity number.
function endingEchoes(chapters) {
  const endings = chapters.map((chapter) => {
    const sentences = splitSentences(chapter.text);
    const last = sentences[sentences.length - 1] ?? "";
    return { chapter: chapter.id, sentence: last.trim(), opening: normalizeWords(last).slice(0, 3).join(" ") };
  });

  const echoes = [];

  for (let left = 0; left < endings.length; left += 1) {
    for (let right = left + 1; right < endings.length; right += 1) {
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

// --- dialogue ---------------------------------------------------------------

// Aggregate only. Attributing lines to speakers is not reliable without dialogue
// markup, so per-speaker voice convergence is left to a reviewer who can read.
function dialogueStats(text, sentences) {
  const lines = [...text.matchAll(/[""]([^""]{2,})[""]|"([^"]{2,})"/g)]
    .map((match) => (match[1] ?? match[2] ?? "").trim())
    .filter(Boolean);

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

// --- text utilities ---------------------------------------------------------

function splitParagraphs(text) {
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "" && !/^#{1,6}\s/.test(paragraph) && !/^[*_-]{3,}$/.test(paragraph));
}

function splitSentences(text) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])["""']?\s+(?=[A-Z"""'])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "" && !/^#{1,6}\s/.test(sentence));
}

function normalizeWords(text) {
  return (text.toLowerCase().match(/[a-z0-9]+(?:[''][a-z]+)?/g) ?? []);
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

// --- reporting --------------------------------------------------------------

export function formatProseReport(report) {
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
