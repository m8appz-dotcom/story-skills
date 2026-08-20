# Story Skills Schema v3

Schema v3 keeps everything that makes v2 work — markdown files, YAML frontmatter,
deterministic CLI validation, no database — and adds the state architecture a
book-length draft needs: versioned state, an explicit knowledge graph, and
chapters that become canon only through a recorded transaction.

v3 is **progressive**. A short story can ignore every new directory and keep
working exactly as it did under v2. Features activate when their directory
exists.

## Compatibility

- `story.md` declares `schema-version: 3`. Projects declaring `2` remain valid.
- `story migrate .` upgrades a v2 project in place and is idempotent.
- v3 directories are validated only when present, so nothing is forced on a
  project that does not want it.

## Layout

New in v3, all under `continuity/`:

```text
continuity/
    state.md                  legacy v2 state; current-chapter now mirrors snapshots
    facts/
        _index.md
        <fact-id>.md          objective world truth
    knowledge/
        _index.md
        <character-id>.md     what one character knows about those facts
    relationships/
        _index.md
        <a>-<b>.md            qualitative relationship state
    state/
        _index.md
        chapter-00.md         pre-story snapshot
        chapter-01.md         one immutable snapshot per accepted chapter
        current.md            generated pointer at the latest snapshot

work/
    chapters/<chapter-id>/
        candidate-001.md      drafts; never canon

transactions/
    chapter-01.json           the record of one acceptance
```

## The four boundaries

v3 exists to keep these four things separate. Collapsing any pair of them is how
long drafts go wrong.

```text
WORLD TRUTH   ≠   CHARACTER BELIEF   ≠   POV CONTEXT   ≠   READER KNOWLEDGE
```

- **World truth** lives in `continuity/facts/`. It is true whether or not anyone
  in the story knows it.
- **Character belief** lives in `continuity/knowledge/`. Six states, per
  character, per fact.
- **POV context** is what a prose model may see when writing a given scene.
- **Reader knowledge** is what the audience has been told, tracked per snapshot
  in `reader-knowledge`.

And:

```text
CANDIDATE   ≠   CANON
```

A candidate is a draft in `work/`. It has no effect on state, knowledge,
promises, questions, or the timeline. Only `story accept` moves it to canon, and
only then as a single recorded transaction.

## Facts

`continuity/facts/<id>.md` — objective truth.

```yaml
type: fact
id: robert-killed-elizabeth
statement: Robert killed Elizabeth
truth-status: true          # true | false | ambiguous | undetermined
established-in: pre-story   # chapter id, or pre-story
resolved-in: ""             # chapter where it becomes known to the reader
tags: []
```

`truth-status` is deliberately not a boolean: a mystery often needs a fact whose
truth is `ambiguous` on purpose, and migration marks derived facts
`undetermined` rather than guessing.

Chapter-shaped fields accept the sentinel `pre-story` for anything true before
chapter one opens.

## Knowledge

`continuity/knowledge/<character-id>.md` — one record per character, listing that
character's relation to any fact.

```yaml
type: knowledge-record
character: sarah
facts:
  - fact: robert-killed-elizabeth
    status: suspects        # knows | believes | suspects | doubts | misbelieves | unknown
    learned-in: chapter-08
    confidence: medium      # low | medium | high
    source: the coiled rope
```

One file per character rather than one per (character, fact) pair: the question
you actually ask while drafting is "what does Sarah know right now", and that
should be one file read, not a directory scan.

### What the CLI can and cannot check

Deterministic, and enforced:

- the character, fact, and chapter all exist
- `status` and `confidence` are legal values
- `learned-in` is not ahead of the latest accepted state snapshot
- `status: unknown` does not also claim a `learned-in`
- the same fact is not listed twice with conflicting statuses

**Not** deterministic, and never claimed to be: whether the prose lets a
character act on knowledge they should not have. That is a semantic judgement
and belongs to an LLM reviewer or a human. The CLI proves structure; it does not
read for meaning.

## Relationships

`continuity/relationships/<sorted-participants>.md`.

```yaml
type: relationship
id: robert-sarah
participants:
  - robert
  - sarah
state:
  trust: low
  affection: none
  resentment: high
  dependency: medium
public-status: niece and uncle
private-status: she has started counting his lies
last-major-change: chapter-08
```

Values are author-defined words, not scores. The id is derived from the sorted
participants so the same pair cannot be filed twice under two different titles.

## State snapshots

`continuity/state/chapter-NN.md` — one per accepted chapter, append-only.

```yaml
type: state-snapshot
chapter: chapter-01
sequence: 1
provisional: false
story-time:
  date: "1891-04-02"
  time: dusk
  elapsed: "1 day"
characters:
  - id: sarah
    location: harbor-house
    physical: soaked
    emotional: suspicious
    current-goal: find out what Robert is hiding
objects:
  - id: silver-key
    status: active
    owner: sarah
relationships:
  - id: robert-sarah
    trust: low
active-threads:
  - sarah-suspects-robert
reader-knowledge: []
```

