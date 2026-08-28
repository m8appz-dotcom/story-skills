import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tokenMatches } from "./token.js";
import { checkProjectContinuity, contextProjection, projectReport, scanProject, validateLinks, validateProject } from "../src/story.js";
import { harnessNames } from "./harness.js";
import { listProjects, registerRoot, resolveRoot } from "./projects.js";
import { runDraft } from "./draft.js";

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

function readBody(request) {
  return new Promise((resolve) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); }
    });
  });
}

function sendStatic(response, urlPath) {
  const name = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
  const file = path.join(PUBLIC, name);

  // The real containment happens upstream of this function: new URL() in
  // createServer() collapses "..", "%2e%2e", and backslash segments out of
  // url.pathname before urlPath ever reaches here, and path.join (not
  // path.resolve) never lets a segment in `name` reset the join onto a
  // different root. This check is a backstop for whatever that pipeline
  // does not cover -- a later refactor that swaps in path.resolve, a route
  // that builds `name` some other way, a symlink inside PUBLIC pointing
  // outward -- not the primary defense. A plain `file.startsWith(PUBLIC)`
  // would not even do that job: it is satisfied by a sibling directory that
  // merely shares the prefix, like "public-evil", so it would wave an
  // escape through while looking like it blocks one. path.relative() is the
  // real test -- reject anything that climbs out ("..") or lands on an
  // unrelated root (absolute).
  const rel = path.relative(PUBLIC, file);
  const escapesPublic = rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
  if (escapesPublic || !fs.existsSync(file)) {
    response.writeHead(404).end("Not found");
    return;
  }

  response.writeHead(200, { "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream" });
  response.end(fs.readFileSync(file));
}

// registryDir defaults to HERE (this file's own directory), which keeps
// production behaviour unchanged -- but it is a parameter, not a constant,
// so tests can point it at a throwaway directory instead of reading and
// writing the real projects.json a developer may have running locally.
export function createServer({ token, registryDir = HERE }) {
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
      sendJson(response, 200, { projects: listProjects(registryDir) });
      return;
    }

    if (url.pathname === "/api/projects" && request.method === "POST") {
      readBody(request).then((body) => {
        try {
          sendJson(response, 200, registerRoot(registryDir, String(body.path ?? "")));
        } catch (error) {
          sendJson(response, 400, { error: error.message });
        }
      });
      return;
    }

    // Every route below that resolves a registered project id must go through
    // this same registryDir -- not HERE -- or it silently falls back to
    // reading/writing the production registry beside this file, which is
    // exactly the bug this parameter exists to prevent.
    const detail = url.pathname.match(/^\/api\/project\/([a-f0-9]+)$/);
    if (detail && request.method === "GET") {
      try {
        const root = resolveRoot(registryDir, detail[1]);
        const report = projectReport(root);
        const validate = validateProject(root);
        const links = validateLinks(root);
        const continuity = checkProjectContinuity(root);

        sendJson(response, 200, {
          title: report.title,
          // counts.chapters is the number. report.chapters is the array of
          // chapter objects, and report.words does not exist at all.
          chapters: report.counts.chapters,
          words: report.counts.words,
          // The Control Room needs a POV character, and a chapter that does not
          // exist yet cannot supply one. report.pov is the narrative mode
          // ("third-person-limited"), not a character, so the picker is fed from
          // the cast instead.
          characters: scanProject(root).characters.map((item) => ({ id: item.id, name: item.name })),
          // Served rather than hardcoded in the browser, so the table in
          // harness.js stays the only place a provider is named.
          harnesses: harnessNames(),
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

    const context = url.pathname.match(/^\/api\/project\/([a-f0-9]+)\/context$/);
    if (context && request.method === "GET") {
      let root;
      try {
        root = resolveRoot(registryDir, context[1]);
      } catch (error) {
        // An unregistered project id is 404.
        sendJson(response, 404, { error: error.message });
        return;
      }

      try {
        sendJson(response, 200, contextProjection(root, {
          chapter: url.searchParams.get("chapter") ?? "",
          pov: url.searchParams.get("pov") ?? ""
        }));
      } catch (error) {
        // The engine refusing the request is 400.
        sendJson(response, 400, { error: error.message });
      }
      return;
    }

    const draft = url.pathname.match(/^\/api\/project\/([a-f0-9]+)\/draft$/);
    if (draft && request.method === "POST") {
      readBody(request).then(async (body) => {
        let root;
        try {
          root = resolveRoot(registryDir, draft[1]);
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

    sendJson(response, 404, { error: "Unknown route" });
  });
}

export function startServer({ host = "127.0.0.1", port = 0, token = "", registryDir = HERE } = {}) {
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";

  if (!loopback && token === "") {
    return Promise.reject(new Error(`refusing to bind ${host} with no token`));
  }

  const server = createServer({ token, registryDir });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const bound = server.address().port;
      resolve({ server, port: bound, url: `http://${host}:${bound}/?t=${token}` });
    });
  });
}
