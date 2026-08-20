#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fallbackPath = path.join(repoRoot, "skills", "story-maintenance", "scripts", "story.js");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-skills-fallback-"));
const generatedPath = path.join(tempDir, "story.js");

try {
  // Run through a shell so this works on Windows too, where `bun` resolves to a
  // .cmd shim that spawnSync refuses to exec directly. Arguments are quoted
  // rather than passed separately, which keeps paths with spaces intact.
  const buildArgs = ["build", "./bin/story.js", "--target=node", `--outfile=${generatedPath}`];
  const build = spawnSync(`bun ${buildArgs.map((arg) => JSON.stringify(arg)).join(" ")}`, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: true
  });

  if (build.status !== 0) {
    process.stderr.write(build.stderr || build.stdout || `${build.error?.message ?? "bun build failed"}\n`);
    process.exit(build.status ?? 1);
  }

  const committed = fs.readFileSync(fallbackPath);
  const generated = fs.readFileSync(generatedPath);

  if (!committed.equals(generated)) {
    console.error("Bundled story-maintenance fallback is out of date.");
    console.error("Run: bun run build:fallback");
    process.exit(1);
  }

  console.log("Bundled story-maintenance fallback is up to date.");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
