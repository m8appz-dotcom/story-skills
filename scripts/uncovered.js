#!/usr/bin/env node
// Development helper: print the uncovered lines of src/, grouped into runs and
// annotated with the source, so a coverage gap points at the branch that needs
// a test rather than at a line number.
import fs from "node:fs";
import path from "node:path";

const lcovPath = process.argv[2] ?? "coverage/lcov.info";
const only = process.argv[3];

const records = new Map();
let current = null;

for (const line of fs.readFileSync(lcovPath, "utf8").split(/\r?\n/)) {
  if (line.startsWith("SF:")) {
    current = { file: line.slice(3), lines: [], functions: [] };
  } else if (line.startsWith("DA:") && current) {
    const [number, hits] = line.slice(3).split(",");
    if (hits === "0") {
      current.lines.push(Number(number));
    }
  } else if (line.startsWith("FNDA:") && current) {
    const [hits, name] = line.slice(5).split(",");
    if (hits === "0") {
      current.functions.push(name);
    }
  } else if (line === "end_of_record" && current) {
    records.set(current.file, current);
    current = null;
  }
}

const ordered = [...records.values()]
  .filter((record) => record.lines.length > 0 || record.functions.length > 0)
  .filter((record) => !only || path.basename(record.file) === only)
  .sort((left, right) => right.lines.length - left.lines.length);

for (const record of ordered) {
  const name = path.basename(record.file);
  const source = fs.existsSync(record.file) ? fs.readFileSync(record.file, "utf8").split("\n") : [];
  console.log(`\n${name} — ${record.lines.length} lines, ${record.functions.length} functions`);

  if (record.functions.length > 0) {
    console.log(`  functions: ${record.functions.join(", ")}`);
  }

  const runs = [];
  for (const number of record.lines) {
    const last = runs[runs.length - 1];
    if (last && number === last[last.length - 1] + 1) {
      last.push(number);
    } else {
      runs.push([number]);
    }
  }

  for (const run of runs) {
    const label = run.length > 1 ? `${run[0]}-${run[run.length - 1]}` : `${run[0]}`;
    const text = (source[run[0] - 1] ?? "").trim().slice(0, 76);
    console.log(`  L${label.padEnd(9)} ${text}`);
  }
}
