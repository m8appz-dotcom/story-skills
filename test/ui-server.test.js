import { describe, expect, test, afterAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { createStoryProject, scanProject, createEntity } from "../src/story.js";
import { startServer } from "../ui/server.js";
import { tokenMatches } from "../ui/token.js";
import { makeTempDir } from "./helpers.js";

const TOKEN = "test-token-0123456789";

// A throwaway registryDir per test run, instead of the server's own ui/
// directory -- so running this suite can never delete or overwrite the real
// projects.json a developer might have registered against a locally-running
// server.
const started = await startServer({ host: "127.0.0.1", port: 0, token: TOKEN, registryDir: makeTempDir() });
afterAll(() => {
  started.server.close();
});

function get(path, token) {
  return fetch(`http://127.0.0.1:${started.port}${path}`,
    token ? { headers: { "X-Story-Token": token } } : undefined);
}

describe("token", () => {
  // Renamed from "compares without leaking length or content": that name
  // implied timing safety had been measured here. It has not -- this only
  // asserts the observable match/no-match booleans, same as below.
  test("matches an equal token and rejects unequal, empty, or missing ones", () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(tokenMatches(TOKEN, "wrong")).toBe(false);
    expect(tokenMatches(TOKEN, "")).toBe(false);
    expect(tokenMatches(TOKEN, undefined)).toBe(false);
  });

  test("rejects tokens a length-only or window-only comparison would wrongly accept", () => {
    // "wrong" above differs from TOKEN in length as well as content, so a
    // buggy implementation that only checked expected.length === given.length
    // (never actually comparing bytes) would still fail it, for the wrong
    // reason. Use a wrong token of the *same* length so this can only pass
    // if content is genuinely compared.
    const sameLengthWrong = `${"x".repeat(TOKEN.length - 1)}!`;
    expect(sameLengthWrong).not.toBe(TOKEN);
    expect(sameLengthWrong.length).toBe(TOKEN.length);
    expect(tokenMatches(TOKEN, sameLengthWrong)).toBe(false);

    // tokenMatches pads both sides to a fixed 128-byte window before calling
    // timingSafeEqual, then separately checks the real (unpadded) lengths
    // match. Build a "given" whose first 128 bytes are byte-for-byte
    // identical to TOKEN's padded window but which is actually far longer
    // than TOKEN -- if the trailing expected.length === given.length check
    // were ever dropped, timingSafeEqual alone would call this a match.
    const smuggled = `${TOKEN.padEnd(128, "\0")}extra-bytes-past-the-window`;
    expect(smuggled.length).toBeGreaterThan(128);
    expect(tokenMatches(TOKEN, smuggled)).toBe(false);
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

describe("static containment", () => {
  test("404s a path with no matching file under public", async () => {
    expect((await get("/nope.html")).status).toBe(404);
  });

  test("404s dot-dot segments instead of resolving them outside public", async () => {
    // new URL() collapses ".." at the root before sendStatic ever sees it,
    // so this can only ever name a (nonexistent) file inside public -- a
    // regression here would mean ui/server.js itself gets served instead.
    expect((await get("/../ui/server.js")).status).toBe(404);
  });

  test("404s a backslash traversal segment the same way as a forward slash one", async () => {
    // WHATWG URL treats "\" as a path separator for http(s) URLs, so this
    // normalises the same way as the dot-dot case above rather than reaching
    // ui/server.js as a literal filename.
    expect((await get("/..\\ui\\server.js")).status).toBe(404);
  });

  test("404s url-encoded dot-dot-slash instead of decoding it into a traversal", async () => {
    // %2f is never decoded back into a real separator by the URL parser, so
    // "%2e%2e%2fserver.js" can only ever be looked up as one literal
    // (nonexistent) filename containing percent signs, not a path that
    // climbs out of public.
    expect((await get("/%2e%2e%2fserver.js")).status).toBe(404);
  });
});

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

    const registered = await created.json();
    const { id } = registered;
    expect(typeof id).toBe("string");
    // The registry stores the title too, and it must be the real one: the
    // field this used to read does not exist on a scanned project.
    expect(registered.title).toBe("Registry Novel");
    // The id is opaque: not the story id, and not the path.
    expect(id).not.toBe(scanProject(root).storyId);
    expect(id).not.toContain(root);

    const detail = await get(`/api/project/${id}`, TOKEN);
    expect(detail.status).toBe(200);

    const body = await detail.json();
    expect(body.title).toBe("Registry Novel");
    // A count, not the array of chapter objects.
    expect(typeof body.chapters).toBe("number");
    expect(typeof body.words).toBe("number");
    expect(Array.isArray(body.characters)).toBe(true);
    expect(body.harnesses).toEqual(["claude", "codex", "gemini"]);
    expect(body.checks.validate.ok).toBe(true);
    expect(body.checks.links.ok).toBe(true);
    expect(body.checks.continuity.ok).toBe(true);
  });

  test("refuses an unknown project id", async () => {
    expect((await get("/api/project/deadbeef", TOKEN)).status).toBe(404);
  });

  test("registers a structurally-valid project even when its content fails validation", async () => {
    const cwd = makeTempDir();
    const { root } = createStoryProject({ cwd, title: "Mid Revision Novel", force: false });

    // Break content validation (an unsupported enum value) without removing
    // or renaming any required file -- this project must still register,
    // because a real novel mid-revision looks exactly like this: structurally
    // a project, but not yet a valid one.
    const storyFile = path.join(root, "story.md");
    fs.writeFileSync(storyFile, fs.readFileSync(storyFile, "utf8").replace("status: planning", "status: not-a-real-status"), "utf8");

    const created = await post("/api/projects", { path: root });
    expect(created.status).toBe(200);

    const { id } = await created.json();
    const detail = await get(`/api/project/${id}`, TOKEN);
    expect(detail.status).toBe(200);

    // The content error must surface through the detail endpoint rather than
    // block registration -- that surfacing is the entire point of gating
    // registration on structure instead of full validateProject().
    const body = await detail.json();
    expect(body.checks.validate.ok).toBe(false);
    expect(body.checks.validate.errors.some((error) => error.includes("status"))).toBe(true);
  });
});

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

  test("refuses an unknown project id", async () => {
    expect((await get("/api/project/deadbeef/context", TOKEN)).status).toBe(404);
  });

  test("refuses an unknown POV", async () => {
    const { id } = await seeded("No POV", () => {});
    expect((await get(`/api/project/${id}/context?chapter=chapter-99&pov=nobody`, TOKEN)).status).toBe(400);
  });
});

