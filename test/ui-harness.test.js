import { describe, expect, test } from "bun:test";
import { buildSpawn, extractText, harnessNames } from "../ui/harness.js";

// Mirrors ui/harness.js's private DRAFT_INSTRUCTION constant. Duplicated
// rather than imported (it is not exported) so the argv checks below pin the
// literal fixed text -- a change to the instruction, like a change to any
// other fixed arg, has to touch this test file on purpose.
const DRAFT_INSTRUCTION = "Write the chapter described by the JSON packet on stdin. Output prose only.";

describe("harness table", () => {
  test("names only the harnesses the table declares", () => {
    expect(harnessNames().sort()).toEqual(["claude", "codex", "gemini"]);
  });

  test("refuses a key that is not in the table", () => {
    expect(() => buildSpawn("curl")).toThrow("Unknown harness: curl");
    expect(() => buildSpawn("")).toThrow("Unknown harness:");
  });

  test("strips the nesting guard from the child environment", () => {
    const { env } = buildSpawn("claude");
    expect("CLAUDECODE" in env).toBe(false);
    expect("CLAUDE_CODE_ENTRYPOINT" in env).toBe(false);
  });

  test("copies process.env instead of mutating it", () => {
    // The shipped code builds a fresh allowlisted object rather than ever
    // deleting keys from process.env itself. A regression to mutating
    // process.env in place would still pass every other test in this file
    // (they only ever inspect the returned env) while permanently stripping
    // CLAUDECODE from the live server process, breaking the nested-launch
    // guard for good.
    const hadClaudecode = Object.prototype.hasOwnProperty.call(process.env, "CLAUDECODE");
    const previousClaudecode = process.env.CLAUDECODE;
    process.env.CLAUDECODE = "1";

    try {
      const { env } = buildSpawn("claude");
      expect("CLAUDECODE" in env).toBe(false);
      expect(process.env.CLAUDECODE).toBe("1");
    } finally {
      if (hadClaudecode) {
        process.env.CLAUDECODE = previousClaudecode;
      } else {
        delete process.env.CLAUDECODE;
      }
    }
  });

  test("builds argv from the table alone", () => {
    const { command, args } = buildSpawn("codex");
    expect(command).toBe("codex");
    expect(args.every((arg) => typeof arg === "string")).toBe(true);
    expect(args).toContain("exec");

    // The checks above would still pass if an arg were dropped, reordered, or
    // lost its quoting -- exactly what shell:true makes dangerous, since argv
    // is concatenated unescaped (Node DEP0190). Pin the full argv, in order,
    // for every harness so a change to the table has to be deliberate.
    // codex's -s read-only is defence in depth for the packet-only guarantee
    // (it still permits reads; the real defence is runDraft's empty cwd) --
    // see ui/harness.js.
    expect(args).toEqual(["exec", "--json", "--skip-git-repo-check", "-s", "read-only", `"${DRAFT_INSTRUCTION}"`]);

    const claudeSpawn = buildSpawn("claude");
    expect(claudeSpawn.command).toBe("claude");
    expect(claudeSpawn.args).toEqual([
      "-p", `"${DRAFT_INSTRUCTION}"`,
      "--output-format", "stream-json",
      "--verbose",
      "--no-session-persistence",
      "--disallowedTools", "\"Bash Edit Write Read Glob Grep WebFetch WebSearch Task\""
    ]);

    const geminiSpawn = buildSpawn("gemini");
    expect(geminiSpawn.command).toBe("gemini");
    // --approval-mode plan is the same defence in depth as codex's -s
    // read-only above.
    expect(geminiSpawn.args).toEqual([
      "-p", `"${DRAFT_INSTRUCTION}"`,
      "--output-format", "stream-json",
      "--approval-mode", "plan"
    ]);
  });

  test("hands the child a reduced environment, not a copy of the whole parent", () => {
    // A stand-in for anything a real developer's environment might hold that
    // has no business reaching a process whose only job is to read a JSON
    // packet on stdin -- a cloud credential, an unrelated API key, an NPM
    // token. If buildSpawn ever regresses to `{ ...process.env }`, this
    // leaks straight through.
    const hadMarker = Object.prototype.hasOwnProperty.call(process.env, "STORY_SKILLS_TEST_SECRET");
    process.env.STORY_SKILLS_TEST_SECRET = "should-not-reach-the-child";

    try {
      const { env } = buildSpawn("claude");
      expect("STORY_SKILLS_TEST_SECRET" in env).toBe(false);
      // Not just that one marker: the whole point is an allowlist, so the
      // child's environment must be meaningfully smaller than the parent's,
      // not merely missing the one key this test happens to check.
      expect(Object.keys(env).length).toBeLessThan(Object.keys(process.env).length);
    } finally {
      if (!hadMarker) {
        delete process.env.STORY_SKILLS_TEST_SECRET;
      }
    }
  });

  test("pulls prose out of each harness's own line shape", () => {
    expect(extractText("codex", JSON.stringify({
      type: "item", item: { type: "agent_message", text: "She had the copy off the frame." }
    }))).toBe("She had the copy off the frame.");

    expect(extractText("claude", JSON.stringify({
      type: "assistant", message: { content: [{ type: "text", text: "The light went." }] }
    }))).toBe("The light went.");

    expect(extractText("gemini", JSON.stringify({
      type: "assistant", text: "The room went quiet."
    }))).toBe("The room went quiet.");

    // gemini's line shape is flat ({ type, text }), unlike claude's nested
    // message.content, even though both use type: "assistant" as the
    // discriminant. A copy-paste of claude's extractor here would read the
    // wrong field and silently drop every gemini line instead of erroring.
    expect(extractText("gemini", JSON.stringify({
      type: "assistant", message: { content: [{ type: "text", text: "wrong shape" }] }
    }))).toBe("");

    // Lines carrying no prose are not errors; they are simply empty.
    expect(extractText("codex", JSON.stringify({ type: "usage", usage: {} }))).toBe("");
    expect(extractText("codex", "not json at all")).toBe("");
  });
});
