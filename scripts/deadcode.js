#!/usr/bin/env node
// Development helper: report named functions in a source file that nothing
// references. A function nothing calls can never be covered, so a coverage gap
// that will not close under new tests is usually one of these.
import fs from "node:fs";

const target = process.argv[2];
if (!target) {
  console.error("Usage: deadcode <file.js>");
  process.exit(1);
}

const source = fs.readFileSync(target, "utf8");
const declarations = [...source.matchAll(/^(?:export )?function ([A-Za-z0-9_$]+)\s*\(/gm)];

console.log(`${declarations.length} named functions in ${target}`);

const unreferenced = [];

for (const [, name] of declarations) {
  const word = new RegExp(`\\b${name}\\b`, "g");
  const uses = [...source.matchAll(word)].length;
  const defined = [...source.matchAll(new RegExp(`^(?:export )?function ${name}\\s*\\(`, "gm"))].length;

  // A declaration mentions its own name once; anything beyond that is a use.
  if (uses - defined === 0) {
    unreferenced.push(name);
  }
}

console.log(unreferenced.length > 0
  ? `never referenced: ${unreferenced.join(", ")}`
  : "every named function is referenced");
