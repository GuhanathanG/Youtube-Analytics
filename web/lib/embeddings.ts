import "server-only";
import { sql } from "./db";
import { splitKeys } from "./ai";
import { quotaDay } from "./queries";

/**
 * E6: search comments by meaning. Each recent comment gets a small vector (Gemini's free embedding model, 256
 * numbers) stored with pgvector; Ask AI embeds the question the same way and finds the closest comments, so
 * "is the sound bad?" finds "audio sariyilla" with no word in common. Keyword search still runs alongside.
 * Uses halfvec (2 bytes a number) where pgvector ≥ 0.7, else vector. Only the main database's comments
 * (about the last 90 days) are embedded; the archive keeps keyword search.
 */
const DIMS = Number(process.env.EMBED_DIMS ?? 256);
const MODEL = process.env.GEMINI_EMBED_MODEL ?? "gemini-embedding-001";
let vecType: "halfvec" | "vector" | null | undefined; // undefined = not checked yet; null = pgvector unavailable

export async function ensureVectors(): Promise<"halfvec" | "vector" | null> {
  if (vecType !== undefined) return vecType;
  const db = sql();
  try {
    await db`create extension if not exists vector`;
    const [v] = await db`select extversion from pg_extension where extname = 'vector'`;
    const [maj, min] = String(v?.extversion ?? "0.0").split(".").map(Number);
    const want = maj > 0 || min >= 7 ? "halfvec" : "vector";
    const [col] = await db`select udt_name from information_schema.columns where table_name = 'comments' and column_name = 'embedding'`;
    if (!col) {
      await db.unsafe(`alter table comments add column if not exists embedding ${want}(${DIMS})`);
      await db.unsafe(`create index if not exists ix_comments_embedding on comments using hnsw (embedding ${want}_cosine_ops)`);
    }
    vecType = (col?.udt_name as "halfvec" | "vector" | undefined) ?? want;
  } catch (e) {
    console.log("[embeddings] pgvector unavailable:", e instanceof Error ? e.message : e);
    vecType = null;
  }
  return vecType;
}

export const embeddingsConfigured = () => !!splitKeys(process.env.GEMINI_API_KEY)[0];

/** Vectors for texts (one request per 100). Null when the API refuses (quota, key). */
async function embed(texts: string[], task: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"): Promise<number[][] | null> {
  const key = splitKeys(process.env.GEMINI_API_KEY)[0];
  if (!key || !texts.length) return null;
  const base = process.env.GEMINI_NATIVE_BASE ?? "https://generativelanguage.googleapis.com/v1beta";
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const chunk = texts.slice(i, i + 100);
    const res = await fetch(`${base}/models/${MODEL}:batchEmbedContents`, {
      method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ requests: chunk.map((t) => ({ model: `models/${MODEL}`, content: { parts: [{ text: t.slice(0, 2000) }] },
        taskType: task, outputDimensionality: DIMS })) }),
    }).catch(() => null);
    if (!res?.ok) return null;
    const data = await res.json().catch(() => null);
    const vecs = (data?.embeddings ?? []).map((e: { values?: number[] }) => normalize(e.values ?? []));
    if (vecs.length !== chunk.length) return null;
    out.push(...vecs);
  }
  await sql()`insert into llm_usage (day, model_key, requests, tokens, exhausted) values (${quotaDay()}, ${"embed/" + MODEL}, ${Math.ceil(texts.length / 100)}, ${texts.length}, false)
    on conflict (day, model_key) do update set requests = llm_usage.requests + excluded.requests, tokens = llm_usage.tokens + excluded.tokens`.catch(() => null);
  return out;
}

/** Shorter-than-full vectors from Gemini aren't unit length; cosine search wants them to be. */
function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => Number((x / n).toFixed(6)));
}
const literal = (v: number[]) => `[${v.join(",")}]`;

/** Give vectors to the newest comments that don't have one yet. Returns how many were done. */
export async function embedBacklog(limit = Number(process.env.EMBED_PER_TURN ?? 200)): Promise<number> {
  if (!embeddingsConfigured()) return 0;
  const type = await ensureVectors();
  if (!type) return 0;
  const db = sql();
  const rows = await db`select id, text, translation from comments where embedding is null and length(text) > 1
    order by published_at desc nulls last limit ${limit}`;
  if (!rows.length) return 0;
  // The English translation (when the AI made one) helps the meaning land; the original keeps the exact words.
  const vecs = await embed(rows.map((r) => [r.text, r.translation].filter(Boolean).join(" \n ") as string), "RETRIEVAL_DOCUMENT");
  if (!vecs) return 0;
  // One statement for the whole batch (one round trip).
  await db.unsafe(`update comments c set embedding = v.e::${type} from (select unnest($1::text[]) as id, unnest($2::text[]) as e) v where c.id = v.id`,
    [rows.map((r) => r.id as string), vecs.map(literal)]);
  return rows.length;
}

export type Near = { id: string; distance: number };

/** Comments closest in meaning to a question (cosine distance; smaller = closer). Empty when unavailable. */
export async function nearestComments(question: string, channelId: string | null, limit = 60): Promise<Near[]> {
  if (!embeddingsConfigured()) return [];
  const type = await ensureVectors();
  if (!type) return [];
  const [q] = (await embed([question], "RETRIEVAL_QUERY")) ?? [];
  if (!q) return [];
  // A wider index search than the default (40) so filters (channel, spam) still leave enough close matches.
  const rows = await sql().begin(async (tx) => {
    await tx.unsafe(`set local hnsw.ef_search = ${Math.max(100, limit * 2)}`);
    return tx.unsafe(`select id, (embedding <=> $1::${type})::float8 as distance from comments
      where embedding is not null ${channelId ? "and channel_id = $3" : ""} and (is_spam is null or not is_spam)
      order by embedding <=> $1::${type} limit $2`, channelId ? [literal(q), limit, channelId] : [literal(q), limit]);
  });
  return rows.map((r) => ({ id: r.id as string, distance: Number(r.distance) }));
}
