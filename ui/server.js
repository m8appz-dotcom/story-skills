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
