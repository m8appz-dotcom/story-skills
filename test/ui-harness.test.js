import { describe, expect, test } from "bun:test";
import { buildSpawn, extractText, harnessNames } from "../ui/harness.js";

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

  test("builds argv from the table alone", () => {
    const { command, args } = buildSpawn("codex");
    expect(command).toBe("codex");
    expect(args.every((arg) => typeof arg === "string")).toBe(true);
    expect(args).toContain("exec");
  });

  test("pulls prose out of each harness's own line shape", () => {
    expect(extractText("codex", JSON.stringify({
      type: "item", item: { type: "agent_message", text: "She had the copy off the frame." }
    }))).toBe("She had the copy off the frame.");

    expect(extractText("claude", JSON.stringify({
      type: "assistant", message: { content: [{ type: "text", text: "The light went." }] }
    }))).toBe("The light went.");

    // Lines carrying no prose are not errors; they are simply empty.
    expect(extractText("codex", JSON.stringify({ type: "usage", usage: {} }))).toBe("");
    expect(extractText("codex", "not json at all")).toBe("");
  });
});
