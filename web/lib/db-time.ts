/** Parse a "naive UTC" timestamp string from the database (safe on client and server). */
export function utc(ts: string | null | undefined): Date | null {
  if (!ts) return null;
  const s = ts.includes("T") ? ts : ts.replace(" ", "T");
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z");
}
