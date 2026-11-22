"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { clearCache } from "@/lib/cache";
import { sql } from "@/lib/db";
import { dispatchWorkflow } from "@/lib/github";
import { TRAINERS, type TrainerKey } from "@/lib/lab";
import { addChannelNow } from "@/lib/live";

async function requireSession() {
  const store = await cookies();
  if (!(await isValidSession(store.get(SESSION_COOKIE)?.value))) throw new Error("Not signed in");
}

/** Add a YouTube channel only to teach the models (videos and stats; hidden from the dashboard). */
export async function addTrainingChannel(_: { ok?: string; error?: string } | undefined, form: FormData) {
  await requireSession();
  const query = String(form.get("query") ?? "").trim();
  if (!query) return { error: "Paste a YouTube @handle or channel link." };
  if (query.length > 300 || /instagram\.com|^ig_/i.test(query)) return { error: "YouTube channels only for now: paste a @handle or channel link." };
  try {
    const res = await addChannelNow(query, { training: true });
    clearCache();
    revalidatePath("/lab", "layout");
    return res.ok ? { ok: res.message } : { error: res.message };
  } catch (e) {
    return { error: `Something went wrong: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}` };
  }
}

/** Pause (stop collecting, keep what was learned from) or resume a training channel. */
export async function setTrainingActive(id: string, active: boolean) {
  await requireSession();
  await sql()`update channels set active = ${active} where id = ${id} and role = 'training'`;
  clearCache();
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
