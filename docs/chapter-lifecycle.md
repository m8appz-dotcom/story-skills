# Chapter Lifecycle

How one chapter moves from draft to canon, and what is guaranteed at each step.

The governing rule: **creative judgement is probabilistic, story state is
deterministic.** A model decides what happens in the scene. Code decides whether
the resulting state is allowed to become canon.

## The path

```text
candidate           work/chapters/chapter-02/candidate-001.md
    ↓  deterministic checks           story validate / links / continuity
    ↓  semantic review                LLM or human; recorded, not computed
    ↓  reject ─────────────────────→  nothing changes but the candidate
    ↓  accept
canon               chapters/chapter-02.md
state snapshot      continuity/state/chapter-02.md
transaction         transactions/chapter-02.json
```

## Candidate

`story candidate . --chapter chapter-02` scaffolds a draft under `work/`.

A candidate holds both the prose and the state changes it proposes: character
state, object state, relationship state, knowledge changes, promise and question
movements, story time, active threads.

While a candidate exists, **nothing else in the project has changed.** No
snapshot, no knowledge update, no timeline row, no promise resolved. This is
enforced by construction — acceptance is the only code path that writes canon —
and covered by tests that assert canon, state, knowledge, and timeline are
byte-identical after a candidate is created and after one is rejected.

You can have as many candidates per chapter as you want. Rewrites are cheap
precisely because they are inert.

## Deterministic checks

Run `story validate`, `story links`, and `story continuity`. These prove
mechanical things: files exist, references resolve, enums are legal, sequences
are ordered, hashes match, promises pay off after they are planted.

They cannot prove that a character behaved plausibly, that the prose is good, or
that a secret leaked between the lines. The system never claims otherwise.

## Semantic review

This is the LLM's job, and it is not mechanical:

- did a character act on knowledge they should not have?
- is the emotional continuity from the previous chapter believable?
- is the cause-and-effect earned?
- does the dialogue differentiate speakers?
- is the prose doing work, or filling space?

The verdict is recorded in the candidate's `review` field and copied into the
transaction. It is stored as testimony, never as a computed result.

## Rejection

```shell
story reject . --chapter chapter-02 --candidate candidate-001 --reason "Sarah reads omniscient"
```

Rejection writes exactly one file: the candidate itself, marked `rejected` with
the reason. A rejected candidate can never afterwards be accepted.

## Acceptance: two phases

`story accept . --chapter chapter-02 --candidate candidate-002`

### Phase A — plan, and refuse early

`planAcceptance` is a pure function. It validates everything and returns the
complete list of writes, or throws. It refuses when:

- the candidate is rejected
- the chapter is already canon
- the chapter does not follow the current state sequence (no skipping)
- any reference in the delta does not resolve
- a knowledge delta claims a character learned something in a different chapter
- an epistemic status or confidence value is not legal

Nothing has been written at this point. A failure here leaves the repository
untouched because no write was ever attempted.

### Phase B — commit, or roll back

The staged writes are applied together:

1. `chapters/chapter-02.md` — the prose becomes canon
2. `continuity/state/chapter-02.md` — a new snapshot, carrying the previous
   forward and applying the delta on top
3. `continuity/knowledge/*.md` — epistemic changes
4. promise and question records
5. `plot/timeline.md` — a new row
6. `transactions/chapter-02.json` — the record, including `body-sha256`
7. the candidate, marked `accepted`

Every target is captured before writing. If any write fails, the already-written
files are restored to their previous contents and newly created files are
removed, then the error is re-thrown. There is a test that blocks the
transaction write mid-commit and asserts canon, state, and knowledge are all
back where they started.

Then `reindex` regenerates the registries and repoints `current.md`.

## What acceptance guarantees

After a successful accept:

- the chapter is canon, and its prose hashes to the `body-sha256` in the
  transaction
- a snapshot exists at the right sequence, and **every earlier snapshot is
  byte-identical** to what it was before
- `current.md` names the accepted chapter
- knowledge, promises, questions, and the timeline reflect the delta and nothing
  more
- `story continuity` detects it later if anyone edits the accepted prose

## Human override

Every generated file is plain markdown and may be edited by hand. The engine
never repairs creative content silently. When a hand edit makes state
inconsistent, `story continuity` reports which dependent records need attention
and leaves the decision to the author.
