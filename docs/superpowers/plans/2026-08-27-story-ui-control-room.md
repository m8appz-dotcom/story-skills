# Story UI — Control Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the vertical slice of a local UI that opens a story project, shows the POV-safe knowledge for a chapter, drafts that chapter through an installed model CLI, and accepts or rejects the result through the engine's own transaction.

**Architecture:** A zero-dependency Node HTTP server in `ui/` imports `src/story.js` directly and calls its exported functions; no engine operation shells out. Drafting is the one subprocess: a fixed table maps a harness key to an argv array, the render packet travels on stdin, and output is normalised per harness and streamed to the browser as line-delimited JSON. The browser layer is plain HTML/CSS/JS with no build step.

**Tech Stack:** Node ESM (`node:http`, `node:child_process`, `node:crypto`), bun test, vanilla browser JavaScript.

## Global Constraints

- No runtime dependencies. `package.json` gains no `dependencies` entry.
- The coverage gate stays scoped to `src` — do not add `ui` to `scripts/check-coverage.js`.
- No provider name is hardcoded in a data structure; harnesses live in one table in `ui/harness.js`.
- The model receives the render packet and nothing else — no project path, no file access, no manuscript.
- Model output is written into a candidate's `## Chapter Text` section and never into frontmatter.
- Argv for a spawned harness is always fixed table content. Request data reaches a child only on stdin.
- Every `/api/*` route requires the `X-Story-Token` header.
- **No `innerHTML` anywhere in `ui/public/`.** Titles, fact statements, and prose all come out of project markdown, which is untrusted input to this page. The page holds a token that can spawn processes and write files, and it is reachable from the tailnet, so script injection here is privilege escalation rather than defacement. Build nodes and set `textContent`.
- All comments and identifiers in English, matching the repository.

## Measured facts

These were spiked before planning. They are facts, not assumptions.

- `codex exec --json "<fixed prompt>"` exits 0 in ~7s, emits line-delimited JSON objects with a `type` key (`thread_id`, `item`, `usage` variants), and reads its payload from stdin.
- `gemini -p ... --output-format stream-json` invokes correctly but fails on this machine with `IneligibleTierError`. The harness must surface auth failure as its own error, not as an empty draft.
- `claude` refuses to launch when `CLAUDECODE` is set: *"Claude Code cannot be launched inside another Claude Code session."* The child environment must have `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT` deleted. This cannot be verified from inside a Claude Code session; verify it by running the server from an ordinary terminal.
- `spawn` with `shell: true` concatenates argv **without escaping** (Node DEP0190). A spike proved it by splitting a quoted prompt into two arguments. `shell: true` is required on Windows to run the `.cmd` shims these CLIs install, so safety comes from argv being fixed, never from escaping.
- The three CLIs emit different JSON shapes, so each table entry carries its own text extractor.

---

### Task 1: Harness table, environment sanitation, and output normalisation

**Files:**
- Create: `ui/harness.js`
- Test: `test/ui-harness.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `HARNESSES` (frozen, keyed by harness name), `harnessNames(): string[]`, `buildSpawn(name): {command, args, env}`, `extractText(name, line): string` — returns `""` for a line carrying no prose.

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, test } from "bun:test";
import { buildSpawn, extractText, harnessNames } from "../ui/harness.js";

describe("harness table", () => {
  test("names only the harnesses the table declares", () => {
    expect(harnessNames().sort()).toEqual(["claude", "codex", "gemini"]);
  });

  test("refuses a key that is not in the table", () => {
    expect(() => buildSpawn("curl")).toThrow("Unknown harness: curl");
    expect(() => buildSpawn("")).toThrow("Unknown harness:");
  });

  test("strips the nesting guard from the child environment", () => {
    const { env } = buildSpawn("claude");
    expect("CLAUDECODE" in env).toBe(false);
    expect("CLAUDE_CODE_ENTRYPOINT" in env).toBe(false);
  });

  test("builds argv from the table alone", () => {
    const { command, args } = buildSpawn("codex");
    expect(command).toBe("codex");
    expect(args.every((arg) => typeof arg === "string")).toBe(true);
    expect(args).toContain("exec");
  });

  test("pulls prose out of each harness's own line shape", () => {
    expect(extractText("codex", JSON.stringify({
      type: "item", item: { type: "agent_message", text: "She had the copy off the frame." }
    }))).toBe("She had the copy off the frame.");

    expect(extractText("claude", JSON.stringify({
      type: "assistant", message: { content: [{ type: "text", text: "The light went." }] }
    }))).toBe("The light went.");

    // Lines carrying no prose are not errors; they are simply empty.
    expect(extractText("codex", JSON.stringify({ type: "usage", usage: {} }))).toBe("");
    expect(extractText("codex", "not json at all")).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/ui-harness.test.js`
Expected: FAIL — `Cannot find module '../ui/harness.js'`

- [ ] **Step 3: Write the implementation**

