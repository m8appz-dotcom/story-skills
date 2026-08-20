# Context Projection and Render Packets

Two transformations sit between canon and prose. They exist because handing a
writing model everything you know about your world is the fastest way to get a
chapter where a character acts on information they do not have.

```text
CANON  →  POV PROJECTION  →  RENDER PACKET  →  PROSE
```

## The boundaries being enforced

```text
WORLD TRUTH   ≠   CHARACTER BELIEF   ≠   POV CONTEXT   ≠   READER KNOWLEDGE
```

- **World truth** — `continuity/facts/`. True regardless of who knows it.
- **Character belief** — `continuity/knowledge/`. Six states, per character.
- **POV context** — the projection. The most a given character could honestly
  hold at a given chapter.
- **Reader knowledge** — what the audience has been told. Tracked separately in
  snapshots; a character may know something the reader does not, and the reverse
  is the engine of dramatic irony.

And:

```text
PLAN   ≠   RENDER PACKET   ≠   PROSE
```

A plan is written for the author and the reviewer. A render packet is written
for the writer. They are not the same document and must not be the same
document — planning notes handed to a prose model come back as prose that reads
like planning notes.

## POV projection

```shell
story context . --chapter chapter-17 --pov sarah
story context . --chapter chapter-17 --pov sarah --json
```

### The filter denies by default

A fact reaches the projection only when the POV character has an **explicit
epistemic record** placing them in a knowing state: `knows`, `believes`,
`suspects`, `doubts`, or `misbelieves`.

Everything else is excluded, including — importantly — facts with **no record at
all**. This is the opposite of a blocklist, and deliberately so. In a 120,000
word draft the facts that leak are not the ones you remembered to mark secret;
they are the ones nobody has written a knowledge record for yet. Denying by
default means forgetting to record something fails safe.

Three further exclusions:

- `status: unknown` — an explicit record of not knowing
- a fact whose `established-in` chapter is still ahead of the one being written
- an entry whose `learned-in` chapter is still ahead of the one being written

The last two are defence in depth. If a knowledge record claims Sarah knows
something she only learns in chapter 20, projecting chapter 6 still excludes it.

### What else is filtered

| Included | Excluded |
|---|---|
| POV's own interior life: fear, false belief, private information | Any other character's interior state |
| Relationships the POV participates in | Relationships between two other people |
| Other characters' **observable** state: location, physical | Their emotions, goals, and knowledge |
| Objects the POV carries, or unconcealed objects sharing their location | Objects elsewhere, and concealed ones the POV does not own |
| State entering the chapter, from the previous snapshot | Any later snapshot |

Non-POV characters appear as they would be *seen*, never as they are *felt*.

**Co-location is not visibility.** An artifact recorded as `hidden`, `lost`,
`destroyed`, or `unknown` does not enter a bystander's context merely because
they are standing in the same place — that would hand the prose model a
concealed object as scene furniture. The owner is the exception: they know what
they hid.

### Withheld counts, not contents

The projection reports how many facts were withheld and why, but never what they
were. Naming them would defeat the entire mechanism.

```json
"excluded": { "facts": 1, "reason": "not knowable by this POV character at this point in the story" }
```

## Render packets

```shell
story render-packet . --chapter chapter-17 --pov sarah --word-target 2500
story render-packet . --chapter chapter-17 --pov sarah --write
```

The packet is built **from the projection**, so it inherits every exclusion
above, then adds the scene contract, the active hard constraints, voice cards,
a reveal budget, and possible beats.

### Hard constraints redact themselves

This is the subtle part, and it is worth stating plainly.

A hard constraint that protects a secret is written *in terms of that secret*:

```yaml
hard-constraints:
  - constraint: Sarah must not learn that Robert drowned Elizabeth before chapter-04
    kind: knowledge
    character: sarah
    fact: fact-c-robert-drowned-elizabeth
    until: chapter-04
```

Passing that sentence to the prose model tells it exactly what it was supposed
to keep hidden. So when a constraint names a `fact` outside the POV's
projection, the packet emits a content-free directive instead:

```json
"forbidden-outcomes": [
  "sarah must not learn, infer, or be told anything beyond the knowledge listed in this packet."
]
```

The constraint is then enforced by **absence** rather than by instruction: the
knowledge block bounds what the character can hold, and the model has no access
to the secret to leak in the first place. Constraints that do not name a hidden
fact pass through verbatim.

### Hard versus soft, stated in the packet

The packet carries its own contract, so the writing model reads the distinction
rather than inferring it from field names:

```json
"guidance": {
  "hard-constraints": "Mandatory. Do not violate any of these.",
  "possible-beats": "Optional. Suggestions only; discard any that do not serve the scene.",
  "freedom": "You may discover better local action, dialogue, blocking, or emotional turns than the ones suggested, provided every hard constraint, the POV character's knowledge, and canonical state remain intact.",
  "not-a-script": "Do not transcribe planning notes into prose. Write the scene."
}
```

The three kinds of mandatory statement are kept apart because they fail
differently:

- `mandatory-facts` — omitting one is an **omission**
- `forbidden-outcomes` — breaking one is a **breach**
- `continuity-requirements` — contradicting one is a **contradiction**

### Voice cards

Voice is external. How a character speaks is observable to anyone in the room,
so `speech-principle` and `avoidance-pattern` may appear for characters present
in the scene. `fear`, `false-belief`, and `private-information` never do, for
anyone but the POV.

### What is never in a packet

- world truth the POV cannot hold
- any other character's interior state
- reviewer diagnostics or review notes
- transaction internals: body hashes, state deltas, candidate metadata
- arc payoffs the chapter does not owe, and facts resolving in later chapters

## Where determinism stops

Everything above is mechanical. Code can prove that a secret is absent from a
projection, and there are tests asserting exactly that against the full
serialized envelope, not just the knowledge block.

Code **cannot** prove that the resulting prose does not leak. A model given a
clean packet can still write Sarah behaving as though she suspects her uncle for
reasons the text never earned. Catching that requires reading for meaning, and
it belongs to a semantic reviewer.

The projection makes leakage *hard*. It does not make it impossible, and the
system does not claim it does.
