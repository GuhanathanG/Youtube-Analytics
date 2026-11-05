import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __pg: ReturnType<typeof postgres> | undefined;
}

function makeClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return postgres(url, {
    // Supabase's transaction pooler (port 6543) does not support prepared statements.
    prepare: false,
    max: 3,
    idle_timeout: 20,
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
