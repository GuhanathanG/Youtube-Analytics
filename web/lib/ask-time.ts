/** Time words in Ask AI questions, and comment dates for its prompt (pure: tested in tests/logic.test.ts). */

/** YYYY-MM-DD of a database timestamp (Date or "2026-11-28 10:00:00" text), or "?". */
export function dayOf(v: unknown): string {
  if (!v) return "?";
  const d = v instanceof Date ? v : new Date(String(v).replace(" ", "T") + (/[Zz+]/.test(String(v).slice(10)) ? "" : "Z"));
  return Number.isNaN(d.getTime()) ? "?" : d.toISOString().slice(0, 10);
}

/** Days a question is about, when it names a time ("today", "this week", "recently"…), else null (all time). */
export function timeWindow(question: string): number | null {
  const q = question.toLowerCase();
  if (/\b(today|tonight|last 24 ?h(ou)?rs?|innaiku|indru)\b/.test(q)) return 1;
  if (/\byesterday\b/.test(q)) return 2;
  if (/\b(this|last|past|the) week\b|\bweekly\b|\b7 days\b/.test(q)) return 7;
  if (/\b(this|last|past|the) month\b|\b30 days\b/.test(q)) return 31;
  if (/\b(recent(ly)?|lately|latest|newest|new videos?)\b/.test(q)) return 14;
  return null;
}
