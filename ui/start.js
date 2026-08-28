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
