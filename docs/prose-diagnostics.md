# Prose Diagnostics

```shell
story prose .
story prose . --chapter chapter-07
story prose . --json --limit 20
```

## What these are

Signals to look at. Nothing more.

`story prose` locates patterns in the text: phrases that repeat, sentences that
open the same way, runs of identical rhythm, chapters that end alike. It does not
know whether any of them is a problem. **Repetition is frequently the point** —
a refrain, a tic that characterises someone, a deliberate echo across a book.

The command never fails. It does not participate in `validate`, `links`, or
`continuity`, and it cannot gate acceptance. A diagnostic that could block a
chapter would eventually be optimised against, and optimising prose against a
counter makes it worse.

## What it reports

| Signal | What it counts |
|---|---|
| repeated phrases | word sequences of 5+ occurring more than once, within a chapter and across chapters |
| opening runs | 3+ consecutive sentences starting with the same word |
| length runs | 4+ consecutive sentences whose lengths all sit within a 5-word band |
| shape runs | 4+ consecutive paragraphs with the same sentence count |
| ending echoes | chapters whose final sentences begin with the same three words |
| dialogue | line count, share of words, mean line length, question and contraction rates |

Repeated phrases report the **longest** repeating form, not every sub-phrase
inside it, so one repetition appears once rather than eight times.

There is no stopword list. Five words is long enough that ordinary function-word
runs rarely trip the detector, and introducing a word list would be the first
step toward the thing this deliberately is not.

## What it deliberately does not do

Each of these was considered and rejected, for a reason:

- **"AI word" blacklists.** Arbitrary. Optimising against them produces prose
  that is worse and still detectable.
- **Perplexity or burstiness as a quality proxy.** They are not one.
- **Cliché density.** Requires a cliché list, which is a word blacklist wearing
  a different hat. Whether a familiar phrase is lazy or load-bearing depends
  entirely on context.
- **Over-explanation, excessive abstraction, duplicated emotional beats,
  exposition-heavy dialogue.** All real failure modes. None of them countable.
- **Per-speaker dialogue voice convergence.** Attributing lines to speakers needs
  reliable dialogue-tag parsing, which does not exist here. Claiming to measure
  voice convergence without knowing who is speaking would be a lie in a report.
  Aggregate dialogue statistics are given instead, and the per-speaker judgement
  is left to a reader.

## Reading a report

```text
chapter-01: 150 words, 14 sentences, 7 paragraphs
  repeated x2: "the tide had taken the lower steps again"
  3 sentences in a row open with "the" (from sentence 2)
  4 sentences in a row open with "he" (from sentence 9)
  4 sentences in a row of 5-9 words (from sentence 10)
  4 paragraphs in a row of 1 sentence(s) (from paragraph 2)
  dialogue: 3 lines, 8% of words, 4 words per line
```

Every finding names a location, so you can go and look. That is the whole
interaction model: the tool points, you decide.

Some of the findings above are probably intentional. The four `he` sentences may
be a deliberate hammering rhythm. The repeated tide line may be a refrain. The
report says what is there, not what it means.

## Where this sits

Prose diagnostics are **secondary to narrative architecture**, and they are last
in the system for that reason. A chapter with perfect sentence variety that
contradicts canon is worse than a repetitive one that does not.

The real prose review — whether the writing is doing work, whether the dialogue
differentiates speakers, whether the emotional logic holds — is a semantic task
for a reader or an LLM reviewer. These counters exist to catch the mechanical
tics that are tedious for a human to spot and trivial for a machine, and to stay
out of the way otherwise.
