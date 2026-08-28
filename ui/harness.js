// The one place a provider is named. Everything else addresses a harness by
// key, so adding one is a table entry and nothing else.
//
// argv is fixed table content on purpose. Windows needs shell: true to run the
// .cmd shims these CLIs install, and shell: true concatenates arguments without
// escaping them (Node DEP0190) -- so the payload travels on stdin, never here.

const DRAFT_INSTRUCTION = "Write the chapter described by the JSON packet on stdin. Output prose only.";

// Every entry below also declares `isolation`: what the Control Room tells
// the writer, at the moment they pick a harness, about what it can actually
// see. This is not decorative copy -- harnessInfo() further down refuses to
// serve a row whose `isolation` is missing or malformed, so a harness added
// later without one fails a test instead of silently reaching the browser
// looking as safe as claude's packet-only guarantee.
//   - packetOnly: true only when the sandboxing is airtight enough that the
//     packet on stdin really is the whole world (claude's --disallowedTools
//     below covers every tool, so there is no other channel).
//   - sees: the short phrase shown next to the picker. It says what the
//     harness can see, not how it is configured -- "read-only" alone would
//     read as reassuring, when the ability to read at all is exactly the
//     leak the read-only/plan-mode flags below do not close. See the
//     per-flag comments for the mechanism; `sees` is only the disclosure.
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
      : "",
    isolation: Object.freeze({ packetOnly: true, sees: "Sees only the packet." })
  }),
  codex: Object.freeze({
    command: "codex",
    args: Object.freeze([
      "exec", "--json", "--skip-git-repo-check",
      // Read-only still permits reads, which is exactly the leak the packet
      // design exists to prevent -- the defence that actually matters is
      // draft.js spawning this process with an empty cwd, so there is
      // nothing on disk worth reading. This flag is defence in depth on top
      // of that, not a substitute for it.
      "-s", "read-only",
      `"${DRAFT_INSTRUCTION}"`
    ]),
    extract: (parsed) => parsed?.type === "item" && parsed.item?.type === "agent_message"
      ? String(parsed.item.text ?? "")
      : "",
    isolation: Object.freeze({ packetOnly: false, sees: "Can also read files on this machine." })
  }),
  gemini: Object.freeze({
    command: "gemini",
    args: Object.freeze([
      "-p", `"${DRAFT_INSTRUCTION}"`,
      "--output-format", "stream-json",
      // Same reasoning as codex's -s read-only above: plan mode still
      // permits reads, so the empty-cwd defence in draft.js is what actually
      // keeps the manuscript and projects.json out of reach.
      "--approval-mode", "plan"
    ]),
    extract: (parsed) => parsed?.type === "assistant" ? String(parsed.text ?? "") : "",
    isolation: Object.freeze({ packetOnly: false, sees: "Can also read files on this machine." })
  })
});

// Claude Code refuses to launch inside another Claude Code session, and the
// check reads the environment. A server started from inside one would fail
// every draft until these are gone.
const INHERITED_GUARDS = ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"];

// The packet on stdin is supposed to be the whole world a drafting model
// gets. Handing the child a full copy of this server's own environment is a
// side channel next to that promise -- an unrelated API key, a cloud
// credential, an NPM token, anything else a developer happens to have
// exported -- and it is a live one: the sandbox/approval flags set above
// still let the CLI run ordinary read commands, which can trivially include
// printing its own environment. So build an allowlist instead of a
// deny-list, keeping only what a CLI genuinely needs to run and authenticate
// as this Windows user:
//   - PATH/Path: to find its own shim and anything it shells out to.
//   - USERPROFILE/HOME: every one of these CLIs keeps its login/session
//     state under the user's profile directory.
//   - APPDATA/LOCALAPPDATA: where npm-installed, Node-based CLIs and their
//     credential/config caches typically live on Windows.
//   - TEMP/TMP: scratch space every CLI (and Node itself) assumes exists.
//   - SystemRoot: Windows networking/TLS/crypto calls can fail in obscure
//     ways without it -- these CLIs all need working network access.
//   - ComSpec/PATHEXT: shell:true launches cmd.exe to resolve and run the
//     .cmd shim these CLIs install; both are how cmd.exe finds it.
// Names are matched case-insensitively: Windows env vars are case-insensitive
// at the OS level, but the parent process can report them in any casing.
const ALLOWED_ENV_VARS = new Set([
  "path", "userprofile", "home", "appdata", "localappdata",
  "temp", "tmp", "systemroot", "comspec", "pathext"
]);

function reducedEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && ALLOWED_ENV_VARS.has(key.toLowerCase())) {
      env[key] = value;
    }
  }

  // Belt and suspenders: these are never in the allowlist above, but delete
  // them explicitly too so a future edit to that list can never reintroduce
  // them by accident. claude refuses to launch at all when they are set.
  for (const guard of INHERITED_GUARDS) {
    delete env[guard];
  }

  return env;
}

export function harnessNames() {
  return Object.keys(HARNESSES);
}

// The disclosure the Control Room shows next to the harness picker (see
// ui/public/control-room.js): name plus the `isolation` declared on that
// row above. Throws rather than defaulting a missing/malformed entry to
// something that reads as safe -- silently falling back would recreate the
// exact failure mode this feature exists to prevent, just one layer up.
// `table` defaults to the real HARNESSES and is only a parameter so
// test/ui-harness.test.js can prove that throw fires, by passing a table
// with a deliberately incomplete row, without mutating the frozen original.
export function harnessInfo(table = HARNESSES) {
  return Object.entries(table).map(([name, harness]) => {
    const isolation = harness.isolation;
    const valid = isolation
      && typeof isolation.packetOnly === "boolean"
      && typeof isolation.sees === "string"
      && isolation.sees.trim() !== "";

    if (!valid) {
      throw new Error(`Harness "${name}" does not declare its isolation`);
    }

    return { name, packetOnly: isolation.packetOnly, sees: isolation.sees };
  });
}

export function buildSpawn(name) {
  const harness = Object.prototype.hasOwnProperty.call(HARNESSES, name) ? HARNESSES[name] : undefined;

  if (!harness) {
    throw new Error(`Unknown harness: ${name}`);
  }

  return { command: harness.command, args: [...harness.args], env: reducedEnv() };
}

export function extractText(name, line) {
  const harness = Object.prototype.hasOwnProperty.call(HARNESSES, name) ? HARNESSES[name] : undefined;

  if (!harness) {
    return "";
  }

  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    // Harnesses interleave progress chatter that is not JSON. Not an error.
    return "";
  }

  // Deliberately outside the try above: a throw from the extractor itself is
  // a real bug in this harness's line-shape handling, not ordinary non-JSON
  // chatter, and must surface rather than be silently indistinguishable from
  // it.
  return harness.extract(parsed) ?? "";
}
