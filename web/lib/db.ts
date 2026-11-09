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

/* Vercel pauses an idle server copy and wakes it for the next visit. Its old connections may be dead by
 * then, and timers from before the pause all fire at once on waking. A 1-second heartbeat tells us a pause
 * happened (a big gap since the last beat): the first query after it starts with fresh connections. */
let lastBeat = Date.now();
let beating = false;
function heartbeat() {
  if (beating) return;
  beating = true;
  const t = setInterval(() => {
    const now = Date.now();
    // On waking, timers run before any new visit is handled: start fresh connections right here.
    if (now - lastBeat > 10_000 && globalThis.__pg) {
      console.warn("[db] woke up after a pause of", Math.round((now - lastBeat) / 1000), "s: fresh connections");
      resetClient(globalThis.__pg);
    }
    lastBeat = now;
  }, 1000);
  (t as { unref?: () => void }).unref?.();
}

function root(): Sql {
  const now = Date.now();
  if (globalThis.__pg && beating && now - lastBeat > 10_000) {
    console.warn("[db] woke up after a pause of", Math.round((now - lastBeat) / 1000), "s: fresh connections");
    resetClient(globalThis.__pg);
  }
  lastBeat = now;
  heartbeat();
  if (!globalThis.__pg) { globalThis.__pg = makeClient(); trackQueries(globalThis.__pg); }
  return globalThis.__pg;
}

/**
 * Watchdog: a query that hasn't answered after QUERY_STUCK_SECONDS (default 40 s; the database itself
 * stops any website query after 25 s) is on a dead connection (e.g. the pooler dropped it while the
 * server copy was paused). postgres.js would wait on it forever, and every later query queues behind
 * the few pooled connections, so every page hangs until Vercel's 300 s limit. Instead: cancel it and
 * start a fresh set of connections; the stuck queries fail at once and the next page works.
 * Long background reads (withLongQueries) are left alone.
 */
const STUCK_MS = Number(process.env.QUERY_STUCK_SECONDS ?? 40) * 1000;
function trackQueries(client: Sql) {
  const proto = Object.getPrototypeOf(client`select 1`) as { handle: () => Promise<void>; cancel: () => unknown; __tracked?: boolean };
  if (proto.__tracked) return;
  proto.__tracked = true;
  const original = proto.handle;
  proto.handle = function (this: Promise<unknown> & { executed?: boolean; cancel: () => unknown }) {
    if (!this.executed && !longRun.getStore()) {
      const q = this as typeof this & { active?: boolean };
      const owner = globalThis.__pg; // the set of connections this query runs on
      let t: ReturnType<typeof setTimeout>;
      let waited = 0;
      const check = () => {
        // Still waiting in line for a free connection (not sent yet): that's a busy server copy, not a
        // dead connection. Keep waiting, up to 3 rounds, then give up on it all the same.
        if (!q.active && waited++ < 3) { t = setTimeout(check, STUCK_MS); (t as { unref?: () => void }).unref?.(); return; }
        console.warn("[db] a query got no answer for", (STUCK_MS / 1000) * (waited + 1), "s: starting fresh connections");
        try { this.cancel(); } catch { /* already gone */ }
        resetClient(owner); // never the newer set a later visit already uses
      };
      t = setTimeout(check, STUCK_MS);
      (t as { unref?: () => void }).unref?.();
      const clear = () => clearTimeout(t);
      Promise.prototype.then.call(this, clear, clear); // also marks the query as handled
    }
    return original.call(this);
  };
}
function resetClient(old: Sql | undefined) {
  if (!old) return;
  if (globalThis.__pg === old) globalThis.__pg = undefined; // the next query opens new connections
  old.end({ timeout: 1 }).catch(() => undefined); // its queued / stuck queries fail instead of waiting forever
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