Rules the CLI enforces:

- `sequence` starts at 0 and increases by exactly one — gaps and duplicates are
  errors
- `sequence` matches the chapter number
- a snapshot may only exist for a chapter that is already canon
- `chapter-00` is the pre-story snapshot and names no chapter
- `current.md` must point at the highest snapshot
- a canonical chapter with no snapshot is a **warning**, not an error, because
  authors may legitimately write outside the acceptance flow

Snapshots are never rewritten. Accepting chapter 12 does not touch chapter 11.

## Arc plans

`plot/arcs/<id>.md` gains a plan spanning roughly 3-8 chapters. Three kinds of
statement, kept apart on purpose:

```yaml
chapters: [chapter-05, chapter-06, chapter-07, chapter-08]
plan-version: 2
sealed-version: the-drowning-v2
dramatic-objective: Sarah moves from grief to suspicion
starting-state: Sarah trusts her uncle completely
target-end-state: Sarah has begun counting his lies

hard-constraints:
  - constraint: Sarah must not learn the truth yet
    kind: knowledge        # knowledge | possession | location | reveal | survival | other
    character: sarah
    fact: robert-drowned-elizabeth
    until: chapter-08

required-setups: []
required-payoffs: []
soft-possibilities: []

arc-characters:
  - id: robert
    goal: keep the inquest closed
    pressure: the surveyor is asking about the rope
    resources: the harbor office
    likely-actions: move the ledger before the audit
    offscreen-actions: visits the boatyard between chapter-06 and chapter-07

causal-chain:
  - step: 1
    chapter: chapter-05
    character: sarah
    cause: Sarah finds the second rope coiled wrong
    effect: she starts noticing what her uncle is careful about
    learns: ""             # name a fact here and the constraint checker verifies it
```

- **hard-constraints** must not be violated. `until` normally names a chapter
  that does not exist yet, which is expected and reported as a warning.
- **soft-possibilities** are available to the prose model, never mandatory.
- **causal-chain** is an ordered sequence. Steps must increase, stay inside the
  arc, and resolve their references. A step whose `learns` fact is withheld by a
  hard constraint until a later chapter is an **error**.

### Sealed plans

`story seal-arc .` freezes the current plan as `plot/arcs/sealed/<id>-v<N>.md`
and stamps the arc with `plan-version` and `sealed-version`. Sealed plans are
never edited in place; sealing again produces the next version, and earlier
versions stay byte-identical. That is what lets a chapter plan name the exact arc
version it derives from.

### Simulation

`story simulate-arc . --arc <id>` builds the deterministic brief a model
simulates from: per character, their goal and pressure, and their knowledge at
the arc's opening taken from the epistemic graph rather than from recall.

The simulation itself is creative judgement. The brief is its input, and the
causal-chain checks are applied to its output.

## Chapter candidates

`work/chapters/<chapter-id>/candidate-NNN.md` carries the prose plus the deltas
it proposes:

```yaml
type: chapter-candidate
chapter: chapter-01
candidate: candidate-001
title: The Tide Line
number: 1
status: pending             # pending | accepted | rejected
pov: sarah
state-characters: []        # proposed state delta
state-objects: []
state-relationships: []
knowledge-delta: []         # {character, fact, status, learned-in, confidence}
promise-delta: []           # {promise, status, planted, payoff}
question-delta: []          # {question, status, introduced, resolved}
```

## Transactions

`transactions/<chapter-id>.json` records one acceptance: the candidate it came
from, a `body-sha256` of the committed prose, the snapshot before and after, and
every delta applied.

The hash covers **prose only**, not frontmatter. `reindex` and `wordcount`
rewrite frontmatter as routine maintenance; hashing the whole file would make
every maintenance run look like tampering. Editing the prose of an accepted
chapter is caught by `story continuity`.

## Frontmatter dialect

v3 adds one level of nested block mapping to the frontmatter parser:

```yaml
story-time:
  date: "1891-04-02"
  time: dusk
```

Collections stay lists-of-objects, exactly as in v2. Nesting deeper than one
level is refused at serialization time rather than silently flattened.

## Commands

```shell
story migrate .                                   # v2 -> v3, idempotent
story state .                                     # latest accepted state
story state . --chapter chapter-12
story knowledge . --character sarah
story know . --character sarah --fact <id> --status suspects --learned-in chapter-08
story candidate . --chapter chapter-02            # scaffold a draft
story candidates .
story reject . --chapter chapter-02 --candidate candidate-001 --reason "..."
story accept . --chapter chapter-02 --candidate candidate-002
story transaction . --chapter chapter-02
story seal-arc . --arc the-drowning              # freeze the plan as a new version
story simulate-arc . --arc the-drowning          # deterministic simulation brief
```
