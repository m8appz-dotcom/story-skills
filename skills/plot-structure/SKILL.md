---
name: plot-structure
description: This skill should be used when the user asks to "create a plot arc", "story structure", "add a plot point", "story timeline", "track foreshadowing", "pacing", "act structure", "story arc", "plot outline", or wants to plan and manage the narrative structure of a story.
---

# Plot Structure

## Overview

Plan and manage story arcs, plot points, foreshadowing, and narrative timeline. Each arc is a markdown file in `plot/arcs/` with a chronological timeline maintained in `plot/timeline.md`. The plot index tracks all arcs, their status, and theme coverage.

## Prerequisites

A story project must already exist (created via the story-init skill). Verify by checking for `story.md` in the project root.

## Choosing a Story Structure

1. Read `story.md` for genre and themes
2. Consult `references/structure-models.md` for available structures
3. Recommend a structure based on genre (default to three-act if unclear)
4. Update `plot/_index.md` frontmatter `structure` field
5. Populate the story structure section with the beat sheet
6. When CLI access is available, run `story validate .`

## Creating an Arc

1. Read `story.md` for themes
2. Read `plot/_index.md` for existing arcs
3. Read `characters/_index.md` to understand available characters
4. Ask for:
   - Arc name
   - Type (main, subplot, character, thematic)
   - Which characters are involved
   - Which themes it serves
5. Build the arc through conversation: setup, escalations, climax, resolution
6. Write the file using `references/arc-template.md`
7. Save to `plot/arcs/{arc-name-kebab}.md`
8. Update `plot/_index.md` arcs table
9. Update theme tracking in `plot/_index.md`
10. If characters are referenced, verify they exist in `characters/`
11. When CLI access is available, run `story reindex .`, `story links .`, and `story validate .`

## Arc Plans (schema v3)

On a `schema-version: 3` project an arc carries a plan spanning roughly 3-8
chapters. The plan is where the arc's obligations live, and it separates three
kinds of statement that must not be collapsed into one list:

```yaml
chapters: [chapter-05, chapter-06, chapter-07, chapter-08]
dramatic-objective: Sarah moves from grief to suspicion
starting-state: Sarah trusts her uncle completely
target-end-state: Sarah has begun counting his lies

hard-constraints:
  - constraint: Sarah must not learn the truth about Elizabeth yet
    kind: knowledge          # knowledge | possession | location | reveal | survival | other
    character: sarah
    fact: robert-drowned-elizabeth
    until: chapter-08

required-setups: []
required-payoffs: []
soft-possibilities:
  - Robert could offer to handle the paperwork himself
```

- **hard-constraints** must not be violated. Give them a `kind` and, where the
  constraint is about a specific entity, a `character`, `fact`, or `artifact`, so
  the CLI can check the references and the render packet can enforce them.
- **required-setups / required-payoffs** are what this arc owes the reader.
  Expected outcomes, but the implementation may vary.
- **soft-possibilities** are available to the prose model and never mandatory.

Do not convert every intention into a hard constraint. An arc where everything
is mandatory leaves no room for character behaviour to emerge, which is the main
thing long drafts need room for. If a beat is genuinely optional, it belongs in
`soft-possibilities` or in a scene's `soft-beats`.

`until` normally names a chapter that does not exist yet -- "must not be revealed
before chapter 25" is written long before chapter 25 does. That is expected and
reported as a warning, not an error.

### Simulating the arc

Before drafting the arc's chapters, simulate it. This is the intermediate layer
that stops the workflow from collapsing into plan-chapter, write-chapter,
plan-next-chapter.

```shell
story simulate-arc . --arc the-drowning
```

The brief gives you, per character: their goal, pressure, resources, interior
fields, and -- the part not to guess -- exactly what they know at the arc's
opening, taken from the epistemic graph. Two characters in the same arc get
genuinely different pictures.

Use it to reason about what each character does across the arc, **including
offscreen**. An antagonist keeps acting while the POV is elsewhere; if the plan
only covers what the reader sees, the antagonist becomes reactive scenery.

Record the result on the arc:

