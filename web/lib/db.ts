import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __pg: ReturnType<typeof postgres> | undefined;
}

/**
 * Supabase's *session* pooler (port 5432) allows only 15 clients in total, which serverless
 * functions (many short-lived copies) plus the background job quickly exhaust
 * ("EMAXCONNSESSION max clients reached"). The *transaction* pooler on port 6543 of the same
 * host is made for serverless and takes the same credentials, so use it automatically.
 */
export function websiteDatabaseUrl(url: string): string {
  return url.replace(/(@[^/]*\.pooler\.supabase\.com):5432(\/|$)/, "$1:6543$2");
}

function makeClient() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set");
  const url = websiteDatabaseUrl(raw);
  return postgres(url, {
    // Supabase's transaction pooler (port 6543) does not support prepared statements.
    prepare: false,
    max: 2,          // few connections per server copy …
    idle_timeout: 5, // … released quickly when idle
    connect_timeout: 15,
    ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : "require",
    // Timestamps are stored as UTC without a zone; keep them as ISO strings.
    types: { date: { to: 1184, from: [1082, 1083, 1114, 1184], serialize: (x: string) => x, parse: (x: string) => x } },
    transform: { undefined: null },
    onnotice: () => {}, // e.g. "relation already exists, skipping" — not worth a log line
  });
}

export function sql() {
  if (!globalThis.__pg) globalThis.__pg = makeClient();
  return globalThis.__pg;
}

export { utc } from "./db-time";
