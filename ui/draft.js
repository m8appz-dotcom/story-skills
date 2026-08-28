import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  let candidate;

  try {
    // renderPacket takes the project root itself and scans internally
    // (mirrors contextProjection's own call shape in ui/server.js); it must
    // not be handed an already-scanned project object here.
    packet = renderPacket(root, { chapter, pov }).packet;
    // The browser needs this id to call accept/reject -- it has no business
    // parsing one back out of the absolute server-side path in `file`.
    ({ file, candidate } = createCandidate(root, { chapter, title: chapter, pov }));
  } catch (error) {
    yield { type: "error", text: error.message };
    return;
  }

  // The packet-only guarantee does not hold just because the packet is the
  // only thing on stdin: a model with file tools can still use them against
  // whatever the child's cwd happens to be. Give it a freshly created, empty
  // directory instead of inheriting this server's own cwd (which sits inside
  // the repo and can see the real manuscript, and see ui/projects.json,
  // which maps every registered project id to its absolute root). A model
  // with tools that ignore the sandbox/approval-mode flags above still finds
  // nothing here worth reading. `file` below is always absolute (createCandidate
  // builds it from scanProject's path.resolve()'d root), and every fs call in
  // this function runs in this server process, not the child, so none of it
  // depends on this process's own cwd -- moving only the child's cwd cannot
  // break the read/write of the candidate file.
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-draft-"));

  try {
    const child = spawnImpl(command.command, command.args, {
      cwd: scratchDir,
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
    try {
      const markdown = fs.readFileSync(file, "utf8");
      const head = markdown.split(PROSE_HEADING)[0];
      fs.writeFileSync(file, `${head}${PROSE_HEADING}\n\n${prose.trim()}\n`, "utf8");
    } catch (error) {
      // The drafted prose only ever lived in the `prose` variable above --
      // if it cannot be read back or written now (disk full, permissions,
      // the file removed mid-run), the draft is gone. Report that the same
      // way every other failure in this generator is reported, instead of
      // throwing out of an async generator with nothing downstream watching
      // for it.
      yield { type: "error", text: `could not save the draft: ${error.message}` };
      return;
    }

    yield {
      type: "done",
      candidateFile: file,
      candidate,
      words: prose.trim().split(/\s+/).filter(Boolean).length
    };
  } finally {
    // Best-effort cleanup: a failure to delete this scratch directory (e.g.
    // a transient Windows file lock right after the child exits) must never
    // override -- and thereby hide -- whatever this generator already
    // yielded above as the run's real outcome.
    try {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    } catch {
      // Nothing more useful to do with a cleanup failure than ignore it --
      // it is an OS temp directory, not project data.
    }
  }
}
