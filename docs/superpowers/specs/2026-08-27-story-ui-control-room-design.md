# Story UI — Control Room (vertical slice)

Design for a local application that drives the v3 engine: read accepted
state, draft a chapter through an installed model harness, and accept or
reject the result. It replaces `design/cord-house.html`, a clickable
prototype that holds its own state and reads no files.

## Goal

One complete path, end to end, against a real project: open a project,
see the POV-safe knowledge for a chapter, draft it with a model, read the
draft against that knowledge, and accept it through the engine's own
transaction.

The path is chosen over breadth deliberately. The subprocess harness is
the only component whose behaviour cannot be predicted from the existing
code, so it is proven first, with one screen finished rather than five
unfinished.

## Decisions

Four decisions were settled before design, and everything below follows
from them.

**Scope: engine plus drafting.** The UI both drives the deterministic
engine and calls a model to write prose. It is not a read-only viewer.

**Harness: subprocess to installed CLIs.** `claude`, `codex` and `gemini`
are already installed and authenticated on the target machine. The UI
spawns one of them rather than calling a provider API, so there is no key
to store and no provider named in the code. The harness becomes a line of
configuration, which is what Feature 11 of the original brief asked for.

**Location: `ui/` inside this repository, no dependencies.** The coverage
gate is already scoped to `src` (`check-coverage.js coverage/lcov.info
src`), so a sibling directory falls outside it without weakening the
invariant. The UI uses Node's own `http` module and browser JavaScript
with no build step, which keeps the repository's zero-dependency rule
intact.

**Exposure: the tailnet, with a token.** The server binds beyond loopback
so the UI can be opened from another device. Because it can spawn model
processes and write into story projects, a token is mandatory rather than
optional. This was chosen with the risk stated.

## Architecture

```
ui/server.js      Node http; imports src/story.js directly
ui/harness.js     spawns claude/codex/gemini, fixed argv table
ui/projects.json  remembered project roots (gitignored)
ui/public/        index.html, styles, browser modules; no build
```

The engine is never invoked as a CLI. `src/story.js` exports 34
functions that already return structured objects, so the server imports
and calls them. Nothing parses human-readable output, and no process is
spawned to read state.

### Endpoints

| Method | Path | Engine call |
|--------|------|-------------|
| GET | `/api/projects` | `scanProject` per remembered root |
| POST | `/api/projects` | validate and remember a root |
| GET | `/api/project/:id` | `projectReport`, `validateProject`, `validateLinks`, `checkProjectContinuity` |
| GET | `/api/project/:id/context` | `contextProjection` |
| POST | `/api/project/:id/candidate` | `createCandidate` |
| POST | `/api/project/:id/draft` | `renderPacket`, then the harness; streams over SSE |
| POST | `/api/project/:id/accept` | `acceptCandidate` |
| POST | `/api/project/:id/reject` | `rejectCandidate` |

A browser cannot choose a directory on the server, so a project root is
registered by pasting its path. The path is validated with `scanProject`
before it is remembered; nothing scans the disk on its own.

`:id` is an opaque identifier assigned when a root is registered and
stored beside it in `projects.json`. It is not the story id and not the
path: two projects may share a title, and a path is not safe to put in a
URL.

The draft endpoint streams, but not over `EventSource`. `EventSource`
issues a GET and cannot carry the token header, so the browser reads the
POST response body as a stream through `fetch`. The wire format stays
line-delimited JSON, one object per chunk, so the server side remains a
plain `res.write` per event.

## Screens

**Projects.** One row per remembered root: chapters, words, schema
version, and the result of the three checks run live rather than cached.
Selecting a row opens the Control Room.

**Control Room.** The layout settled in `design/ControlRoom.dc.html`: the
candidate rail and sealed arc on the left, the prose column in the centre
and deliberately the narrowest element on screen, and the knowledge grid
on the right — what the POV character knows, what they believe or suspect
with its confidence, what must not happen, and the count of facts
withheld from this POV. The accepted state chain runs along the bottom.

Every value in the grid comes from `contextProjection`.

## Drafting cycle

