/** One CSV cell. Text starting with = + - @ (or tab/CR) is prefixed with ' so spreadsheet apps
 *  don't run it as a formula (comments are written by the public, so this matters). */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
