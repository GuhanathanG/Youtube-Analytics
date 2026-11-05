/**
 * Password gate. The cookie holds "<expiry>.<signature>", where the signature is an HMAC of the
 * expiry keyed with APP_PASSWORD. It never contains the password, expires on the server after
 * 30 days, and every session ends when APP_PASSWORD changes.
 */
export const SESSION_COOKIE = "cp_session";
export const SESSION_DAYS = 30;

async function hmac(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison (doesn't reveal how many characters matched). */
export function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function sessionToken(password: string, now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + SESSION_DAYS * 86400;
  return `${exp}.${await hmac(password, `creator-pulse-session-v2.${exp}`)}`;
}

export async function isValidSession(token: string | undefined, now = Date.now()): Promise<boolean> {
  const password = process.env.APP_PASSWORD;
  if (!password) return true; // no password configured: site is open
  if (!token) return false;
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || !sig || exp * 1000 < now) return false;
  return safeEqual(sig, await hmac(password, `creator-pulse-session-v2.${exp}`));
}
