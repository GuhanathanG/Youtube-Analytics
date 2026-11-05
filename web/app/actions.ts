"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE, isValidSession, sessionToken } from "@/lib/auth";
import { sql } from "@/lib/db";

async function requireSession() {
  const store = await cookies();
  if (!(await isValidSession(store.get(SESSION_COOKIE)?.value))) throw new Error("Not signed in");
}

export async function login(_: { error?: string } | undefined, form: FormData) {
  const password = process.env.APP_PASSWORD ?? "";
  const entered = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/") || "/";
  if (!password || entered !== password) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return { error: "That password isn't right." };
  }
  const store = await cookies();
  store.set(SESSION_COOKIE, await sessionToken(password), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
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
  await sql()`insert into channel_requests (query, status, created_at) values (${query}, 'pending', now() at time zone 'utc')`;
  revalidatePath("/manage");
  return { ok: `Queued ${query}. It will appear after the next sync run.` };
}

export async function setChannelActive(id: string, active: boolean) {
  await requireSession();
  await sql()`update channels set active = ${active} where id = ${id}`;
  revalidatePath("/manage");
  revalidatePath("/");
}
