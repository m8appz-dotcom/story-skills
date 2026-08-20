#!/usr/bin/env node
// Development helper, loaded with --preload. Reports array-method callbacks
// that were handed to a method but never actually invoked, because the array
// was empty (or, for sort, held fewer than two items).
//
// Line coverage cannot see these: the call itself runs, so the line counts as
// covered, and only the function total gives the gap away. This wraps the
// methods instead, which needs no parsing and cannot be fooled by nesting.
import fs from "node:fs";
import path from "node:path";
import { afterAll } from "bun:test";

const METHODS = ["map", "filter", "some", "find", "findIndex", "findLast", "every", "reduce", "reduceRight", "flatMap", "sort", "forEach"];

const passed = new Map();
const called = new Set();

for (const name of METHODS) {
  const original = Array.prototype[name];

  Object.defineProperty(Array.prototype, name, {
    configurable: true,
    writable: true,
    value: function instrumented(callback, ...rest) {
      if (typeof callback !== "function") {
        return original.call(this, callback, ...rest);
      }

      // Frame 0 is the Error, frame 1 is this wrapper, frame 2 is the caller.
      const site = (new Error().stack ?? "").split("\n")[2] ?? "";
      const key = `${name} ${site.trim()}`;

      if (!passed.has(key)) {
        passed.set(key, callback.toString().split("\n")[0]);
      }

      return original.call(this, function probe(...args) {
        called.add(key);
        return callback.apply(this, args);
      }, ...rest);
    }
  });
}

function report() {
  const misses = [...passed].filter(([key]) => !called.has(key) && key.includes("src"));

  const lines = misses.length === 0
    ? ["every array callback under src/ was invoked at least once"]
    : [`${misses.length} array callback(s) passed but never invoked:`,
      ...misses.map(([key, source]) => `  ${key}\n      ${source}`)];

  // Alongside the coverage output, which is already ignored.
  fs.mkdirSync("coverage", { recursive: true });
  fs.writeFileSync(path.join("coverage", "never-called.txt"), `${lines.join("\n")}\n`, "utf8");
}

// bun does not fire process exit hooks for a test run, but a hook registered
// from a preload runs after every file.
afterAll(report);
