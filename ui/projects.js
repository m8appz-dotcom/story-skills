import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { scanProject, validateProject } from "../src/story.js";

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
  const validation = validateProject(absolutePath);
  if (!validation.ok) {
    throw new Error(validation.errors[0]);
  }

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
