/** Only allow redirects to a path on this site ("/x"). Blocks "//evil.com", "/\\evil.com",
 *  "https://…", and control characters, which browsers can turn into off-site redirects. */
export function safeNext(next: string | null | undefined): string {
  const n = String(next ?? "").trim();
  if (!n.startsWith("/") || n.startsWith("//") || n.includes("\\") || /[\u0000-\u001f\u007f]/.test(n)) return "/";
  if (/^\/[^/]*:/.test(n)) return "/"; // "/javascript:…"-style tricks
  return n.slice(0, 500);
}
