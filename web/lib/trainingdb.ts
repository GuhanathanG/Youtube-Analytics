import "server-only";
import postgres from "postgres";
import { sql } from "./db";
import { cached } from "./cache";

/**
 * The training database: channels watched only to teach the models (other creators in each niche), kept in their own
 * free database so they never touch the dashboard's. Its address is the "training_db" row in app_secrets (or
 * TRAINING_DATABASE_URL). The background job (training.yml) fills it; the Model Lab reads it and queues requests.
 */
declare global {
  // eslint-disable-next-line no-var
  var __pgTraining: { url: string; db: ReturnType<typeof postgres> } | undefined;
}

async function trainingUrl(): Promise<string | null> {
  if (process.env.TRAINING_DATABASE_URL) return process.env.TRAINING_DATABASE_URL;
  return cached("training-db-url", 300_000, async () => {
    const [r] = await sql()`select value from app_secrets where name = 'training_db'`.catch(() => []);
    return (r?.value as string) ?? null;
  });
}

/** A client for the training database, or null when there isn't one. */
export async function trainingDb(): Promise<ReturnType<typeof postgres> | null> {
  const url = await trainingUrl();
  if (!url) return null;
  if (globalThis.__pgTraining?.url !== url) {
    globalThis.__pgTraining = { url, db: postgres(url, {
      prepare: false, max: 2, idle_timeout: 5, connect_timeout: 15,
      ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : "require",
      // Dates come back as text, like the main database client (the site's date helpers expect strings).
      types: { date: { to: 1184, from: [1082, 1083, 1114, 1184], serialize: (x: string) => x, parse: (x: string) => x } },
      transform: { undefined: null }, onnotice: () => {},
    }) };
  }
  return globalThis.__pgTraining.db;
}

export const TRAINING_CATEGORIES = ["Comedy & sketches", "Family & lifestyle vlogs", "Travel", "Cooking", "Food reviews", "Tech & gadgets",
  "Gaming", "Explainers & current affairs", "Movies & cinema", "Finance & stock market", "Short-form entertainment", "Podcasts & interviews",
  "Education", "Music", "Sports", "Other"] as const;
