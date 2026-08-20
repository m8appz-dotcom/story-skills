import { describe, expect, test } from "bun:test";
import { analyzeProse, formatProseReport } from "../src/prose-diagnostics.js";

function analyze(text, options = {}) {
  return analyzeProse([{ id: "chapter-01", text }], options).chapters[0];
}

describe("repeated phrases", () => {
  test("finds a phrase repeated within a chapter", () => {
    const text = [
      "She looked out of the corner of her eye at the door.",
      "The rain kept on against the glass.",
      "He watched her out of the corner of her eye and said nothing."
    ].join(" ");

    const phrases = analyze(text)["repeated-phrases"];
    expect(phrases.length).toBeGreaterThan(0);
    expect(phrases[0].phrase).toContain("out of the corner of her");
    expect(phrases[0].count).toBe(2);
  });

  test("ignores a phrase that appears only once", () => {
    const text = "She looked out of the corner of her eye at the door. The rain kept on.";
    expect(analyze(text)["repeated-phrases"]).toEqual([]);
  });

  test("reports the longest form once instead of every sub-phrase", () => {
    const text = [
      "He set the lantern down on the cold stone step.",
      "Later he set the lantern down on the cold stone step again."
    ].join(" ");

    const phrases = analyze(text)["repeated-phrases"];
    // The 5-, 6-, 7- and 8-word windows all repeat; only the longest is kept.
    expect(phrases).toHaveLength(1);
    expect(phrases[0].phrase).toBe("he set the lantern down on the cold stone step");
  });

  test("needs no stopword list, because five words of function words are rare", () => {
    const text = "He went to the door. She came from the window. They sat by the fire.";
    expect(analyze(text)["repeated-phrases"]).toEqual([]);
  });

  test("finds a phrase repeated across chapters", () => {
    const report = analyzeProse([
      { id: "chapter-01", text: "The tide had taken the lower steps again that morning." },
      { id: "chapter-02", text: "By dusk the tide had taken the lower steps again." }
    ]);

    const cross = report["cross-chapter"]["repeated-phrases"];
    // One finding, not one per overlapping window.
    expect(cross).toHaveLength(1);
    expect(cross[0].phrase).toContain("the tide had taken the lower steps again");
    expect(cross[0].chapters).toEqual(["chapter-01", "chapter-02"]);
  });
});

describe("sentence and paragraph shape", () => {
  test("finds consecutive sentences opening with the same word", () => {
    const text = [
      "She opened the ledger.",
      "She counted the pages.",
      "She closed it again.",
      "The rain kept on."
    ].join(" ");

    const runs = analyze(text)["opening-runs"];
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ word: "she", length: 3, "starts-at-sentence": 1 });
  });

  test("does not flag two sentences opening alike", () => {
    const text = "She opened the ledger. She closed it. The rain kept on and the night got colder.";
    expect(analyze(text)["opening-runs"]).toEqual([]);
  });

  test("finds a run of sentences all about the same length", () => {
    const text = [
      "The room was cold and quiet now.",
      "The lamp had burned down to nothing.",
      "The door stayed shut against the wind.",
      "The clock had stopped at half past.",
      "He waited a long time in that cold unlit room before he finally decided that nobody at all was coming for him tonight."
    ].join(" ");

    const runs = analyze(text)["length-runs"];
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ length: 4, "starts-at-sentence": 1 });
    // The band is what makes this a finding: report it only if it is narrow.
    const [low, high] = runs[0]["word-range"];
    expect(high - low).toBeLessThanOrEqual(5);
  });

  test("finds consecutive paragraphs of identical sentence count", () => {
    const paragraph = "He waited. She did not come.";
    const text = [paragraph, paragraph, paragraph, paragraph].join("\n\n");

    const runs = analyze(text)["shape-runs"];
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ length: 4, "sentences-each": 2 });
  });

  test("ignores headings and scene breaks when counting paragraphs", () => {
    const text = "## Chapter Text\n\nHe waited.\n\n---\n\nShe did not come.";
    expect(analyze(text).paragraphs).toBe(2);
  });
});

describe("chapter endings", () => {
  test("reports chapters that end the same shape", () => {
    const report = analyzeProse([
      { id: "chapter-01", text: "The night went on. And then he knew that it was over." },
      { id: "chapter-02", text: "She left the room. And then he knew he had lost her." },
      { id: "chapter-03", text: "The bell rang twice across the water." }
    ]);

    const echoes = report["cross-chapter"]["ending-echoes"];
    expect(echoes.echoes).toHaveLength(1);
    expect(echoes.echoes[0].chapters).toEqual(["chapter-01", "chapter-02"]);
    expect(echoes.echoes[0]["shared-opening"]).toBe("and then he");
    expect(echoes.endings).toHaveLength(3);
  });
});

describe("dialogue statistics", () => {
  test("measures dialogue in aggregate", () => {
    const text = [
      '"Where were you?" she said.',
      'He shrugged and looked at the floor for a while.',
      '"Out," he said. "It does not matter now."'
    ].join(" ");

    const dialogue = analyze(text).dialogue;
    expect(dialogue.lines).toBe(3);
    expect(dialogue["question-rate"]).toBeCloseTo(0.33, 1);
    expect(dialogue["share-of-words"]).toBeGreaterThan(0);
  });

  test("says plainly that per-speaker voice is not measured here", () => {
    const dialogue = analyze('"Yes," he said.').dialogue;
    expect(dialogue.note).toContain("Per-speaker voice convergence needs a reader");
  });

  test("reports zeroes rather than dividing by zero on narration-only prose", () => {
    const dialogue = analyze("The room stayed empty until morning.").dialogue;
    expect(dialogue).toMatchObject({ lines: 0, "share-of-words": 0, "mean-line-words": 0 });
  });
});

describe("reporting contract", () => {
  test("states that these are signals rather than a judgement", () => {
    const report = analyzeProse([{ id: "chapter-01", text: "He waited." }]);
    expect(report.note).toContain("not a quality judgement");
    expect(formatProseReport(report)).toContain("not a quality judgement");
  });

  test("finds nothing to report in varied prose", () => {
    const text = [
      "The tide came in slowly that evening, and the boats knocked together at their moorings.",
      "Jonas counted them twice.",
      "Somewhere behind him a door opened and did not close again, and he decided not to turn around, because turning around would mean admitting he had heard it.",
      "Rain.",
      "By the time he reached the mill row the light had gone entirely."
    ].join(" ");

    const chapter = analyze(text);
    expect(chapter["repeated-phrases"]).toEqual([]);
    expect(chapter["opening-runs"]).toEqual([]);
    expect(chapter["shape-runs"]).toEqual([]);
    // Sentence lengths here run 1 to 30 words, so nothing sits inside the band.
    expect(chapter["length-runs"]).toEqual([]);
  });

  test("honours the reporting limit", () => {
    const repeated = Array.from({ length: 8 }, (_, index) =>
      `The number ${index} was carved into the beam. The number ${index} was carved into the beam.`
    ).join(" ");

    expect(analyze(repeated, { limit: 3 })["repeated-phrases"].length).toBeLessThanOrEqual(3);
  });
});