```
choose chapter + POV   ->  contextProjection fills the knowledge grid
Draft                  ->  createCandidate writes the scaffold
                       ->  renderPacket -> harness stdin
                       ->  SSE streams output into the prose column
finish                 ->  prose is saved into the candidate
Accept                 ->  acceptCandidate -> receipt
```

Two invariants hold this together.

**The model receives the render packet and nothing else.** Not the
project, not the files, not the manuscript. The packet already carries
the POV-safe projection with constraints self-redacted; that is the
mechanism preventing a scene in which a character knows something they do
not. It only holds if the UI opens no side channel.

**How far the first invariant actually reaches.** It holds completely for
`claude`, which runs with every tool disallowed. `codex` and `gemini` run
with `--sandbox read-only` and `--approval-mode plan`: they cannot write,
but they can still read, and `USERPROFILE`/`HOME` have to survive the
environment allowlist for those CLIs to authenticate at all. The child is
given an empty temporary working directory and ten environment variables,
which removes the obvious paths back to the project but does not seal them
— a determined model could enumerate outward and find the manuscript.

Dropping the weaker harnesses was considered and rejected. Instead the
Control Room states which is which at the moment of choice: "Sees only the
packet." against `claude`, "Can also read files on this machine." against
the other two. A harness added to the table without declaring its isolation
fails a test rather than defaulting to looking safe. The guarantee is not
uniform, so the interface says so rather than implying otherwise.

**The model writes prose and only prose.** Its output is written into the
candidate's `## Chapter Text` section and never into frontmatter.
Narrative state — who is where, who knows what, what time it is — is
still set by the engine at acceptance. A model that could write
frontmatter would dissolve the deterministic half of the system.

## Security model

The token is generated on first run, stored in `ui/.token`, and required
in an `X-Story-Token` header on every `/api/*` call. The page receives it
once through the URL and keeps it in `sessionStorage`. A header rather
than a cookie, so a page on another origin cannot forge a request from
the user's browser.

Startup prints the full URL with the token in it, which is how the token
reaches a browser at all. Comparison is constant-time, so a wrong token
takes the same time to reject as a right one.

The server refuses to start bound to anything other than loopback when no
token is present.

`harness.js` holds a fixed table mapping `claude`, `codex` and `gemini` to
argv arrays. A request selects a key from that table. No field of any
request body becomes part of a command line, so there is no path from an
HTTP body to process execution.

## Error handling

| Situation | Response |
|-----------|----------|
| Path is not a project | 400 carrying `scanProject`'s own message |
| Harness not on PATH | 503 naming which one is missing |
| Harness exits non-zero | its stderr surfaced; candidate left as scaffolded |
| Token missing or wrong | 401, without revealing whether a token exists |
| `acceptCandidate` refuses | 409 carrying the engine's message, nothing written |

The last row costs nothing to guarantee: acceptance is already a
two-phase transaction with rollback, so a refusal part-way leaves the
project exactly as it was.

## Testing

`ui/` sits outside the coverage gate, which stays scoped to `src` so the
100% invariant is untouched. Outside the gate does not mean untested.

- `test/ui-server.test.js` — starts the server on port 0 and makes real
  requests: missing token rejected, valid token accepted, invalid project
  path rejected, and the candidate-to-acceptance cycle against a
  temporary project.
- `test/ui-harness.test.js` — the property that matters: a key outside the
  table is refused, and no request field reaches a command line.

**Documented tradeoff:** the browser modules get no unit tests. They are
verified by driving the real page against a real project. This is a
choice, not an oversight: testing browser code would mean adding a test
framework and a build step, which costs the zero-dependency invariant for
the layer least likely to hold a continuity bug. The deterministic
guarantees all live server-side, and those are tested.

## Out of scope for this slice

Status, New Project and Roles screens. Per-role harness assignment — the
slice has a single harness selector in the Control Room, not the roles
table. The continuity-reviewer role. Anything multi-user or concurrent.

## Known risk

`claude -p` has not yet been run as a subprocess from Node on Windows in
this repository. Its streaming shape, timing, and failure output are
assumptions until measured. This is the first thing the implementation
proves, before any screen is built, because a surprise there changes the
draft endpoint's design.