```js
// The one place a provider is named. Everything else addresses a harness by
// key, so adding one is a table entry and nothing else.
//
// argv is fixed table content on purpose. Windows needs shell: true to run the
// .cmd shims these CLIs install, and shell: true concatenates arguments without
// escaping them (Node DEP0190) -- so the payload travels on stdin, never here.

const DRAFT_INSTRUCTION = "Write the chapter described by the JSON packet on stdin. Output prose only.";

export const HARNESSES = Object.freeze({
  claude: Object.freeze({
    command: "claude",
    args: Object.freeze([
      "-p", `"${DRAFT_INSTRUCTION}"`,
      "--output-format", "stream-json",
      "--verbose",
      "--no-session-persistence",
      // The packet is the whole world the drafter gets; tools would be a side channel.
      "--disallowedTools", "\"Bash Edit Write Read Glob Grep WebFetch WebSearch Task\""
    ]),
    extract: (parsed) => parsed?.type === "assistant"
      ? (parsed.message?.content ?? []).filter((part) => part?.type === "text").map((part) => part.text).join("")
      : ""
  }),
  codex: Object.freeze({
    command: "codex",
    args: Object.freeze(["exec", "--json", "--skip-git-repo-check", `"${DRAFT_INSTRUCTION}"`]),
    extract: (parsed) => parsed?.type === "item" && parsed.item?.type === "agent_message"
      ? String(parsed.item.text ?? "")
      : ""
  }),
  gemini: Object.freeze({
    command: "gemini",
    args: Object.freeze(["-p", `"${DRAFT_INSTRUCTION}"`, "--output-format", "stream-json"]),
    extract: (parsed) => parsed?.type === "assistant" ? String(parsed.text ?? "") : ""
  })
});

// Claude Code refuses to launch inside another Claude Code session, and the
// check reads the environment. A server started from inside one would fail
// every draft until these are gone.
const INHERITED_GUARDS = ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"];

export function harnessNames() {
  return Object.keys(HARNESSES);
}

export function buildSpawn(name) {
  const harness = Object.prototype.hasOwnProperty.call(HARNESSES, name) ? HARNESSES[name] : undefined;

  if (!harness) {
    throw new Error(`Unknown harness: ${name}`);
  }

  const env = { ...process.env };
  for (const guard of INHERITED_GUARDS) {
    delete env[guard];
  }

  return { command: harness.command, args: [...harness.args], env };
}

export function extractText(name, line) {
  const harness = Object.prototype.hasOwnProperty.call(HARNESSES, name) ? HARNESSES[name] : undefined;

  if (!harness) {
    return "";
  }

  try {
    return harness.extract(JSON.parse(line)) ?? "";
  } catch {
    // Harnesses interleave progress chatter that is not JSON. Not an error.
    return "";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/ui-harness.test.js`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add ui/harness.js test/ui-harness.test.js
git commit -m "feat: harness table with fixed argv and sanitised child environment"
```

---

### Task 2: Token and server skeleton

**Files:**
- Create: `ui/token.js`, `ui/server.js`
- Test: `test/ui-server.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `readOrCreateToken(dir): string`, `tokenMatches(expected, given): boolean`, `createServer({token}): http.Server`, `startServer({host, port, token}): Promise<{server, port, url}>`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, test, afterAll } from "bun:test";
import { startServer } from "../ui/server.js";
import { tokenMatches } from "../ui/token.js";

const TOKEN = "test-token-0123456789";
const started = await startServer({ host: "127.0.0.1", port: 0, token: TOKEN });
afterAll(() => started.server.close());

function get(path, token) {
  return fetch(`http://127.0.0.1:${started.port}${path}`,
    token ? { headers: { "X-Story-Token": token } } : undefined);
}

describe("token", () => {
  test("compares without leaking length or content", () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(tokenMatches(TOKEN, "wrong")).toBe(false);
    expect(tokenMatches(TOKEN, "")).toBe(false);
    expect(tokenMatches(TOKEN, undefined)).toBe(false);
  });
});

describe("server", () => {
  test("refuses an API call with no token", async () => {
    const response = await get("/api/projects");
    expect(response.status).toBe(401);
    // The body must not say whether a token exists or how long it is.
    expect((await response.text()).toLowerCase()).not.toContain("token");
  });

  test("refuses an API call with the wrong token", async () => {
    expect((await get("/api/projects", "nope")).status).toBe(401);
  });

  test("serves the API with the right token", async () => {
    const response = await get("/api/projects", TOKEN);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ projects: [] });
  });

  test("serves the page without a token, because the page carries none yet", async () => {
    expect((await get("/")).status).toBe(200);
  });

  test("refuses to bind past loopback with no token", async () => {
    await expect(startServer({ host: "0.0.0.0", port: 0, token: "" }))
      .rejects.toThrow("refusing to bind");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/ui-server.test.js`
Expected: FAIL — `Cannot find module '../ui/server.js'`

- [ ] **Step 3: Write `ui/token.js`**

```js
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function readOrCreateToken(dir) {
  const file = path.join(dir, ".token");

  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing !== "") {
      return existing;
    }
  }

  const token = randomBytes(24).toString("hex");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `${token}\n`, "utf8");
  return token;
}

