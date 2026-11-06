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
    max: 4,          // a few connections per server copy (transaction pooler, made for this) …
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

/* ------------------------------------------------------------------ safe setup helpers
 * "alter table …" and "create index if not exists …" take table locks even when there is nothing to do.
 * On a busy table (e.g. while the background job writes) that lock waits, and every page query on the
 * table queues behind it. So: look in the catalog first (no locks) and only change what's missing. */
export async function ensureRls(table: string) {
  const db = sql();
  const [r] = await db`select relrowsecurity from pg_class where relname = ${table} and relnamespace = 'public'::regnamespace`;
  if (r && !r.relrowsecurity) await carefulDdl(`alter table "${table.replace(/"/g, "")}" enable row level security`);
}

export async function ensureColumns(table: string, columns: [name: string, type: string][]) {
  const db = sql();
  const have = new Set((await db`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table}`)
    .map((r) => r.column_name as string));
  for (const [name, type] of columns) {
    if (!have.has(name)) await carefulDdl(`alter table "${table.replace(/"/g, "")}" add column if not exists "${name.replace(/"/g, "")}" ${type}`);
  }
}

export async function ensureIndex(name: string, create: string) {
  const db = sql();
  const [r] = await db`select 1 from pg_indexes where schemaname = 'public' and indexname = ${name}`;
  if (!r) await carefulDdl(create);
}

/** Run a table change, but give up after 3 s if the table is busy: while a change waits for its lock,
 *  every other query on that table queues behind it, which freezes pages. A later run tries again. */
async function carefulDdl(statement: string) {
  try {
    await sql().begin(async (tx) => {
      await tx`set local lock_timeout = '3s'`;
      await tx.unsafe(statement);
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/lock timeout/i.test(msg)) throw e;
    console.warn("[setup] postponed, table busy:", statement.slice(0, 80));
  }
}
