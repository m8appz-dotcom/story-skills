import { describe, expect, test, afterAll } from "bun:test";
import { startServer } from "../ui/server.js";
import { tokenMatches } from "../ui/token.js";

const TOKEN = "test-token-0123456789";
const started = await startServer({ host: "127.0.0.1", port: 0, token: TOKEN });
afterAll(() => started.server.close());

function get(path, token) {
  return fetch(`http://127.0.0.1:${started.port}${path}`,
    token ? { headers: { "X-Story-Token": token } } : undefined);
}

describe("token", () => {
  // Renamed from "compares without leaking length or content": that name
  // implied timing safety had been measured here. It has not -- this only
  // asserts the observable match/no-match booleans, same as below.
  test("matches an equal token and rejects unequal, empty, or missing ones", () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(tokenMatches(TOKEN, "wrong")).toBe(false);
    expect(tokenMatches(TOKEN, "")).toBe(false);
    expect(tokenMatches(TOKEN, undefined)).toBe(false);
  });

  test("rejects tokens a length-only or window-only comparison would wrongly accept", () => {
    // "wrong" above differs from TOKEN in length as well as content, so a
    // buggy implementation that only checked expected.length === given.length
    // (never actually comparing bytes) would still fail it, for the wrong
    // reason. Use a wrong token of the *same* length so this can only pass
    // if content is genuinely compared.
    const sameLengthWrong = `${"x".repeat(TOKEN.length - 1)}!`;
    expect(sameLengthWrong).not.toBe(TOKEN);
    expect(sameLengthWrong.length).toBe(TOKEN.length);
    expect(tokenMatches(TOKEN, sameLengthWrong)).toBe(false);

    // tokenMatches pads both sides to a fixed 128-byte window before calling
    // timingSafeEqual, then separately checks the real (unpadded) lengths
    // match. Build a "given" whose first 128 bytes are byte-for-byte
    // identical to TOKEN's padded window but which is actually far longer
    // than TOKEN -- if the trailing expected.length === given.length check
    // were ever dropped, timingSafeEqual alone would call this a match.
    const smuggled = `${TOKEN.padEnd(128, "\0")}extra-bytes-past-the-window`;
    expect(smuggled.length).toBeGreaterThan(128);
    expect(tokenMatches(TOKEN, smuggled)).toBe(false);
  });
});

describe("server", () => {
  test("refuses an API call with no token", async () => {
    const response = await get("/api/projects");
    expect(response.status).toBe(401);
    // The body must not say whether a token exists or how long it is.
    expect((await response.text()).toLowerCase()).not.toContain("token");
  });

  test("refuses an API call with the wrong token", async () => {
    expect((await get("/api/projects", "nope")).status).toBe(401);
  });

  test("serves the API with the right token", async () => {
    const response = await get("/api/projects", TOKEN);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ projects: [] });
  });

  test("serves the page without a token, because the page carries none yet", async () => {
    expect((await get("/")).status).toBe(200);
  });

  test("refuses to bind past loopback with no token", async () => {
    await expect(startServer({ host: "0.0.0.0", port: 0, token: "" }))
      .rejects.toThrow("refusing to bind");
  });
});

describe("static containment", () => {
  test("404s a path with no matching file under public", async () => {
    expect((await get("/nope.html")).status).toBe(404);
  });

  test("404s dot-dot segments instead of resolving them outside public", async () => {
    // new URL() collapses ".." at the root before sendStatic ever sees it,
    // so this can only ever name a (nonexistent) file inside public -- a
    // regression here would mean ui/server.js itself gets served instead.
    expect((await get("/../ui/server.js")).status).toBe(404);
  });

  test("404s a backslash traversal segment the same way as a forward slash one", async () => {
    // WHATWG URL treats "\" as a path separator for http(s) URLs, so this
    // normalises the same way as the dot-dot case above rather than reaching
    // ui/server.js as a literal filename.
    expect((await get("/..\\ui\\server.js")).status).toBe(404);
  });

  test("404s url-encoded dot-dot-slash instead of decoding it into a traversal", async () => {
    // %2f is never decoded back into a real separator by the URL parser, so
    // "%2e%2e%2fserver.js" can only ever be looked up as one literal
    // (nonexistent) filename containing percent signs, not a path that
    // climbs out of public.
    expect((await get("/%2e%2e%2fserver.js")).status).toBe(404);
  });
});
