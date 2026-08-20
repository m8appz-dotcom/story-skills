---
name: chapter-writing
description: This skill should be used when the user asks to "write a chapter", "next chapter", "chapter outline", "draft chapter", "continue the story", "write a scene", "outline a chapter", or wants to write prose for a story project.
---

# Chapter Writing

## Overview

Write story chapters against durable, verified state. A chapter begins as a
**candidate** that cannot touch canon, passes deterministic and semantic checks,
and only then is accepted as a single recorded transaction that commits the
prose, the state snapshot, and every knowledge change together.

## Prerequisites

A story project must exist with at least `story.md` and one character. Check
`schema-version` in `story.md`:

- **3** — use the full workflow below.
- **2** — either run `story migrate .` first, or use the simplified v2 path in
  "Working without v3 state" at the end of this document. Do not migrate without
  asking the user.

## The philosophy

**Preserve all hard constraints and required consequences. Treat scene
intentions and candidate beats as flexible.**

You may discover better local action, dialogue, blocking, or emotional turns
than the ones planned, provided they remain consistent with character
psychology, POV knowledge, canonical state, and downstream hard constraints.

You have freedom at the sentence and scene-execution level. You do not have
freedom to break canon.

Do not treat a beat list as a checklist to tick off. A scene that hits every
planned beat and feels inert is a failure; a scene that finds a better route to
the same required consequence is the goal. What is *not* negotiable is anything
under `hard-constraints`, what the POV character knows, and the state the chapter
must leave behind.

## Recommended Companion Skill

