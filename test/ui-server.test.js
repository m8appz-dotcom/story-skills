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
  test("compares without leaking length or content", () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(tokenMatches(TOKEN, "wrong")).toBe(false);
    expect(tokenMatches(TOKEN, "")).toBe(false);
    expect(tokenMatches(TOKEN, undefined)).toBe(false);
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
