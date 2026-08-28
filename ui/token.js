import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function readOrCreateToken(dir) {
  const file = path.join(dir, ".token");

  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing !== "") {
      return existing;
    }
  }

  const token = randomBytes(24).toString("hex");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `${token}\n`, "utf8");
  return token;
}

export function tokenMatches(expected, given) {
  if (typeof given !== "string" || given === "") {
    return false;
  }

  // Pad to a fixed width first: timingSafeEqual throws on a length mismatch,
  // and throwing early is itself a signal about the real token's length.
  const left = Buffer.from(expected.padEnd(128, "\0").slice(0, 128));
  const right = Buffer.from(given.padEnd(128, "\0").slice(0, 128));
  return timingSafeEqual(left, right) && expected.length === given.length;
}
