"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE, SESSION_DAYS, isValidSession, safeEqual, sessionToken } from "@/lib/auth";
import { clearFailures, loginBlocked, recordFailure } from "@/lib/login-guard";
import { safeNext } from "@/lib/safe-next";
import { clearCache } from "@/lib/cache";
import { sql } from "@/lib/db";
import { startFullSync } from "@/lib/github";
import { addChannelNow } from "@/lib/live";

async function requireSession() {
  const store = await cookies();
  if (!(await isValidSession(store.get(SESSION_COOKIE)?.value))) throw new Error("Not signed in");
}

export async function login(_: { error?: string } | undefined, form: FormData) {
  const password = process.env.APP_PASSWORD ?? "";
  const entered = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? "/"));
  const ip = ((await headers()).get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  if (await loginBlocked(ip)) {
    await new Promise((r) => setTimeout(r, 1000));
    return { error: "Too many wrong passwords. Wait 15 minutes and try again." };
  }
  if (!password || !safeEqual(entered, password)) {
    await recordFailure(ip);
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    return { error: "That password isn't right." };
  }
  await clearFailures(ip);
  const store = await cookies();
  store.set(SESSION_COOKIE, await sessionToken(password), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86400,
  });
  redirect(next);
}

export async function logout() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}

export async function addChannel(_: { ok?: string; error?: string } | undefined, form: FormData) {
  await requireSession();
  const query = String(form.get("query") ?? "").trim();
  if (!query) return { error: "Paste a @handle, channel link or video link." };
  if (query.length > 300) return { error: "That looks too long for a channel link." };
  try {
    const res = await addChannelNow(query);
    clearCache();
    revalidatePath("/", "layout");
    return res.ok ? { ok: res.message } : { error: res.message };
  } catch (e) {
    return { error: `Something went wrong: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}` };
  }
}

export async function runFullSync(): Promise<{ ok: boolean; message: string }> {
  await requireSession();
  return startFullSync();
}

export async function setChannelActive(id: string, active: boolean) {
  await requireSession();
  await sql()`update channels set active = ${active} where id = ${id}`;
  clearCache();
  revalidatePath("/manage");
  revalidatePath("/");
}

export async function askAction(question: string, channelId: string | null) {
  await requireSession();
  const q = question.trim().slice(0, 500);
  if (q.length < 3) return { error: "Type a question first." };
  const { askComments } = await import("@/lib/ask");
  return askComments(q, channelId || null);
}

export async function testAlertAction() {
  await requireSession();
  const { sendTestAlert } = await import("@/lib/alerts");
  return sendTestAlert();
}
