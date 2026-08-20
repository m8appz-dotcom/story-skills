# Migrating v2 to v3

```shell
story migrate .
story validate .
story continuity .
```

Migration is idempotent. Running it twice reports
`Project already uses the current schema`.

## What it does

- creates `continuity/facts/`, `continuity/knowledge/`,
  `continuity/relationships/`, and `continuity/state/` with their registries
- seeds `continuity/state/chapter-00.md`, the pre-story snapshot, and one
  **provisional** snapshot per existing chapter, with `current.md` pointing at
  the latest
- lifts every `knowledge-state` row from the v2 `continuity/state.md` into a
  fact plus a knowledge record
- sets `schema-version: 3`
- reindexes

## What it does not do

**It never invents story content.** This is the constraint everything else bends
around.

- prose is not touched — chapter files are byte-identical after migration, and a
  test asserts it
- characters, worldbuilding, arcs, promises, questions, the timeline, glossary,
  and existing continuity state are all preserved as-is
- no *state* is fabricated for chapters you already wrote: the seeded snapshots
  are empty and marked `provisional: true`
- a chapter reference that already does not resolve is not copied forward into
  the derived fact and knowledge records

## The knowledge lift

A v2 row like:

```yaml
knowledge-state:
  - character: robert
    knows: Robert killed Elizabeth
    learned-in: pre-story
```

becomes `continuity/facts/robert-killed-elizabeth.md`:

```yaml
type: fact
statement: Robert killed Elizabeth
truth-status: undetermined
established-in: pre-story
tags:
  - migrated
  - needs-review
```

plus `continuity/knowledge/robert.md` recording `status: knows`.

Two deliberate choices:

- The **statement keeps your exact wording.** The fact id is derived
  mechanically by kebab-casing it; the sentence itself is copied, not rewritten.
- `truth-status` is **`undetermined`**, not `true`. v2 recorded that a character
  believed something. It never recorded whether that belief was correct. Marking
  it `true` would be the migration inventing a fact about your world. The
  `needs-review` tag lists the ones waiting for your decision.

## Provisional snapshots

Snapshot sequences must be gapless, and acceptance requires a new chapter to
follow the latest sequence. A project migrating mid-draft therefore needs a
baseline, or the acceptance flow is unreachable — which would exclude exactly the
authors who most need it.

So migration seeds one snapshot per existing chapter:

```yaml
type: state-snapshot
chapter: chapter-03
sequence: 3
provisional: true
characters: []
```

`provisional: true` records that the snapshot was **reconstructed at migration,
not captured at acceptance**. `story state` says so:

```text
State chapter-03 (sequence 3, chapter chapter-03)
Provisional: reconstructed at migration, not captured at acceptance
History: 5 snapshot(s), 4 provisional
```

The seeded snapshots are **empty**, and that is the honest answer: v2 never
recorded per-chapter state, so the correct value is "unknown", not a guess. The
one exception is your v2 `continuity/state.md`, which *is* recorded data — its
`character-state` and `object-state` land on the latest chapter, because that is
what they described.

Fill in earlier snapshots by hand if you want them, or leave them empty. Either
way, the next chapter you accept produces a real, non-provisional snapshot that
carries the previous one forward.

### When migration will not seed

If your chapter numbering has a gap (1, 2, 5), migration seeds only the
pre-story snapshot. Seeding would produce a gap in sequences, which is an error
you should fix first. `story continuity` reports the numbering gap.

## The legacy state file

`continuity/state.md` still exists and still works. Once v3 snapshots are
present, its `current-chapter` becomes a **derived mirror** of the latest
snapshot, resynced by `reindex`. Its hand-written `character-state`,
`object-state`, and `knowledge-state` sections are left alone.

Snapshots are the source of truth in v3. The legacy file is kept so v2 habits
and tooling keep working, not as a second place to record state.

## Adopting v3 gradually

Nothing obliges you to use any of it. A short story can migrate and then never
create a fact, a knowledge record, or a candidate. The directories stay empty,
the checks stay quiet, and the CLI behaves as it did under v2.

Reach for the pieces when the book gets big enough to need them:

- **facts + knowledge** when a reveal depends on who knows what
- **state snapshots** when you need to answer "where was everyone at chapter 20"
- **candidates + transactions** when you want drafts that cannot corrupt canon
