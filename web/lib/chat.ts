import "server-only";
import { randomBytes } from "node:crypto";
import { sql } from "./db";
import type { AskAnswer } from "./ask";

/** Saved Ask AI conversations (like ChatGPT/Claude history): threads and their messages. */
let ready = false;
async function ensureTables() {
  if (ready) return;
  const db = sql();
  await db`create table if not exists chat_threads (
    id text primary key, title text not null, channel_id text,
    created_at timestamp not null default (now() at time zone 'utc'), updated_at timestamp not null default (now() at time zone 'utc'))`;
  await db`create table if not exists chat_messages (
    id serial primary key, thread_id text not null references chat_threads(id) on delete cascade,
    role text not null, content text not null, citations text, searched text, model text,
    created_at timestamp not null default (now() at time zone 'utc'))`;
  await db`create index if not exists ix_chat_messages_thread on chat_messages (thread_id, id)`;
  await db`alter table chat_threads enable row level security`;
  await db`alter table chat_messages enable row level security`;
  ready = true;
}

export type Thread = { id: string; title: string; channel_id: string | null; updated_at: string; messages: number };
export type ChatMessage = { id: number; role: "user" | "assistant"; content: string; citations: AskAnswer["citations"]; searched: string[]; model: string | null; created_at: string };

export async function listThreads(limit = 50): Promise<Thread[]> {
  await ensureTables();
  return (await sql()`select t.id, t.title, t.channel_id, t.updated_at, (select count(*)::int from chat_messages m where m.thread_id = t.id) as messages
    from chat_threads t order by t.updated_at desc limit ${limit}`) as unknown as Thread[];
}

export async function getThread(id: string): Promise<{ thread: Thread; messages: ChatMessage[] } | null> {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(id)) return null;
  await ensureTables();
  const db = sql();
  const [t] = await db`select id, title, channel_id, updated_at, 0 as messages from chat_threads where id = ${id}`;
  if (!t) return null;
  const rows = await db`select id, role, content, citations, searched, model, created_at from chat_messages where thread_id = ${id} order by id`;
  const parse = <T,>(s: unknown, d: T): T => { try { return s ? (JSON.parse(String(s)) as T) : d; } catch { return d; } };
  return {
    thread: t as unknown as Thread,
    messages: rows.map((r) => ({ id: r.id as number, role: r.role as "user" | "assistant", content: r.content as string,
      citations: parse(r.citations, [] as AskAnswer["citations"]), searched: parse(r.searched, [] as string[]),
      model: (r.model as string) ?? null, created_at: r.created_at as string })),
  };
}

export async function createThread(title: string, channelId: string | null): Promise<string> {
  await ensureTables();
  const id = randomBytes(9).toString("base64url");
  await sql()`insert into chat_threads (id, title, channel_id) values (${id}, ${title.slice(0, 80) || "New chat"}, ${channelId})`;
  return id;
}

export async function addMessage(threadId: string, role: "user" | "assistant", content: string,
  extra: { citations?: AskAnswer["citations"]; searched?: string[]; model?: string } = {}) {
  await ensureTables();
  const db = sql();
  await db`insert into chat_messages (thread_id, role, content, citations, searched, model)
    values (${threadId}, ${role}, ${content}, ${extra.citations ? JSON.stringify(extra.citations) : null},
            ${extra.searched ? JSON.stringify(extra.searched) : null}, ${extra.model ?? null})`;
  await db`update chat_threads set updated_at = (now() at time zone 'utc') where id = ${threadId}`;
}

export async function renameThread(id: string, title: string) {
  await ensureTables();
  await sql()`update chat_threads set title = ${title.trim().slice(0, 80) || "Chat"} where id = ${id}`;
}

export async function deleteThread(id: string) {
  await ensureTables();
  await sql()`delete from chat_threads where id = ${id}`;
}

/** Ask a question inside a conversation: earlier turns give the AI context. Creates the conversation if needed. */
export async function sendChatMessage(threadId: string | null, question: string, channelId: string | null): Promise<{ threadId: string } | { error: string }> {
  const q = question.trim().slice(0, 1000);
  if (q.length < 2) return { error: "Type a question first." };
  const { askComments } = await import("./ask");
  let id = threadId;
  let scope = channelId || null;
  let history: { role: "user" | "assistant"; content: string }[] = [];
  if (id) {
    const t = await getThread(id);
    if (!t) return { error: "That conversation no longer exists." };
    scope = t.thread.channel_id; // a conversation keeps the channel it started with
    history = t.messages.map((m) => ({ role: m.role, content: m.content }));
  } else {
    id = await createThread(q.replace(/\s+/g, " ").slice(0, 70), scope);
  }
  await addMessage(id, "user", q);
  const res = await askComments(q, scope, history);
  if ("error" in res) await addMessage(id, "assistant", `⚠️ ${res.error}`);
  else await addMessage(id, "assistant", res.answer, { citations: res.citations, searched: res.searched, model: res.model });
  return { threadId: id };
}