export function tokenMatches(expected, given) {
  if (typeof given !== "string" || given === "") {
    return false;
  }

  // Pad to a fixed width first: timingSafeEqual throws on a length mismatch,
  // and throwing early is itself a signal about the real token's length.
  const left = Buffer.from(expected.padEnd(128, "\0").slice(0, 128));
  const right = Buffer.from(given.padEnd(128, "\0").slice(0, 128));
  return timingSafeEqual(left, right) && expected.length === given.length;
}
```

- [ ] **Step 4: Write `ui/server.js`**

```js
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tokenMatches } from "./token.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "public");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function sendStatic(response, urlPath) {
  const name = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
  const file = path.join(PUBLIC, name);

  // Containment: a resolved path that escapes PUBLIC is refused outright.
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) {
    response.writeHead(404).end("Not found");
    return;
  }

  response.writeHead(200, { "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream" });
  response.end(fs.readFileSync(file));
}

export function createServer({ token }) {
  return http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");

    if (!url.pathname.startsWith("/api/")) {
      sendStatic(response, url.pathname);
      return;
    }

    if (!tokenMatches(token, request.headers["x-story-token"])) {
      // Deliberately says nothing about why.
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }

    if (url.pathname === "/api/projects" && request.method === "GET") {
      sendJson(response, 200, { projects: [] });
      return;
    }

    sendJson(response, 404, { error: "Unknown route" });
  });
}

export function startServer({ host = "127.0.0.1", port = 0, token = "" } = {}) {
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";

  if (!loopback && token === "") {
    return Promise.reject(new Error(`refusing to bind ${host} with no token`));
  }

  const server = createServer({ token });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const bound = server.address().port;
      resolve({ server, port: bound, url: `http://${host}:${bound}/?t=${token}` });
    });
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test test/ui-server.test.js`
Expected: PASS, 6 tests. `/api/projects` returns an empty list because Task 3 has not landed.

- [ ] **Step 6: Commit**

```bash
git add ui/token.js ui/server.js test/ui-server.test.js
git commit -m "feat: UI server skeleton with mandatory token and static serving"
```

---

### Task 3: Project registry and the read endpoints

**Files:**
- Create: `ui/projects.js`
- Modify: `ui/server.js` (replace the stub `/api/projects` handler)
- Modify: `test/ui-server.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `sendJson` from Task 2.
- Produces: `registerRoot(dir, absolutePath): {id, root, title}`, `listProjects(dir): Array<{id, root, title}>`, `resolveRoot(dir, id): string` — throws `Unknown project: <id>` when unregistered.

- [ ] **Step 1: Write the failing test**

Append to `test/ui-server.test.js`:

```js
import { createStoryProject, scanProject } from "../src/story.js";
import { makeTempDir } from "./helpers.js";

function post(path, body) {
  return fetch(`http://127.0.0.1:${started.port}${path}`, {
    method: "POST",
    headers: { "X-Story-Token": TOKEN, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("project registry", () => {
  test("refuses a path that is not a story project", async () => {
    const response = await post("/api/projects", { path: makeTempDir() });
    expect(response.status).toBe(400);
    // The engine's own words, not a stack trace.
    expect((await response.json()).error).toContain("Missing");
  });

  test("remembers a real project and reports it", async () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Registry Novel", force: false });

    const created = await post("/api/projects", { path: root });
    expect(created.status).toBe(200);

    const { id } = await created.json();
    expect(typeof id).toBe("string");
    // The id is opaque: not the story id, and not the path.
    expect(id).not.toBe(scanProject(root).storyId);
    expect(id).not.toContain(root);

    const detail = await get(`/api/project/${id}`, TOKEN);
    expect(detail.status).toBe(200);

    const body = await detail.json();
    expect(body.title).toBe("Registry Novel");
    expect(body.checks.validate.ok).toBe(true);
    expect(body.checks.links.ok).toBe(true);
    expect(body.checks.continuity.ok).toBe(true);
  });

  test("refuses an unknown project id", async () => {
    expect((await get("/api/project/deadbeef", TOKEN)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/ui-server.test.js`
Expected: FAIL — POST `/api/projects` returns 404 from the fallthrough route.

- [ ] **Step 3: Write `ui/projects.js`**

```js
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { scanProject } from "../src/story.js";

// A browser cannot pick a directory on the server, so roots arrive as pasted
// paths. Each one is proven to be a project before it is remembered.

function registryFile(dir) {
  return path.join(dir, "projects.json");
}

function readRegistry(dir) {
  const file = registryFile(dir);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
}

export function listProjects(dir) {
  return readRegistry(dir);
}

export function registerRoot(dir, absolutePath) {
  // Throws with the engine's own message when the path is not a project.
  const project = scanProject(absolutePath);
  const entries = readRegistry(dir);
  const already = entries.find((entry) => entry.root === project.root);

  if (already) {
    return already;
  }

  // Opaque on purpose: two projects may share a title, and a path does not
  // belong in a URL.
  const entry = { id: randomBytes(8).toString("hex"), root: project.root, title: project.storyTitle };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(registryFile(dir), `${JSON.stringify(entries.concat([entry]), null, 2)}\n`, "utf8");
  return entry;
}

export function resolveRoot(dir, id) {
  const entry = readRegistry(dir).find((item) => item.id === id);

  if (!entry) {
    throw new Error(`Unknown project: ${id}`);
  }

  return entry.root;
}
```

- [ ] **Step 4: Wire the routes into `ui/server.js`**

Add at the top:

```js
import { checkProjectContinuity, projectReport, validateLinks, validateProject } from "../src/story.js";
import { listProjects, registerRoot, resolveRoot } from "./projects.js";

function readBody(request) {
  return new Promise((resolve) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); }
    });
  });
}
```

Replace the stub `/api/projects` block with:

```js
    if (url.pathname === "/api/projects" && request.method === "GET") {
      sendJson(response, 200, { projects: listProjects(HERE) });
      return;
    }

    if (url.pathname === "/api/projects" && request.method === "POST") {
      readBody(request).then((body) => {
        try {
          sendJson(response, 200, registerRoot(HERE, String(body.path ?? "")));
        } catch (error) {
          sendJson(response, 400, { error: error.message });
        }
      });
      return;
    }

    const detail = url.pathname.match(/^\/api\/project\/([a-f0-9]+)$/);
    if (detail && request.method === "GET") {
      try {
        const root = resolveRoot(HERE, detail[1]);
        const report = projectReport(root);
        const validate = validateProject(root);
        const links = validateLinks(root);
        const continuity = checkProjectContinuity(root);

        sendJson(response, 200, {
          title: report.title,
          chapters: report.chapters,
          words: report.words,
          checks: {
            validate: { ok: validate.ok, errors: validate.errors },
            links: { ok: links.ok, errors: links.errors },
            continuity: { ok: continuity.ok, errors: continuity.errors }
          }
        });
      } catch (error) {
        sendJson(response, 404, { error: error.message });
      }
      return;
    }
```

- [ ] **Step 5: Ignore the registry and the token**

```bash
printf 'ui/projects.json\nui/.token\n' >> .gitignore
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test test/ui-server.test.js`
Expected: PASS, 9 tests

- [ ] **Step 7: Commit**

```bash
git add ui/projects.js ui/server.js test/ui-server.test.js .gitignore
git commit -m "feat: project registry and read endpoints over the engine"
```

---

### Task 4: The context endpoint

**Files:**
- Modify: `ui/server.js`, `test/ui-server.test.js`

**Interfaces:**
- Consumes: `resolveRoot` from Task 3.
- Produces: `GET /api/project/:id/context?chapter=&pov=` returning what `contextProjection` builds.

- [ ] **Step 1: Write the failing test**

Append to `test/ui-server.test.js`:

```js
import { createEntity } from "../src/story.js";

async function seeded(title, build) {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title, force: false });
  build(root);
  const { id } = await (await post("/api/projects", { path: root })).json();
  return { root, id };
}

