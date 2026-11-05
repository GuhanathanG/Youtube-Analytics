import type { NextRequest } from "next/server";

/** True when the request carries CRON_SECRET (?key=… or Authorization: Bearer …), compared in constant time. */
export function cronAuthorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const given = req.nextUrl.searchParams.get("key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (given.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
