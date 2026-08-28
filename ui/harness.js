// The one place a provider is named. Everything else addresses a harness by
// key, so adding one is a table entry and nothing else.
//
// argv is fixed table content on purpose. Windows needs shell: true to run the
// .cmd shims these CLIs install, and shell: true concatenates arguments without
// escaping them (Node DEP0190) -- so the payload travels on stdin, never here.

const DRAFT_INSTRUCTION = "Write the chapter described by the JSON packet on stdin. Output prose only.";

export const HARNESSES = Object.freeze({
  claude: Object.freeze({
    command: "claude",
    args: Object.freeze([
      "-p", `"${DRAFT_INSTRUCTION}"`,
      "--output-format", "stream-json",
      "--verbose",
      "--no-session-persistence",
      // The packet is the whole world the drafter gets; tools would be a side channel.
      "--disallowedTools", "\"Bash Edit Write Read Glob Grep WebFetch WebSearch Task\""
    ]),
    extract: (parsed) => parsed?.type === "assistant"
      ? (parsed.message?.content ?? []).filter((part) => part?.type === "text").map((part) => part.text).join("")
      : ""
  }),
  codex: Object.freeze({
    command: "codex",
    args: Object.freeze(["exec", "--json", "--skip-git-repo-check", `"${DRAFT_INSTRUCTION}"`]),
    extract: (parsed) => parsed?.type === "item" && parsed.item?.type === "agent_message"
      ? String(parsed.item.text ?? "")
      : ""
  }),
  gemini: Object.freeze({
    command: "gemini",
    args: Object.freeze(["-p", `"${DRAFT_INSTRUCTION}"`, "--output-format", "stream-json"]),
    extract: (parsed) => parsed?.type === "assistant" ? String(parsed.text ?? "") : ""
  })
});

// Claude Code refuses to launch inside another Claude Code session, and the
// check reads the environment. A server started from inside one would fail
// every draft until these are gone.
const INHERITED_GUARDS = ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"];

export function harnessNames() {
  return Object.keys(HARNESSES);
}

export function buildSpawn(name) {
  const harness = Object.prototype.hasOwnProperty.call(HARNESSES, name) ? HARNESSES[name] : undefined;

  if (!harness) {
    throw new Error(`Unknown harness: ${name}`);
  }

  const env = { ...process.env };
  for (const guard of INHERITED_GUARDS) {
    delete env[guard];
  }

  return { command: harness.command, args: [...harness.args], env };
}

export function extractText(name, line) {
  const harness = Object.prototype.hasOwnProperty.call(HARNESSES, name) ? HARNESSES[name] : undefined;

  if (!harness) {
    return "";
  }

  try {
    return harness.extract(JSON.parse(line)) ?? "";
  } catch {
    // Harnesses interleave progress chatter that is not JSON. Not an error.
    return "";
  }
}
