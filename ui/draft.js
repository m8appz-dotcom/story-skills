import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import { createCandidate, renderPacket } from "../src/story.js";
import { buildSpawn, extractText } from "./harness.js";

// The packet is the entire brief. It goes on stdin because argv is not a safe
// channel here: Windows needs shell: true for the .cmd shims these CLIs
// install, and that concatenates arguments without escaping them.

const PROSE_HEADING = "## Chapter Text";

export async function* runDraft({ root, chapter, pov, harness, spawnImpl = nodeSpawn }) {
  // Validate the harness before touching the project at all. A bad harness
  // name is a fact about the request, not about this project's POV data, and
  // it must be reported as itself -- not masked by whatever renderPacket
  // would have thrown first for an unrelated reason (e.g. no matching POV
  // character on a minimal seed project).
  let command;
  try {
    command = buildSpawn(harness);
  } catch (error) {
    yield { type: "error", text: error.message };
    return;
  }

  let packet;
  let file;

  try {
    // renderPacket takes the project root itself and scans internally
    // (mirrors contextProjection's own call shape in ui/server.js); it must
    // not be handed an already-scanned project object here.
    packet = renderPacket(root, { chapter, pov }).packet;
    file = createCandidate(root, { chapter, title: chapter, pov }).file;
  } catch (error) {
    yield { type: "error", text: error.message };
    return;
  }

  const child = spawnImpl(command.command, command.args, {
    env: command.env,
    shell: true,
    stdio: ["pipe", "pipe", "pipe"]
  });

  // This is the entire channel: the render packet, and nothing else. No
  // project path, no file access, no manuscript. The packet is already a
  // POV-safe projection -- a side channel here would let a character be
  // written knowing something they must not know.
  child.stdin.end(JSON.stringify(packet));

  let stderr = "";
  child.stderr.on("data", (data) => { stderr += data; });

  // The spec called for a 503 when a harness is not on PATH. It cannot be one:
  // by the time spawn fails the response is already a 200 stream. A missing
  // binary surfaces here instead, named, as the stream's error event.
  child.on("error", (error) => { stderr += `${harness} could not be started: ${error.message}\n`; });

  const exit = new Promise((resolve) => child.on("close", resolve));

  let prose = "";
  let carry = "";

  // Both a complete line inside the loop and the leftover fragment flushed
  // after it (below) must extract text the same way, or they would drift
  // into two implementations of the same rule.
  function consumeLine(line) {
    const text = extractText(harness, line);
    if (text === "") return null;
    prose += text;
    return { type: "chunk", text };
  }

  for await (const data of child.stdout) {
    carry += data;
    const lines = carry.split("\n");
    carry = lines.pop() ?? "";

    for (const line of lines) {
      const event = consumeLine(line);
      if (event) yield event;
    }
  }

  // A harness that ends its final write without a trailing newline leaves a
  // complete line sitting unprocessed in `carry` -- e.g. the end of the
  // model's last sentence. Without this flush that text vanishes from both
  // the stream and the candidate file while `{type: "done"}` still reports
  // success.
  if (carry !== "") {
    const event = consumeLine(carry);
    if (event) yield event;
  }

  const code = await exit;

  if (code !== 0) {
    yield { type: "error", text: stderr.trim() || `harness exited with ${code}` };
    return;
  }

  // Prose replaces only what follows the heading. The frontmatter the scaffold
  // wrote is never touched: narrative state is the engine's to set at acceptance.
  const markdown = fs.readFileSync(file, "utf8");
  const head = markdown.split(PROSE_HEADING)[0];
  fs.writeFileSync(file, `${head}${PROSE_HEADING}\n\n${prose.trim()}\n`, "utf8");

  yield { type: "done", candidateFile: file, words: prose.trim().split(/\s+/).filter(Boolean).length };
}