import { runDraft } from "../ui/draft.js";
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
import fsNode from "node:fs";

function stubSpawn(lines, { code = 0, stderr = [], finalNewline = true } = {}) {
  return () => {
    const child = new EventEmitter();
    const chunks = lines.map((line) => `${JSON.stringify(line)}\n`);
    // Real harnesses do not guarantee a trailing newline on their last write.
    // Tests that need to prove the leftover-buffer flush (draft.js's `carry`)
    // opt out of the newline this stub otherwise appends to every line.
    if (!finalNewline && chunks.length > 0) {
      chunks[chunks.length - 1] = chunks[chunks.length - 1].replace(/\n$/, "");
    }
    child.stdout = Readable.from(chunks);
    child.stderr = Readable.from(stderr);
    child.stdin = new Writable({ write(chunk, encoding, done) { done(); } });
    child.stdout.on("end", () => setImmediate(() => child.emit("close", code)));
    return child;
  };
}

// Unlike stubSpawn (always one chunk per JSON line), this hands stdout exactly
// the chunk boundaries given -- proving draft.js's `carry` buffer reassembles
// a line that a single `data` event split, instead of relying on stubSpawn's
// line-aligned chunks to accidentally hide that gap.
function stubSpawnChunks(chunks, { code = 0, stderr = [] } = {}) {
  return () => {
    const child = new EventEmitter();
    child.stdout = Readable.from(chunks);
    child.stderr = Readable.from(stderr);
    child.stdin = new Writable({ write(chunk, encoding, done) { done(); } });
    child.stdout.on("end", () => setImmediate(() => child.emit("close", code)));
    return child;
  };
}

