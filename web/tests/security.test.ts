// Unit tests for security helpers. Run: node --experimental-strip-types tests/security.test.ts
import assert from "node:assert/strict";
import { safeNext } from "../lib/safe-next.ts";
import { csvCell } from "../lib/csv.ts";
import { isValidSession, safeEqual, sessionToken } from "../lib/auth.ts";

// Open-redirect protection
assert.equal(safeNext("/channels/abc?x=1"), "/channels/abc?x=1");
for (const bad of ["//evil.com", "/\\evil.com", "\\\\evil.com", "https://evil.com", "evil.com", "/%0d/evil", "/\u0000x", "/javascript:alert(1)", "", null, undefined]) {
  assert.equal(safeNext(bad as string), bad === "/%0d/evil" ? "/%0d/evil" : "/", `safeNext(${JSON.stringify(bad)})`);
}

// CSV formula injection
assert.equal(csvCell("=HYPERLINK(\"http://x\")"), `"'=HYPERLINK(""http://x"")"`);
assert.equal(csvCell("+1"), "'+1");
assert.equal(csvCell("-2"), "'-2");
assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
assert.equal(csvCell("semma video, bro"), `"semma video, bro"`);
assert.equal(csvCell(null), "");
assert.equal(csvCell(42), "42");

// Constant-time compare
assert.equal(safeEqual("abc", "abc"), true);
assert.equal(safeEqual("abc", "abd"), false);
assert.equal(safeEqual("abc", "abcd"), false);
assert.equal(safeEqual("", ""), true);

// Sessions: valid, tampered, wrong password, expired
process.env.APP_PASSWORD = "correct horse";
const tok = await sessionToken("correct horse");
assert.equal(await isValidSession(tok), true);
assert.equal(await isValidSession(tok.replace(/.$/, (c) => (c === "a" ? "b" : "a"))), false);
assert.equal(await isValidSession(await sessionToken("wrong password")), false);
const [exp, sig] = tok.split(".");
assert.equal(await isValidSession(`${Number(exp) + 999999}.${sig}`), false, "extending the expiry must break the signature");
assert.equal(await isValidSession(tok, Date.now() + 31 * 86400 * 1000), false, "expires after 30 days");
assert.equal(await isValidSession(undefined), false);
assert.equal(await isValidSession("garbage"), false);
process.env.APP_PASSWORD = "changed";
assert.equal(await isValidSession(tok), false, "changing APP_PASSWORD ends all sessions");

console.log("security unit tests: all passed");
