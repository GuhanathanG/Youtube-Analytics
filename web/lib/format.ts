import { utc } from "./db-time";

export function compact(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function full(n: number | null | undefined): string {
  if (n === null || n === undefined) return "–";
  return new Intl.NumberFormat("en").format(n);
}

/** Average of (p(positive) - p(negative)) on a -100..+100 scale. */
export function score(v: number | null | undefined): string {
  if (v === null || v === undefined) return "–";
  const s = Math.round(v * 100);
  return (s > 0 ? "+" : "") + s;
}

export function pct(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

export function ago(ts: string | null | undefined): string {
  const d = utc(ts);
  if (!d) return "never";
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function date(ts: string | null | undefined, withTime = false): string {
  const d = utc(ts);
  if (!d) return "–";
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "UTC",
  });
}

export function duration(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso);
  if (!m) return "";
  const [h, mi, s] = [Number(m[1] ?? 0), Number(m[2] ?? 0), Number(m[3] ?? 0)];
  return h ? `${h}:${String(mi).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${mi}:${String(s).padStart(2, "0")}`;
}
