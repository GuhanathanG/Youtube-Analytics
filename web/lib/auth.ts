/** Password gate: the cookie holds an HMAC of APP_PASSWORD, never the password itself. */
export const SESSION_COOKIE = "cp_session";

export async function sessionToken(password: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("creator-pulse-session-v1"));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function isValidSession(token: string | undefined): Promise<boolean> {
  const password = process.env.APP_PASSWORD;
  if (!password) return true; // no password configured: site is open
  if (!token) return false;
  const expected = await sessionToken(password);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}