```yaml
arc-characters:
  - id: robert
    goal: keep the inquest closed
    pressure: the surveyor is asking about the rope
    resources: the harbor office and his brother's silence
    likely-actions: move the ledger before the audit
    offscreen-actions: visits the boatyard between chapter-02 and chapter-03

causal-chain:
  - step: 1
    chapter: chapter-05
    character: sarah
    cause: Sarah finds the second rope coiled wrong
    effect: she starts noticing what her uncle is careful about
  - step: 2
    chapter: chapter-06
    character: sarah
    cause: she reads the moved ledger
    effect: she understands what he did
    learns: robert-drowned-elizabeth
```

Name the fact in `learns` whenever a step makes someone learn something
canonical. `story continuity` then checks the chain against the arc's hard
constraints and reports a step that has a character learn something too early:

```text
causal-chain[2] has sarah learn robert-drowned-elizabeth in chapter-06,
but a hard constraint withholds it until chapter-08
```

Catching that in the plan is the entire point. The alternative is discovering it
three chapters into the prose.

The chain is causal reasoning, not a beat sheet. Keep it at the level of "this
causes that", and leave the drafting room to find better local action.

### Sealing an arc plan

Once the user approves the plan, freeze it:

```shell
story seal-arc . --arc the-drowning
```

This writes `plot/arcs/sealed/the-drowning-v1.md` and stamps the arc with
`plan-version` and `sealed-version`. Sealed plans are never edited in place:
change the arc and seal again to produce v2. Earlier versions stay byte-identical,
so every chapter plan can name the exact arc version it derives from.

Reseal whenever the plan changes materially. Do not edit a sealed file.

## Managing Plot Points

Plot points live within arc files in the "Plot Points" table. When adding a plot point:

1. Read the relevant arc file
2. Add the plot point to the table with chapter reference (if known)
3. Add the event to `plot/timeline.md` in chronological order
4. If the plot point involves foreshadowing, add it to the arc's foreshadowing table
5. If the plot point creates a reader promise or mystery, create or update a record in `continuity/promises/` or `continuity/questions/`
6. When CLI access is available, run `story validate .`

## Timeline Management

The timeline at `plot/timeline.md` is a chronological master list of all story events across all arcs.

When adding events:
- Insert in chronological order
- Link to the relevant arc and chapter
- Keep entries concise (one line per event)

When reviewing the timeline:
- Check for chronological consistency
- Identify pacing issues (too many events clustered, long gaps)
- Flag arcs that haven't progressed

## Foreshadowing Tracking

Each arc tracks its own foreshadowing in the "Foreshadowing" table:
- **Planted:** What hint or setup is placed
- **Payoff:** What the payoff will be
- **Chapter Planted / Chapter Payoff:** Where each occurs
- **Status:** `planned`, `planted`, or `paid-off`

During chapter writing, flag any `planted` items that haven't been paid off as reminders.

For durable cross-arc setup/payoff tracking, also maintain `continuity/promises/{promise-kebab}.md` with `status`, `planted`, `payoff`, `arcs`, and `characters`. For mystery or open-continuity tracking, maintain `continuity/questions/{question-kebab}.md`.

## Cross-Referencing

- Arcs reference characters via frontmatter `characters` field
- Arcs reference themes via frontmatter `themes` field
- Plot points reference chapters
- Timeline entries link arcs and chapters
- Theme tracking in `plot/_index.md` maps themes to arcs and chapters
- Promises and questions reference chapters, arcs, and characters where relevant

## CLI Maintenance

Use the Story CLI when it is available. If `story` is not installed but the `story-maintenance` skill is present, use `node ../story-maintenance/scripts/story.js` with the same arguments, resolving the path relative to this skill folder. If no CLI is available, perform the registry and backlink checks manually.

## Reference Files

- **`references/arc-template.md`** - Template for arc files with frontmatter and sections
- **`references/question-template.md`** - Template for continuity questions and mysteries
- **`references/promise-template.md`** - Template for setup/payoff tracking
- **`references/structure-models.md`** - Story structure models (three-act, hero's journey, save the cat, kishotenketsu, five-act) with beat sheets
