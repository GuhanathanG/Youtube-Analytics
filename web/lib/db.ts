import postgres from "postgres";
import { AsyncLocalStorage } from "node:async_hooks";

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

type Sql = ReturnType<typeof postgres>;
const longRun = new AsyncLocalStorage<Sql>();

function root(): Sql {
  if (!globalThis.__pg) { globalThis.__pg = makeClient(); trackQueries(globalThis.__pg); }
  return globalThis.__pg;
}

/**
 * Never let Vercel pause this server copy while a query is still running. A paused copy leaves its
 * database connection half-way through a query ("waiting for the website") for minutes, and with only a
 * few pooled connections that makes every page wait. Every query that runs is counted; each request keeps
 * the copy alive (after the reply) until no query is running, at most 30 s.
 */
let inflight = 0;
let idleWaiters: (() => void)[] = [];
function trackQueries(client: Sql) {
  const proto = Object.getPrototypeOf(client`select 1`) as { handle: () => Promise<void>; __tracked?: boolean };
  if (proto.__tracked) return;
  proto.__tracked = true;
  const original = proto.handle;
  proto.handle = function (this: Promise<unknown> & { executed?: boolean }) {
    if (!this.executed) {
      inflight++;
      const done = () => { inflight--; if (inflight <= 0) { inflight = 0; const w = idleWaiters; idleWaiters = []; w.forEach((f) => f()); } };
      Promise.prototype.then.call(this, done, done);
      keepAliveUntilIdle();
    }
    return original.call(this);
  };
}
function whenIdle(maxMs: number): Promise<void> {
  if (inflight <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, maxMs);
    idleWaiters.push(() => { clearTimeout(t); resolve(); });
  });
}
function keepAliveUntilIdle() {
  try {
    // Loaded lazily so plain scripts and tests (outside Next.js) never need it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { after } = require("next/server") as typeof import("next/server");
    after(() => whenIdle(30_000));
  } catch { /* not inside a request: nothing will pause us */ }
}

export function sql(): Sql {
  return longRun.getStore() ?? root();
}

/**
 * Run a heavy read (e.g. a section that groups every comment of a 770k-comment channel) with a longer
 * time limit than the website's usual 25 s per query. Everything inside uses one connection in one
 * transaction ("set local" only affects this transaction, so it's safe with the pooler).
 * Only the background jobs use this; pages never do.
 */
export async function withLongQueries<T>(seconds: number, fn: () => Promise<T>): Promise<T> {
  return (await root().begin(async (tx) => {
    await tx.unsafe(`set local statement_timeout = '${Math.max(1, Math.round(seconds))}s'`);
    return longRun.run(tx as unknown as Sql, fn);
  })) as T;
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
    await root().begin(async (tx) => { // its own connection, even when called during a long read
      await tx`set local lock_timeout = '3s'`;
      await tx.unsafe(statement);
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/lock timeout/i.test(msg)) throw e;
    console.warn("[setup] postponed, table busy:", statement.slice(0, 80));
  }
}
