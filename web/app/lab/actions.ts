"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { dispatchWorkflow } from "@/lib/github";
import { TRAINERS, type TrainerKey } from "@/lib/lab";
import { TRAINING_CATEGORIES, trainingDb } from "@/lib/trainingdb";

async function requireSession() {
  const store = await cookies();
  if (!(await isValidSession(store.get(SESSION_COOKIE)?.value))) throw new Error("Not signed in");
}

/** Queue a YouTube channel for the training database (the training job resolves and syncs it within minutes). */
export async function addTrainingChannel(_: { ok?: string; error?: string } | undefined, form: FormData) {
  await requireSession();
  const query = String(form.get("query") ?? "").trim().replace(/^https?:\/\/(www\.)?youtube\.com\/(channel\/)?/i, "").replace(/\/.*$/, "");
  const category = String(form.get("category") ?? "Other");
  if (!query) return { error: "Paste a YouTube @handle, channel link or channel name." };
  if (query.length > 120 || /instagram/i.test(query)) return { error: "YouTube channels only: a @handle, channel link or name." };
  if (!(TRAINING_CATEGORIES as readonly string[]).includes(category)) return { error: "Pick a niche." };
  const db = await trainingDb();
  if (!db) return { error: "No training database is set up yet." };
  try {
    await db`create table if not exists training_catalog (channel_id text, category text not null, query text primary key, title text,
      subscribers bigint, status text not null, note text, updated_at timestamp not null)`;
    const [row] = await db`insert into training_catalog (query, category, status, updated_at) values (${query}, ${category}, 'pending', now())
      on conflict (query) do update set category = excluded.category,
        status = case when training_catalog.status = 'added' then 'added' else 'pending' end, updated_at = now()
      returning status`;
    if (row?.status === "added") return { ok: `${query} is already in the training set.` };
    const run = await dispatchWorkflow(TRAINERS.channels.file);
    revalidatePath("/lab", "layout");
    return { ok: run.ok ? `Queued ${query}. The training job is starting; it shows here in a few minutes.` : `Queued ${query}: it is added on the next training run (every 6 hours).` };
  } catch (e) {
    return { error: `Something went wrong: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}` };
  }
}

/** Pause (stop collecting, keep what was learned from) or resume a training channel. */
export async function setTrainingActive(id: string, active: boolean) {
  await requireSession();
  const db = await trainingDb();
  if (!db) return;
  await db`update channels set active = ${active} where id = ${id}`;
  revalidatePath("/lab", "layout");
}

/** Start a training run on GitHub (free CPU). */
export async function startTraining(key: TrainerKey): Promise<{ ok: boolean; message: string }> {
  await requireSession();
  const t = TRAINERS[key];
  if (!t) return { ok: false, message: "Unknown model." };
  const res = await dispatchWorkflow(t.file);
  revalidatePath("/lab");
  return res;
}
