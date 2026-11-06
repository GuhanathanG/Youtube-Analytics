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
import { addInstagramNow, looksLikeInstagram } from "@/lib/instagram";
import { createShareLink, revokeShareLink } from "@/lib/share";

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
    const res = looksLikeInstagram(query) ? await addInstagramNow(query) : await addChannelNow(query);
    clearCache();
    revalidatePath("/", "layout");
    return res.ok ? { ok: res.message } : { error: res.message };
  } catch (e) {
    return { error: `Something went wrong: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}` };
  }
}

export async function addInstagram(_: { ok?: string; error?: string } | undefined, form: FormData) {
  await requireSession();
  const query = String(form.get("query") ?? "").trim();
  if (!query) return { error: "Type an Instagram @username or paste the profile link." };
  if (query.length > 200) return { error: "That looks too long for an Instagram username." };
  try {
    const res = await addInstagramNow(query);
    clearCache();
    revalidatePath("/", "layout");
    return res.ok ? { ok: res.message } : { error: res.message };
  } catch (e) {
    return { error: `Something went wrong: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}` };
  }
}

/** Top-bar channel switcher: remember the channel the site should focus on ("all" = combined). */
export async function setFocus(channelId: string) {
  await requireSession();
  const { FOCUS_COOKIE } = await import("@/lib/focus");
  (await cookies()).set(FOCUS_COOKIE, channelId.slice(0, 80), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 365 * 86400, path: "/" });
  revalidatePath("/", "layout");
}

/** Manage → iPhone widget: make a new widget key (old widgets stop working). Returns the new script. */
export async function rotateWidgetKey(): Promise<string> {
  await requireSession();
  const { rotateWidgetToken, scriptableScript } = await import("@/lib/widget");
  const key = await rotateWidgetToken();
  return scriptableScript(await siteUrl(), key);
}

async function siteUrl() {
  const host = process.env.SITE_HOST ?? process.env.VERCEL_PROJECT_PRODUCTION_URL ?? (await headers()).get("host") ?? "localhost:3000";
  return `${host.startsWith("localhost") ? "http" : "https"}://${host}`;
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

/** Send a message in a saved conversation (creates the conversation on the first message). */
export async function chatAction(threadId: string | null, question: string, channelId: string | null) {
  await requireSession();
  const { sendChatMessage } = await import("@/lib/chat");
  const res = await sendChatMessage(threadId, question, channelId);
  revalidatePath("/ask");
  return res;
}

export async function deleteChatAction(threadId: string) {
  await requireSession();
  const chat = await import("@/lib/chat");
  await chat.deleteThread(threadId);
  revalidatePath("/ask");
}

export async function renameChatAction(threadId: string, title: string) {
  await requireSession();
  const chat = await import("@/lib/chat");
  await chat.renameThread(threadId, title);
  revalidatePath("/ask");
}

export async function testAlertAction() {
  await requireSession();
  const { sendTestAlert } = await import("@/lib/alerts");
  return sendTestAlert();
}

export async function createShareAction(form: FormData) {
  await requireSession();
  const channelId = String(form.get("channel") ?? "");
  const days = Number(form.get("days") ?? 30);
  if (!/^UC[\w-]{22}$/.test(channelId)) return;
  await createShareLink(channelId, Number.isFinite(days) && days > 0 ? Math.min(days, 365) : null);
  revalidatePath("/manage");
}

export async function revokeShareAction(form: FormData) {
  await requireSession();
  await revokeShareLink(String(form.get("token") ?? ""));
  revalidatePath("/manage");
}
