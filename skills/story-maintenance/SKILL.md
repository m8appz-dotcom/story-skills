---
name: story-maintenance
description: This skill should be used when the user asks to validate, reindex, repair registries, check links, check continuity, count words, summarize a story project, import an existing manuscript, export a manuscript, run the story CLI, or perform deterministic maintenance on a Story Skills markdown project.
---

# Story Maintenance

## Overview

Run deterministic maintenance for Story Skills projects. Use the CLI for structure validation, registry rebuilds, word counts, link checks, continuity checks, project reports, next-action reports, schema migration, entity helpers, manuscript import, and manuscript export. The creative skills still own story decisions; this skill handles mechanical consistency.

## CLI Access

Prefer the first available command:

1. `story <command>` - when the package bin is installed
2. `bun run story -- <command>` - when working from this repository
3. `node scripts/story.js <command>` - bundled fallback, resolving `scripts/story.js` relative to this skill folder

If none of these are available, perform the requested maintenance manually using the conventions in `story-init`.

Run the installed or bundled CLI in place. Do not copy `scripts/story.js` into the user's story project, and do not create project-local build scripts, generator scripts, or bulk writer scripts to generate story content. Story projects should remain markdown-first, plus explicitly requested exports such as `manuscript.md`.

## Commands

Run commands from the story project root, or pass the story path explicitly.

```shell
story validate .
story reindex .
story wordcount . --write
story links .
story continuity .
story import draft.md --title "Title"
story report .
story report . --actionable
story next .
story doctor .
story migrate .
story state .
story state . --chapter chapter-12
story knowledge . --character sarah
story know . --character sarah --fact the-rope-was-cut --status suspects --learned-in chapter-08
story context . --chapter chapter-12 --pov sarah
story render-packet . --chapter chapter-12 --pov sarah --write
story candidate . --chapter chapter-12 --title "Title" --pov sarah
story candidates .
story reject . --chapter chapter-12 --candidate candidate-001 --reason "..."
story accept . --chapter chapter-12 --candidate candidate-002
story transaction . --chapter chapter-12
story seal-arc . --arc the-drowning
story simulate-arc . --arc the-drowning
story prose .
story prose . --chapter chapter-12
story add character "Name"
story rename character old-id "New Name"
story remove promise old-promise
story export . --out manuscript.md
story build . --format markdown
story build . --format epub
story build . --format docx
```

Use:

- `validate` after initialization and at the end of any multi-file edit
- `reindex` after adding/removing/renaming characters, locations, systems, arcs, or chapters
- `wordcount --write` after writing or revising chapters
- `links` after changing character relationships, notable locations, arc participants, or chapter references
- `continuity` after drafting or revising a chapter, and whenever the user asks about contradictions, dead characters appearing, unfired setups, or stale state; it deterministically checks `died-in` ordering, promise/question chapter ordering, Chekhov gaps, POV/cast consistency, and `continuity/state.md` references
- `import` when the user has an existing manuscript or chapter drafts and wants a Story Skills project built from them; follow up by creating character and location files from the printed entity candidates
- `report` when the user asks for project status, inventory, progress, or a quick health summary
- `next` before a drafting session to identify the next deterministic action
- `doctor` when the user asks what is stale, broken, or inconsistent
- `migrate` when a project has an older schema version or missing v2 paths; v2
  to v3 is idempotent, preserves all prose, and never invents story content
- `state` to read the latest accepted narrative state, or a specific chapter
  snapshot; snapshots are append-only and earlier ones are never rewritten
- `knowledge` and `know` to inspect and record what a character knows, believes,
  suspects, doubts, or misbelieves about a canonical fact
- `context` to build the POV-safe projection before drafting; it excludes
  everything the POV character cannot hold and reports withheld counts without
  naming them
- `render-packet` to build the compact prose-facing brief from that projection
- `candidate`, `candidates`, `reject`, `accept`, and `transaction` for the
  chapter lifecycle; candidates cannot mutate canon, and acceptance commits the
  chapter, snapshot, knowledge, promises, and timeline as one transaction
- `seal-arc` to freeze the current arc plan as a new immutable version so chapter
  plans can name the arc version they derive from
- `simulate-arc` to build the deterministic brief for reasoning about what each
  character does across an arc, including offscreen
- `prose` for mechanical repetition signals during a line edit; it reports and
  never fails, and it judges nothing
- `add`, `rename`, and `remove` for deterministic entity file operations when they fit the requested change
- `export` only when the user asks for a combined manuscript at a specific path
- `build` when the user asks to build the book artifact; supports markdown, EPUB, and DOCX outputs in `dist/`

## Failure Handling

- Treat CLI errors as actionable maintenance findings.
- Fix broken references, missing required files, stale registries, or incorrect word counts when the requested task implies doing so.
- Do not overwrite creative prose or story content merely to satisfy a mechanical check.
- If a validation warning reflects intentional user data, report it rather than silently changing it.
- A `body-sha256 does not match` error means an accepted chapter was edited after
  acceptance. Report it; do not silently re-accept or rewrite the transaction.
  Reconciling it is a deliberate authoring decision.
- A canonical chapter with no state snapshot is a warning, not a defect. Authors
  may legitimately write outside the acceptance flow.

## What the CLI Does Not Judge

The CLI proves structure: references resolve, enums are legal, sequences are
ordered, hashes match. It cannot judge whether prose semantically leaks
knowledge, whether a character behaved plausibly, or whether the writing is any
good. Never report a deterministic check as covering those. That boundary is
documented in `docs/architecture-v3.md`.