// Simulates the binary-not-on-PATH case: child_process fires "error" instead
// of a normal exit. stdout/stderr still exist (Node creates the pipes before
// the spawn itself can fail) but never produce data, and "close" still fires
// so runDraft's `exit` promise settles instead of hanging forever.
function stubSpawnError(message) {
  return () => {
    const child = new EventEmitter();
    child.stdout = Readable.from([]);
    child.stderr = Readable.from([]);
    child.stdin = new Writable({ write(chunk, encoding, done) { done(); } });
    setImmediate(() => {
      child.emit("error", new Error(message));
      child.emit("close", 1);
    });
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

  test("flushes the final line even without a trailing newline, instead of dropping it", async () => {
    const { root } = await seeded("Unterminated Draft", (dir) => {
      createEntity(dir, { kind: "character", name: "Chimpu", role: "protagonist" });
      createEntity(dir, { kind: "chapter", name: "One", number: 1, pov: "chimpu" });
    });

    const events = await collect({
      root, chapter: "chapter-01", pov: "chimpu", harness: "codex",
      spawnImpl: stubSpawn([
        { type: "item", item: { type: "agent_message", text: "The light went out." } }
      ], { finalNewline: false })
    });

    // Without the post-loop flush, this text lands in neither the stream nor
    // the file, and {type: "done"} still reports success -- the bug itself.
    const chunk = events.find((event) => event.type === "chunk");
    expect(chunk?.text).toBe("The light went out.");

    const done = events.find((event) => event.type === "done");
    expect(done).toBeDefined();
    expect(fsNode.readFileSync(done.candidateFile, "utf8")).toContain("The light went out.");
  });

  test("reassembles a JSON line split across two stdout chunks", async () => {
    const { root } = await seeded("Split Chunk Draft", (dir) => {
      createEntity(dir, { kind: "character", name: "Chimpu", role: "protagonist" });
      createEntity(dir, { kind: "chapter", name: "One", number: 1, pov: "chimpu" });
    });

    const line = `${JSON.stringify({ type: "item", item: { type: "agent_message", text: "Split across chunks." } })}\n`;
    const midpoint = Math.floor(line.length / 2);

    const events = await collect({
      root, chapter: "chapter-01", pov: "chimpu", harness: "codex",
      // A real stdout `data` event boundary has no relationship to JSON line
      // boundaries; every other stub in this file happens to align them.
      spawnImpl: stubSpawnChunks([line.slice(0, midpoint), line.slice(midpoint)])
    });

    expect(events.find((event) => event.type === "chunk")?.text).toBe("Split across chunks.");
  });

  test("reports a missing binary as an error event, not an empty success", async () => {
    const { root } = await seeded("Missing Binary", (dir) => {
      createEntity(dir, { kind: "character", name: "Chimpu", role: "protagonist" });
      createEntity(dir, { kind: "chapter", name: "One", number: 1, pov: "chimpu" });
    });

    const events = await collect({
      root, chapter: "chapter-01", pov: "chimpu", harness: "codex",
      spawnImpl: stubSpawnError("ENOENT")
    });

    // child.on("error") is the path a binary missing from PATH takes -- it
    // must surface as a named failure, never as an empty draft reported done.
    expect(events.some((event) => event.type === "done")).toBe(false);
    const error = events.find((event) => event.type === "error");
    expect(error).toBeDefined();
    expect(error.text).toContain("codex could not be started");
    expect(error.text).toContain("ENOENT");
  });
});

describe("draft endpoint", () => {
  test("streams ndjson and reports an unknown harness without launching a model", async () => {
    const { id } = await seeded("Draft Route Novel", () => {});

    const response = await post(`/api/project/${id}/draft`, { chapter: "chapter-01", pov: "", harness: "not-a-real-harness" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");

    // buildSpawn rejects the harness before runDraft ever touches the
    // project, so this exercises the route's own wiring -- regex, resolveRoot,
    // ndjson framing -- without spawning anything.
    const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    expect(lines[0].type).toBe("error");
    expect(lines[0].text).toContain("Unknown harness: not-a-real-harness");
  });

  test("refuses an unregistered project id", async () => {
    expect((await post("/api/project/deadbeef/draft", { chapter: "chapter-01", pov: "", harness: "codex" })).status).toBe(404);
  });
});
