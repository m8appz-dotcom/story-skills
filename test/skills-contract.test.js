import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "../src/cli.js";
import { memoryIo } from "./helpers.js";

// Skills are prompts an agent follows literally. A command or flag that drifts
// out of the CLI does not fail loudly -- the agent just runs something that does
// not exist. These tests keep the documented surface and the real surface bound
// together.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Git normalises line endings per platform, so a test that asserts on a line
// break has to read past that or it fails on whichever platform loses the coin
// toss. These assertions are about content, not about how lines end.
function readText(file) {
  return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}
const skillsRoot = path.join(repoRoot, "skills");
const docsRoot = path.join(repoRoot, "docs");

function help() {
  const io = memoryIo(repoRoot);
  runCli(["--help"], io);
  return io.output();
}

function cliCommands() {
  const section = help().split("Commands:")[1].split("Options:")[0];
  return new Set([...section.matchAll(/^ {2}([a-z][a-z-]*)/gm)].map((match) => match[1]));
}

function cliFlags() {
  return new Set([...help().matchAll(/^ {2}(--[a-z][a-z-]*)/gm)].map((match) => match[1]));
}

function markdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return markdownFiles(full);
    }
    return entry.isFile() && entry.name.endsWith(".md") ? [full] : [];
  });
}

// Matches `story <command>` at the start of a shell line or inside backticks.
function referencedCommands(contents) {
  return [...contents.matchAll(/(?:^|`)story ([a-z][a-z-]*)/gm)]
    .map((match) => match[1])
    .filter((command) => command !== "init" || true);
}

// Every flag on a line that invokes the CLI, not just the first one.
function referencedFlags(contents) {
  return contents
    .split(/\r?\n/)
    .filter((line) => /(?:^|`)story [a-z]/.test(line.trim()))
    .flatMap((line) => [...line.matchAll(/(--[a-z][a-z-]*)/g)].map((match) => match[1]));
}

describe("skills stay bound to the CLI", () => {
  const commands = cliCommands();
  const flags = cliFlags();

  test("the CLI exposes the commands the v3 workflow depends on", () => {
    for (const command of [
      "state", "knowledge", "know", "context", "render-packet",
      "candidate", "candidates", "accept", "reject", "transaction", "seal-arc"
    ]) {
      expect(commands).toContain(command);
    }
  });

  for (const file of markdownFiles(skillsRoot)) {
    const relative = path.relative(repoRoot, file).split(path.sep).join("/");
    const contents = readText(file);

    test(`${relative} references only real commands`, () => {
      for (const command of referencedCommands(contents)) {
        expect(commands, `${relative} references "story ${command}"`).toContain(command);
      }
    });

    test(`${relative} references only real flags`, () => {
      for (const flag of referencedFlags(contents)) {
        expect(flags, `${relative} references "${flag}"`).toContain(flag);
      }
    });
  }

  for (const file of markdownFiles(docsRoot)) {
    const relative = path.relative(repoRoot, file).split(path.sep).join("/");
    const contents = readText(file);

    test(`${relative} references only real commands`, () => {
      for (const command of referencedCommands(contents)) {
        expect(commands, `${relative} references "story ${command}"`).toContain(command);
      }
    });
  }
});

describe("chapter-writing philosophy", () => {
  const contents = readText(path.join(skillsRoot, "chapter-writing", "SKILL.md"));

  test("frames beats as flexible and constraints as mandatory", () => {
    expect(contents).toContain("Preserve all hard constraints and required consequences");
    expect(contents).toContain("Treat scene\nintentions and candidate beats as flexible");
  });

  test("does not instruct the writer to follow every beat exactly", () => {
    expect(contents).not.toMatch(/follow every beat exactly/i);
    expect(contents).not.toMatch(/do not add anything/i);
  });

  test("keeps the candidate and canon distinction explicit", () => {
    expect(contents).toContain("cannot touch canon");
    expect(contents).toContain("A rejected candidate can never afterwards be");
  });
});