Before drafting or revising prose, check whether the `better-writing` skill is
available. If it is, use it for prose quality, voice calibration, and the final
pre-flight pass. If not, recommend installing
[forjd/better-writing](https://github.com/forjd/better-writing) with
`npx skills add forjd/better-writing`, then continue with
`references/writing-guidelines.md`.

## Workflow

### 1. Inspect accepted state

Never start from the last chapter file. Start from what is *accepted*:

```shell
story state .
story next .
```

`story state .` reports the latest accepted snapshot: story time, where each
character is, their physical and emotional condition, object ownership,
relationship standing, and active threads. This is the ground truth the chapter
opens from.

### 2. Inspect the active arc

```shell
story continuity .
```

Read the arc covering this chapter in `plot/arcs/`. Note three different kinds
of statement and keep them separate in your head:

- **hard-constraints** — must not be violated
- **required-setups / required-payoffs** — this arc's debts to the reader
- **soft-possibilities** — available, never mandatory

If the arc names a `sealed-version`, read the sealed plan in
`plot/arcs/sealed/`. Chapter plans derive from a specific arc version.

### 3. Determine the chapter objective

Ask the user, or propose based on the arc:

- What must be different by the end of this chapter?
- Whose POV?
- What does the chapter owe the arc — a setup, a payoff, a turn?

Frame this as a change in state, not a list of events.

### 4. Build or update the chapter plan

Discuss scope, POV, location, and the shape of the scene with the user. Record
scene contracts in `scenes/` with `objective`, `opposition`, `turn`,
`exit-consequence`, `hard-constraints`, and `soft-beats`.

Keep `soft-beats` genuinely soft. If a beat is truly mandatory it belongs in
`hard-constraints`, not in the beat list.

### 5. Build the POV projection

```shell
story context . --chapter chapter-07 --pov sarah
```

This is what the POV character can honestly hold at this point: facts they know,
believe, suspect, doubt, or misbelieve; observable state of others; their own
relationships. It excludes everything else, and reports how many facts were
withheld without naming them.

**Write only from this.** If you find yourself reaching for something the
projection does not contain, that is the signal to stop, not to look it up.

### 6. Build the render packet

```shell
story render-packet . --chapter chapter-07 --pov sarah --write
```

The packet is the compact, prose-facing brief: narrative contract, scene
contract, hard constraints, POV knowledge, relationships, voice cards, reveal
budget, possible beats, previous-scene ending state, and word budget.

It is not the plan. Do not transcribe planning notes into prose.

### 7. Generate the candidate

```shell
story candidate . --chapter chapter-07 --title "The Tide Line" --pov sarah
```

Write the prose into `work/chapters/chapter-07/candidate-001.md` under
`## Chapter Text`. Write prose directly into that file. Do not create
project-local build scripts, generator scripts, or bulk writer scripts to emit
chapters.

While it is a candidate, nothing else in the project has changed. Rewrites are
cheap precisely because they are inert.

In the same file, record the deltas the chapter proposes:

- `state-characters`, `state-objects`, `state-relationships`
- `knowledge-delta` — who now knows, believes, or suspects what, `learned-in`
  this chapter
- `promise-delta`, `question-delta`
- `story-time`, `active-threads`

Record what the prose actually did, not what the plan intended.

### 8. Run deterministic checks

```shell
story validate .
story links .
story continuity .
```

These prove mechanical things. Fix what they report before going further.

### 9. Run semantic review

The checks above cannot judge any of this. Read the draft and ask:

- Did any character act on knowledge they should not semantically possess?
- Is the emotional continuity from the previous chapter believable?
- Is cause and effect earned, or asserted?
- Do the speakers sound like different people?
- Is there accidental exposition, or repeated emotional beats?
- Does the prose sound generic — competent sentences doing no work?

Record the verdict in the candidate's `review` field. It is testimony, not a
computed result, and it is copied into the transaction as such.

### 10. Revise or reject

Revise the candidate in place, or reject it and write a new one:

```shell
story reject . --chapter chapter-07 --candidate candidate-001 --reason "Sarah reads omniscient"
```

Rejection touches only the candidate. Canon, state, knowledge, promises, and the
timeline are all untouched. A rejected candidate can never afterwards be
accepted.

### 11. Accept

```shell
story accept . --chapter chapter-07 --candidate candidate-002
```

Acceptance validates every reference first and refuses before writing anything
if the chapter is already canon, skips the state sequence, names an unknown
entity, or claims a character learned something in a different chapter. If any
write then fails, the whole commit rolls back.

On success it commits, together: the chapter as canon, a new immutable state
snapshot, the knowledge changes, promise and question movements, a timeline row,
and `transactions/chapter-07.json` with a hash of the accepted prose.

### 12. Verify and continue

```shell
story state .
story doctor .
```

Confirm the snapshot exists, `current` names this chapter, and the knowledge
changes landed. Earlier snapshots must be unchanged — they are never rewritten.

Then move to the next chapter.

## After acceptance

Do not hand-edit an accepted chapter's prose casually. The transaction stores a
hash of it, and `story continuity` will report a mismatch. That is the intended
behaviour: it tells you canon moved out from under its recorded state. If you
genuinely need to change accepted prose, make the edit and then reconcile the
state deliberately with the `revision-continuity` skill.

## Scene Breaks

Within a chapter, separate scenes with `---`. Each scene needs a clear POV
character and location, and a matching record in `scenes/`.

## Working without v3 state

For a `schema-version: 2` project, keep the v2 flow: gather context from
`continuity/state.md`, questions, and promises; build the outline; write prose
directly to `chapters/chapter-{NN}.md`; then update the index, timeline, arcs,
scene records, and continuity state, and run:

```shell
story wordcount . --write
story reindex .
story links .
story validate .
```

The philosophy section above applies either way.

## CLI Access

Prefer `story <command>`. If `story` is not installed but the `story-maintenance`
skill is present, use `node ../story-maintenance/scripts/story.js` with the same
arguments, resolved relative to this skill folder.

## Revision Handoff

When asked to revise, line edit, polish, or continuity-check existing prose, use
the `revision-continuity` skill. This skill owns new drafting; that one owns
targeted edits and continuity audits.

## Reference Files

- **`references/chapter-template.md`** — chapter frontmatter and structure
- **`references/scene-template.md`** — machine-readable scene contract
- **`references/writing-guidelines.md`** — prose craft guidance
