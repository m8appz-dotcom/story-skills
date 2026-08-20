# Design

UI proposals for the v3 engine. Nothing here ships with the CLI.

## Sources

- `Main.dc.html`, `ControlRoom.dc.html`, `ReadingRoom.dc.html` — three
  low-fi directions for the writing screen, shown on the same chapter so
  they can be compared. B (Control Room) was chosen.
- `Projects.dc.html`, `NewProject.dc.html`, `Status.dc.html`,
  `Roles.dc.html` — B built out.
- `canvas.json` — artboard layout for the design canvas.

`Roles.dc.html` describes something the engine does not have: per-role
agent and model assignment (Feature 11 of the brief). It is a proposal,
marked as such on the artboard itself.

## Prototype

`cord-house.html` is a self-contained clickable prototype of direction B:
projects, onboarding, the desk, the knowledge grid, and the accept
receipt. It is a prototype — it holds its own state and reads no files.
Open it in a browser.

The seeded design-canvas page is a ~2MB build artifact and is gitignored;
re-seed it from the `.dc.html` sources when it is needed.
