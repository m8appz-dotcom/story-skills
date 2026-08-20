# Architecture v3

## The governing idea

Creative judgement is probabilistic. Story state and mechanical continuity are
deterministic wherever they can be.

Everything in v3 follows from taking that split seriously. Code owns what can be
proven; models and humans own what must be judged. Neither is allowed to
impersonate the other — the CLI never claims a semantic result, and a model
never writes canon without passing a mechanical gate.

## Module map

```text
bin/story.js
    └── src/cli.js              argv + io -> exit code, no filesystem of its own

src/story.js                    scan, validate, generate, and the write-side API
    ├── src/project-io.js       THE filesystem boundary: guards, read, write
    ├── src/frontmatter.js      the YAML subset, now with nested mappings
    ├── src/markdown.js         prose extraction, word counting, slugs
    ├── src/continuity.js       v2 contracts: deaths, promises, questions, casts
    ├── src/epistemic.js        facts + character knowledge
    ├── src/state.js            snapshot ordering, current-state resolution
    ├── src/relationships.js    relationship records
    ├── src/arcs.js             arc plans, hard constraints, causal chains
    ├── src/arc-simulation.js   the deterministic brief a model simulates from
    ├── src/transactions.js     candidate acceptance planning and integrity
    ├── src/projection.js       POV-safe context filtering
    ├── src/render-packet.js    the compact, prose-facing brief
    └── src/v3-templates.js     pure file-content builders
```

`projection.js` and `render-packet.js` are both pure functions of a scanned
project, so the exclusion guarantees are testable without touching disk. The
render packet is built *from* the projection rather than from canon, which is
what makes "the packet cannot contain what the projection excluded" a structural
property instead of a second filter that has to be kept in sync.

## Three invariants worth protecting

These predate v3 and were preserved rather than replaced.

### 1. Validators are pure functions of a scanned project

`checkContinuity(project)`, `checkEpistemicGraph(project)`,
`checkStateSnapshots(project)`, `checkRelationships(project)`, and
`checkTransactions(project)` all take an already-scanned project and touch no
files. `scanProject` is the only reader.

This is why the checks are cheap to test: build a project shape, call the
function, assert on the errors.

### 2. Every check returns the same shape

```js
{ ok: boolean, errors: string[], warnings: string[] }
```

`errors` fail the command; `warnings` inform. `mergeChecks` composes them, and
`reportResult` in the CLI renders any of them without knowing which check ran.

The errors/warnings split carries real meaning: **an error is something that
cannot be true of a coherent story.** A warning is something an author might
have done deliberately. "A snapshot exists for a chapter that is not canon" is
an error. "A canonical chapter has no snapshot" is a warning, because writing
outside the acceptance flow is a legitimate choice.

### 3. One filesystem boundary

`src/project-io.js` holds the symlink and traversal guards. Every read and write
routes through it, so a new feature cannot accidentally escape the project root.
v3 extracted this from `story.js` precisely so the new modules could not grow
their own unguarded I/O.

## Two-phase state update

The most important structural decision in v3.

```text
Phase A   planAcceptance(project, options)     pure; returns writes or throws
Phase B   commitWrites(root, writes)           applies all, or rolls back all
```

Phase A decides every byte before any byte is written. Validation failures cost
nothing because no write was attempted. Phase B captures each target's previous
contents, applies the writes, and on any failure restores what it changed and
deletes what it created.

This is what makes "a rejected draft cannot mutate canon" a structural property
rather than a promise. There is no code path from a candidate to canon that
skips Phase A.

## Truth, belief, and the boundary the CLI will not cross

```text
WORLD TRUTH        continuity/facts/         what is actually so
CHARACTER BELIEF   continuity/knowledge/     what each character holds
POV CONTEXT        (projection layer)        what a model may see to write
READER KNOWLEDGE   snapshot field            what the audience has been told
```

Deterministic code can prove that Sarah's knowledge record references a real
fact, that she did not learn it in a chapter that has not happened yet, and that
she is not simultaneously recorded as knowing and not knowing it.

Deterministic code **cannot** prove that the prose of chapter 12 does not let
Sarah behave as though she knows. That requires reading for meaning. The system
documents this boundary rather than blurring it, because a continuity checker
that quietly claimed semantic coverage would be worse than none — you would stop
looking.

## Progressive activation

v3 directories are validated only when they exist. `readEntityFiles` returns an
empty array for a missing directory, so a v2 project scans as "zero facts"
rather than "broken". A short story never has to configure an epistemic graph.

`REQUIRED_PATHS` was deliberately **not** extended with v3 paths. Doing so would
have made every existing project fail `validate` on upgrade.

## Provenance

```text
plan version → render packet version → candidate → transaction → snapshot
```

Transactions record the candidate file, plan version, render packet version, the
prose hash, the snapshot before and after, and every delta. The hash covers
prose only, so routine frontmatter maintenance does not read as tampering while
an edit to accepted prose still does.

## Deliberately not built

- no database, no vector store, no queue, no agent framework
- no provider names in the schema — nothing references Claude or any model
- no AI-detector heuristics or banned-word lists

The interfaces are shaped so retrieval could be added later — context selection
is a function over a scanned project — but v3 ships as files and a CLI.

## Status

Implemented and tested: schema v3 parsing and validation, facts, knowledge,
relationships, versioned snapshots, migration, candidates, acceptance
transactions, atomic commit, POV context projection, arc plans with hard
constraints, sealed arc versions, and compact render packets.

Also implemented: arc-level causal simulation and the agent skill prompts, which
now describe the v3 workflow and are held to the CLI by a contract test.

Layered context is implemented as deterministic selection over a scanned
project; no retrieval or embedding layer exists, and the interfaces are shaped so
one could be added without changing callers.

Not implemented: prose-quality diagnostics (repeated phrasing, dialogue voice
convergence, cliche density), which the specification marks secondary to
narrative architecture. Semantic review is *recorded* by the system, never
performed by it.

## Where the split falls, concretely

Arc simulation is the clearest illustration of the governing idea. Deciding what
a character would plausibly do across eight chapters, including offscreen, is
creative judgement and belongs to a model. Two things around it do not:

- **assembling the inputs** — each character is briefed from their own position
  in the epistemic graph, so an antagonist is never accidentally briefed on what
  the protagonist knows
- **checking the output** — a simulated step whose `learns` fact is withheld by a
  hard constraint until a later chapter is a mechanical contradiction, caught in
  the plan rather than three chapters into the prose

Neither of those is a judgement call, so neither is left to one.