describe("context endpoint", () => {
  test("serves the POV projection the knowledge grid draws", async () => {
    const { id } = await seeded("Context Novel", (root) => {
      createEntity(root, { kind: "character", name: "Chimpu", role: "protagonist" });
      createEntity(root, { kind: "chapter", name: "The Three Places", number: 11, pov: "chimpu" });
    });

    const response = await get(`/api/project/${id}/context?chapter=chapter-11&pov=chimpu`, TOKEN);
    expect(response.status).toBe(200);

    const projection = await response.json();
    expect(projection.pov).toBe("chimpu");
  });

  test("refuses a chapter the project does not have", async () => {
    const { id } = await seeded("No Chapter", () => {});
    expect((await get(`/api/project/${id}/context?chapter=chapter-99&pov=nobody`, TOKEN)).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/ui-server.test.js`
Expected: FAIL — the context path falls through to `Unknown route`, returning 404.

- [ ] **Step 3: Add the route to `ui/server.js`**

Extend the engine import with `contextProjection`, then add:

```js
    const context = url.pathname.match(/^\/api\/project\/([a-f0-9]+)\/context$/);
    if (context && request.method === "GET") {
      try {
        const root = resolveRoot(HERE, context[1]);
        sendJson(response, 200, contextProjection(root, {
          chapter: url.searchParams.get("chapter") ?? "",
          pov: url.searchParams.get("pov") ?? ""
        }));
      } catch (error) {
        // An unregistered id is 404; the engine refusing the request is 400.
        sendJson(response, error.message.startsWith("Unknown project") ? 404 : 400, { error: error.message });
      }
      return;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/ui-server.test.js`
Expected: PASS, 11 tests

- [ ] **Step 5: Commit**

```bash
git add ui/server.js test/ui-server.test.js
git commit -m "feat: serve the POV context projection to the UI"
```

---

### Task 5: The draft endpoint

**Files:**
- Create: `ui/draft.js`
- Modify: `ui/server.js`, `test/ui-server.test.js`

**Interfaces:**
- Consumes: `buildSpawn`, `extractText` (Task 1); `resolveRoot` (Task 3).
- Produces: `runDraft({root, chapter, pov, harness, spawnImpl}): AsyncGenerator<{type: "chunk"|"error"|"done", text?, candidateFile?, words?}>` and `POST /api/project/:id/draft` streaming line-delimited JSON.

`spawnImpl` defaults to `child_process.spawn` and exists so tests drive a stub instead of a real model.

- [ ] **Step 1: Write the failing test**

Append to `test/ui-server.test.js`:

```js
import { runDraft } from "../ui/draft.js";
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
import fsNode from "node:fs";
import pathNode from "node:path";

function stubSpawn(lines, { code = 0, stderr = [] } = {}) {
  return () => {
    const child = new EventEmitter();
    child.stdout = Readable.from(lines.map((line) => `${JSON.stringify(line)}\n`));
    child.stderr = Readable.from(stderr);
    child.stdin = new Writable({ write(chunk, encoding, done) { done(); } });
    child.stdout.on("end", () => setImmediate(() => child.emit("close", code)));
    return child;
  };
}

async function collect(options) {
  const events = [];
  for await (const event of runDraft(options)) {
    events.push(event);
  }
  return events;
}

describe("drafting", () => {
  test("writes prose into the candidate and never into frontmatter", async () => {
    const { root } = await seeded("Draft Novel", (dir) => {
      createEntity(dir, { kind: "character", name: "Chimpu", role: "protagonist" });
      createEntity(dir, { kind: "chapter", name: "The Three Places", number: 11, pov: "chimpu" });
    });

    const events = await collect({
      root, chapter: "chapter-11", pov: "chimpu", harness: "codex",
      spawnImpl: stubSpawn([
        { type: "item", item: { type: "agent_message", text: "The light went." } },
        { type: "usage", usage: {} }
      ])
    });

    const done = events.find((event) => event.type === "done");
    expect(done).toBeDefined();

    const written = fsNode.readFileSync(done.candidateFile, "utf8");
    expect(written).toContain("The light went.");
    // The frontmatter block must be exactly what the scaffold wrote.
    expect(written.split("---")[1]).not.toContain("The light went.");
  });

  test("surfaces a harness that fails instead of reporting an empty draft", async () => {
    const { root } = await seeded("Failing Harness", (dir) => {
      createEntity(dir, { kind: "character", name: "Chimpu", role: "protagonist" });
      createEntity(dir, { kind: "chapter", name: "One", number: 1, pov: "chimpu" });
    });

    const events = await collect({
      root, chapter: "chapter-01", pov: "chimpu", harness: "gemini",
      spawnImpl: stubSpawn([], { code: 1, stderr: ["IneligibleTierError: not eligible\n"] })
    });

    expect(events.find((event) => event.type === "error").text).toContain("IneligibleTierError");
  });

  test("refuses a harness that is not in the table", async () => {
    const { root } = await seeded("Bad Harness", (dir) => {
      createEntity(dir, { kind: "chapter", name: "One", number: 1 });
    });

    const events = await collect({ root, chapter: "chapter-01", pov: "", harness: "curl" });
    expect(events[0].type).toBe("error");
    expect(events[0].text).toContain("Unknown harness: curl");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/ui-server.test.js`
Expected: FAIL — `Cannot find module '../ui/draft.js'`

- [ ] **Step 3: Write `ui/draft.js`**

```js
import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import { createCandidate, renderPacket, scanProject } from "../src/story.js";
import { buildSpawn, extractText } from "./harness.js";

// The packet is the entire brief. It goes on stdin because argv is not a safe
// channel here: Windows needs shell: true for the .cmd shims these CLIs
// install, and that concatenates arguments without escaping them.

const PROSE_HEADING = "## Chapter Text";

export async function* runDraft({ root, chapter, pov, harness, spawnImpl = nodeSpawn }) {
  let packet;
  let file;

  try {
    const built = renderPacket(scanProject(root), { chapter, pov });
    packet = built.packet ?? built;
    file = createCandidate(root, { chapter, title: chapter, pov }).file;
  } catch (error) {
    yield { type: "error", text: error.message };
    return;
  }

  let command;
  try {
    command = buildSpawn(harness);
  } catch (error) {
    yield { type: "error", text: error.message };
    return;
  }

  const child = spawnImpl(command.command, command.args, {
    env: command.env,
    shell: true,
    stdio: ["pipe", "pipe", "pipe"]
  });

  child.stdin.end(JSON.stringify(packet));

  let stderr = "";
  child.stderr.on("data", (data) => { stderr += data; });

  // The spec called for a 503 when a harness is not on PATH. It cannot be one:
  // by the time spawn fails the response is already a 200 stream. A missing
  // binary surfaces here instead, named, as the stream's error event.
  child.on("error", (error) => { stderr += `${harness} could not be started: ${error.message}\n`; });

  const exit = new Promise((resolve) => child.on("close", resolve));

  let prose = "";
  let carry = "";

  for await (const data of child.stdout) {
    carry += data;
    const lines = carry.split("\n");
    carry = lines.pop() ?? "";

    for (const line of lines) {
      const text = extractText(harness, line);
      if (text !== "") {
        prose += text;
        yield { type: "chunk", text };
      }
    }
  }

  const code = await exit;

  if (code !== 0) {
    yield { type: "error", text: stderr.trim() || `harness exited with ${code}` };
    return;
  }

  // Prose replaces only what follows the heading. The frontmatter the scaffold
  // wrote is never touched: narrative state is the engine's to set at acceptance.
  const markdown = fs.readFileSync(file, "utf8");
  const head = markdown.split(PROSE_HEADING)[0];
  fs.writeFileSync(file, `${head}${PROSE_HEADING}\n\n${prose.trim()}\n`, "utf8");

  yield { type: "done", candidateFile: file, words: prose.trim().split(/\s+/).filter(Boolean).length };
}
```

- [ ] **Step 4: Stream it from `ui/server.js`**

Import `runDraft` from `./draft.js`, then add:

```js
    const draft = url.pathname.match(/^\/api\/project\/([a-f0-9]+)\/draft$/);
    if (draft && request.method === "POST") {
      readBody(request).then(async (body) => {
        let root;
        try {
          root = resolveRoot(HERE, draft[1]);
        } catch (error) {
          sendJson(response, 404, { error: error.message });
          return;
        }

        // Line-delimited JSON rather than SSE: EventSource issues a GET and
        // cannot carry the token header.
        response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8" });

        for await (const event of runDraft({
          root,
          chapter: String(body.chapter ?? ""),
          pov: String(body.pov ?? ""),
          harness: String(body.harness ?? "")
        })) {
          response.write(`${JSON.stringify(event)}\n`);
        }

        response.end();
      });
      return;
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test test/ui-server.test.js`
Expected: PASS, 14 tests

- [ ] **Step 6: Commit**

```bash
git add ui/draft.js ui/server.js test/ui-server.test.js
git commit -m "feat: draft a chapter through a harness and stream it to the UI"
```

---

### Task 6: Accept and reject

**Files:**
- Modify: `ui/server.js`, `test/ui-server.test.js`

**Interfaces:**
- Consumes: `resolveRoot` (Task 3).
- Produces: `POST /api/project/:id/accept` returning `acceptCandidate`'s receipt, and `POST /api/project/:id/reject`.

- [ ] **Step 1: Write the failing test**

Append to `test/ui-server.test.js`:

```js
describe("acceptance", () => {
  test("returns the engine's refusal without writing anything", async () => {
    const { root, id } = await seeded("Refusal", () => {});
    const before = fsNode.readdirSync(pathNode.join(root, "chapters")).sort();

    const response = await post(`/api/project/${id}/accept`,
      { chapter: "chapter-01", candidate: "candidate-001" });

    expect(response.status).toBe(409);
    expect((await response.json()).error.length).toBeGreaterThan(0);
    // Nothing moved: the two-phase commit never reached its write pass.
    expect(fsNode.readdirSync(pathNode.join(root, "chapters")).sort()).toEqual(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/ui-server.test.js`
Expected: FAIL — the accept path returns 404 from the fallthrough route.

- [ ] **Step 3: Add the routes to `ui/server.js`**

Extend the engine import with `acceptCandidate` and `rejectCandidate`, then add:

```js
    const decision = url.pathname.match(/^\/api\/project\/([a-f0-9]+)\/(accept|reject)$/);
    if (decision && request.method === "POST") {
      readBody(request).then((body) => {
        let root;
        try {
          root = resolveRoot(HERE, decision[1]);
        } catch (error) {
          sendJson(response, 404, { error: error.message });
          return;
        }

        try {
          const options = { chapter: String(body.chapter ?? ""), candidate: String(body.candidate ?? "") };
          sendJson(response, 200, decision[2] === "accept"
            ? acceptCandidate(root, options)
            : rejectCandidate(root, options));
        } catch (error) {
          // The engine refused. Acceptance is transactional, so nothing was written.
          sendJson(response, 409, { error: error.message });
        }
      });
      return;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/ui-server.test.js`
Expected: PASS, 15 tests

- [ ] **Step 5: Run the whole suite and the coverage gate**

Run: `bun run test:coverage`
Expected: the gate names only `src` paths; `ui/` never appears. On Windows, 11 pre-existing path-separator failures remain and are unrelated to this work.

- [ ] **Step 6: Commit**

```bash
git add ui/server.js test/ui-server.test.js
git commit -m "feat: accept and reject a candidate from the UI"
```

---

### Task 7: The Projects screen

**Files:**
- Create: `ui/public/index.html`, `ui/public/app.css`, `ui/public/dom.js`, `ui/public/api.js`, `ui/public/projects.js`, `ui/start.js`

**Interfaces:**
- Consumes: every endpoint from Tasks 3–6.
- Produces: `el(tag, props, children): Element`; `call(path, options): Promise<object>`; `stream(path, payload, onEvent): Promise<void>`.

- [ ] **Step 1: Write `ui/public/dom.js`**

```js
// Every string rendered here -- titles, fact statements, drafted prose --
// comes out of project markdown, which this page does not control. The page
// also holds a token that can spawn processes and write files, and it is
// reachable from the tailnet. So nothing is ever assigned to innerHTML:
// injection here would be privilege escalation, not defacement.

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (key === "text") {
      node.textContent = value;
    } else if (key === "on") {
      for (const [event, handler] of Object.entries(value)) {
        node.addEventListener(event, handler);
      }
    } else if (key === "data") {
      for (const [name, item] of Object.entries(value)) {
        node.dataset[name] = item;
      }
    } else {
      node.setAttribute(key, value);
    }
  }

  for (const child of [].concat(children)) {
    node.append(child);
  }

  return node;
}

export function clear(node) {
  while (node.firstChild) {
    node.firstChild.remove();
  }
}
```

- [ ] **Step 2: Write `ui/public/api.js`**

```js
// The token arrives once in the URL and lives in sessionStorage from then on,
// so it is never a cookie and never forgeable from another origin.
const fromUrl = new URL(location.href).searchParams.get("t");
if (fromUrl) {
  sessionStorage.setItem("story-token", fromUrl);
  history.replaceState({}, "", location.pathname);
}

const token = () => sessionStorage.getItem("story-token") ?? "";

export async function call(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.headers ?? {}), "X-Story-Token": token(), "content-type": "application/json" }
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with ${response.status}`);
  }
  return body;
}

export async function stream(path, payload, onEvent) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "X-Story-Token": token(), "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let carry = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    carry += decoder.decode(value, { stream: true });
    const lines = carry.split("\n");
    carry = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim() !== "") {
        onEvent(JSON.parse(line));
      }
    }
  }
}
```

- [ ] **Step 3: Write `ui/public/index.html`**

```html
<meta charset="utf-8">
<title>Cord House</title>
<link rel="stylesheet" href="/app.css">
<main id="app"></main>
<script type="module" src="/projects.js"></script>
```

- [ ] **Step 4: Write `ui/public/projects.js`**

```js
import { call } from "./api.js";
import { clear, el } from "./dom.js";

const app = document.querySelector("#app");

function checksLabel(checks) {
  const failing = [checks?.validate, checks?.links, checks?.continuity].filter((check) => check && !check.ok);
  return failing.length === 0 ? "clean" : `${failing.length} failing`;
}

function row(project, open) {
  return el("tr", { data: { id: project.id }, on: { click: () => open(project) } }, [
    el("td", { text: project.title }),
    el("td", { class: "num", text: String(project.chapters ?? "") }),
    el("td", { class: "num", text: (project.words ?? 0).toLocaleString() }),
    el("td", { text: checksLabel(project.checks) })
  ]);
}

async function open(project) {
  const { openControlRoom } = await import("./control-room.js");
  const next = `chapter-${String((project.chapters ?? 0) + 1).padStart(2, "0")}`;
  openControlRoom(project.id, next, project.pov ?? "");
}

export async function render() {
  const { projects } = await call("/api/projects");
  const detailed = await Promise.all(projects.map(async (project) => ({
    ...project, ...(await call(`/api/project/${project.id}`))
  })));

  const input = el("input", { name: "path", placeholder: "Paste a project folder path", size: "60" });
  const form = el("form", {
    on: {
      submit: async (event) => {
        event.preventDefault();
        try {
          await call("/api/projects", { method: "POST", body: JSON.stringify({ path: input.value }) });
          render();
        } catch (error) {
          form.append(el("p", { class: "error", text: error.message }));
        }
      }
    }
  }, [input, el("button", { text: "Open" })]);

  clear(app);
  app.append(
    el("h1", { text: "Projects" }),
    form,
    el("table", {}, [
      el("thead", {}, el("tr", {}, ["Novel", "Chapters", "Words", "Checks"].map((label) => el("th", { text: label })))),
      el("tbody", {}, detailed.map((project) => row(project, open)))
    ])
  );
}

render();
```

- [ ] **Step 5: Write `ui/public/app.css`**

```css
:root { --ground: #faf8f4; --raised: #f3ece0; --ink: #22201c; --muted: #8a8377; --rule: #ddd6c8; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --ground: #171614; --raised: #1f1d1a; --ink: #e8e3d8; --muted: #8f887c; --rule: #3a3630; }
}
body { background: var(--ground); color: var(--ink); font: 15px/1.55 "IBM Plex Serif", Georgia, serif; margin: 2rem; }
h1 { font-size: 1.4rem; letter-spacing: -.01em; }
table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
th, td { text-align: left; padding: .5rem .75rem; border-bottom: 1px solid var(--rule); }
th { font: 500 11px/1 "IBM Plex Mono", ui-monospace, monospace; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
.num { text-align: right; font-variant-numeric: tabular-nums; }
tbody tr:hover { background: var(--raised); cursor: pointer; }
.error { color: #a33; font-size: 13px; }
```

- [ ] **Step 6: Write `ui/start.js`**

```js
#!/usr/bin/env node
// Entry point. Prints the URL with the token in it, which is the only way the
// token reaches a browser.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./server.js";
import { readOrCreateToken } from "./token.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const token = readOrCreateToken(here);
const host = process.env.STORY_UI_HOST ?? "0.0.0.0";
const port = Number(process.env.STORY_UI_PORT ?? 4310);

startServer({ host, port, token }).then(({ url }) => {
  console.log(`Story UI on ${url}`);
}).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
```

- [ ] **Step 7: Verify in the browser**

Run the server from an ordinary terminal, **not** from inside a Claude Code session, because the harness needs a clean environment:

```bash
node ui/start.js
```

Open the printed URL. Register `C:\Users\kenny\projects\a-cord-for-every-debt`. Confirm the row reports 10 chapters, 12,138 words, and `clean`.

- [ ] **Step 8: Commit**

```bash
git add ui/public ui/start.js
git commit -m "feat: Projects screen and the UI entry point"
```

---

### Task 8: The Control Room screen

**Files:**
- Create: `ui/public/control-room.js`
- Modify: `ui/public/app.css`

**Interfaces:**
- Consumes: `call`, `stream` (Task 7); `el`, `clear` (Task 7).
- Produces: `openControlRoom(id, chapter, pov): Promise<void>`.

- [ ] **Step 1: Write `ui/public/control-room.js`**

```js
import { call, stream } from "./api.js";
import { clear, el } from "./dom.js";

const app = document.querySelector("#app");

// Field names verified against a real projection rather than assumed. The
// shape is: { pov, knowledge: { knows, believes, suspects, doubts,
// misbelieves }, excluded: { facts, reason } }, where each knowledge entry is
// { fact, statement, learned-in, confidence?, source? } and excluded.facts is
// a count, not a list -- the redaction is visible as a redaction.
function list(items) {
  return items.length === 0
    ? el("ul", {}, el("li", { class: "empty", text: "nothing recorded" }))
    : el("ul", {}, items.map((item) => el("li", {}, [
      el("span", { text: item.statement }),
      ...(item.confidence ? [el("span", { class: "confidence", text: ` (${item.confidence})` })] : [])
    ])));
}

function grid(projection) {
  const knowledge = projection.knowledge ?? {};
  const held = (knowledge.believes ?? []).concat(knowledge.suspects ?? []);

  return el("aside", { class: "knowledge" }, [
    el("p", {
      class: "withheld",
      text: `${projection.excluded?.facts ?? 0} facts withheld from this POV`
    }),
    el("h3", { text: "Knows" }),
    list(knowledge.knows ?? []),
    el("h3", { text: "Believes / suspects" }),
    list(held),
    el("h3", { text: "Must not happen" }),
    el("p", {
      class: "constraint",
      text: `${projection.pov} must not learn, infer, or be told anything beyond this.`
    })
  ]);
}

export async function openControlRoom(id, chapter, pov) {
  const projection = await call(`/api/project/${id}/context?chapter=${chapter}&pov=${pov}`);

  const draft = el("div", { id: "draft" });
  const note = el("span", { id: "note", text: "nothing has changed yet" });
  const accept = el("button", { text: "Accept", disabled: "disabled" });
  const harness = el("select", {}, ["codex", "claude", "gemini"].map((name) => el("option", { text: name })));

  const go = el("button", {
    text: "Draft",
    on: {
      click: async () => {
        draft.textContent = "";
        await stream(`/api/project/${id}/draft`, { chapter, pov, harness: harness.value }, (event) => {
          if (event.type === "chunk") {
            draft.textContent += event.text;
          }
          if (event.type === "error") {
            note.textContent = event.text;
          }
          if (event.type === "done") {
            accept.removeAttribute("disabled");
            note.textContent = `${event.words} words drafted, nothing accepted yet`;
          }
        });
      }
    }
  });

  clear(app);
  app.append(el("div", { class: "room" }, [
    el("section", { class: "prose" }, [
      el("h2", { text: `${chapter} · POV ${pov}` }),
      draft,
      el("p", { class: "actions" }, [harness, go, accept, note])
    ]),
    grid(projection)
  ]));
}
```

- [ ] **Step 2: Add the layout to `ui/public/app.css`**

```css
.room { display: grid; grid-template-columns: minmax(0, 34rem) minmax(0, 22rem); gap: 2.5rem; align-items: start; }
.prose h2 { font: 500 11px/1 "IBM Plex Mono", ui-monospace, monospace; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
.prose #draft { white-space: pre-wrap; min-height: 12rem; border-left: 2px solid var(--rule); padding-left: 1rem; }
.actions { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; margin-top: 1rem; }
.actions #note { color: var(--muted); font-size: 13px; }
.knowledge { font: 13px/1.5 "IBM Plex Mono", ui-monospace, monospace; }
.knowledge h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: .25rem; }
.knowledge ul { list-style: none; padding: 0; margin: 0 0 1rem; }
.knowledge li { padding: .15rem 0; }
.knowledge .empty, .withheld, .confidence { color: var(--muted); }
.constraint { border-left: 2px solid var(--rule); padding-left: .75rem; }
@media (max-width: 60rem) { .room { grid-template-columns: 1fr; } }
```

- [ ] **Step 3: Verify in the browser**

With the server running from an ordinary terminal, open the novel and click into the Control Room. These are the measured values for `chapter-10` from Chimpu's POV, so the grid is checkable rather than merely "populated":

| Panel | Expected |
|-------|----------|
| Knows | 6 entries, one of them "Atahualpa holds the northern army" |
| Believes / suspects | 3 entries; "Strangers with iron came ashore in the north" carries `(low)` |
| Withheld | `3 facts withheld from this POV` |

If any panel is empty, the field names have drifted from the projection — read the real shape again before changing the markup.

Then press Draft with `codex` selected and confirm prose arrives incrementally rather than in one block at the end.

- [ ] **Step 4: Commit**

```bash
git add ui/public
git commit -m "feat: Control Room screen with live drafting against the knowledge grid"
```

---

## Verification of the whole slice

- [ ] `bun test test/ui-harness.test.js test/ui-server.test.js` passes.
- [ ] `bun run test:coverage` names only `src` paths; `ui/` never appears in the gate's output.
- [ ] `node ui/start.js` from an ordinary terminal prints a URL carrying a token.
- [ ] That URL with the token removed returns 401 from every `/api` route.
- [ ] `grep -r innerHTML ui/public` returns nothing.
- [ ] A draft with `codex` writes prose into the candidate and leaves its frontmatter byte-for-byte as scaffolded.
- [ ] `claude` as harness succeeds when the server runs outside a Claude Code session — the one measurement that could not be taken during planning.
