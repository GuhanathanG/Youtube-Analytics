import "server-only";
import { sql, ensureRls, ensureIndex } from "./db";
import { goalView, pacePerDay, rateAround, type GoalView, type Point } from "./growth-math";

/**
 * Goals & milestones (subscribers/followers, total views, uploads) with a predicted date from the growth
 * snapshots, and a title-change tracker: a database trigger records every title change on a YouTube video
 * (by the worker or anyone), so the effect is measured from the view snapshots before and after.
 */
let ready = false;
async function ensureTables() {
  if (ready) return;
  const db = sql();
  await db`create table if not exists goals (id serial primary key, channel_id text not null, metric text not null,
    target double precision not null, deadline date, created_at timestamp not null default (now() at time zone 'utc'))`;
  await db`create table if not exists video_changes (id serial primary key, video_id text not null, field text not null,
    old_value text, new_value text, changed_at timestamp not null, views_at double precision)`;
  await ensureIndex("ix_video_changes_video", "create index if not exists ix_video_changes_video on video_changes (video_id, changed_at desc)");
  await ensureRls("goals");
  await ensureRls("video_changes");
  const [t] = await db`select 1 from pg_trigger where tgname = 'trg_video_title_change'`;
  if (!t) {
    await db.unsafe(`create or replace function record_video_title_change() returns trigger language plpgsql as $f$
      begin
        if new.id not like 'ig\\_%' and old.title is not null and new.title is distinct from old.title then
          insert into video_changes (video_id, field, old_value, new_value, changed_at, views_at)
          values (new.id, 'title', old.title, new.title, now() at time zone 'utc', old.view_count);
        end if;
        return new;
      end $f$`);
    await db.unsafe(`do $d$ begin
        if not exists (select 1 from pg_trigger where tgname = 'trg_video_title_change') then
          create trigger trg_video_title_change after update of title on videos for each row execute function record_video_title_change();
        end if;
      end $d$`);
  }
  ready = true;
}

export const METRICS: Record<string, { label: string; col: "subscriber_count" | "view_count" | "video_count" }> = {
  subscribers: { label: "Subscribers / followers", col: "subscriber_count" },
  views: { label: "Total views", col: "view_count" },
  videos: { label: "Uploads", col: "video_count" },
};

export type Goal = { id: number; channel_id: string; channel: string; metric: string; deadline: string | null; view: GoalView; days: number };

export async function goals(): Promise<Goal[]> {
  await ensureTables();
  const db = sql();
  const rows = await db`select g.id, g.channel_id, g.metric, g.target, g.deadline::text as deadline, c.title as channel,
      c.subscriber_count::float8 as subscriber_count, c.view_count::float8 as view_count, c.video_count::float8 as video_count
    from goals g join channels c on c.id = g.channel_id order by g.created_at`;
  if (!rows.length) return [];
  const snaps = await db`select channel_id, extract(epoch from taken_at) * 1000 as t, subscriber_count::float8 as subscriber_count,
      view_count::float8 as view_count, video_count::float8 as video_count
    from channel_snapshots where channel_id in ${db([...new Set(rows.map((r) => r.channel_id as string))])}
      and taken_at >= (now() at time zone 'utc') - interval '60 days'`;
  return rows.map((r) => {
    const m = METRICS[r.metric as string] ?? METRICS.subscribers;
    const pts: Point[] = snaps.filter((s) => s.channel_id === r.channel_id && s[m.col] !== null).map((s) => ({ t: Number(s.t), v: Number(s[m.col]) }));
    const days = pts.length ? (Math.max(...pts.map((p) => p.t)) - Math.min(...pts.map((p) => p.t))) / 86400_000 : 0;
    return { id: r.id as number, channel_id: r.channel_id as string, channel: r.channel as string, metric: r.metric as string, deadline: r.deadline as string | null,
      view: goalView(Number(r[m.col] ?? 0), Number(r.target), pacePerDay(pts), r.deadline ? new Date(`${r.deadline}T00:00:00Z`) : null), days };
  });
}

export async function addGoal(channelId: string, metric: string, target: number, deadline: string | null) {
  await ensureTables();
  if (!METRICS[metric] || !(target > 0)) throw new Error("Pick a metric and a target above zero.");
  await sql()`insert into goals (channel_id, metric, target, deadline) values (${channelId}, ${metric}, ${target}, ${deadline})`;
}
export async function deleteGoal(id: number) { await ensureTables(); await sql()`delete from goals where id = ${id}`; }

export type Change = { id: number; video_id: string; title: string; channel: string; old_value: string; new_value: string; changed_at: string;
  before: number | null; after: number | null; lift: number | null };

export async function titleChanges(limit = 30): Promise<Change[]> {
  await ensureTables();
  const db = sql();
  const rows = await db`select x.id, x.video_id, x.old_value, x.new_value, x.changed_at::text as changed_at,
      extract(epoch from x.changed_at) * 1000 as at, v.title, c.title as channel
    from video_changes x join videos v on v.id = x.video_id join channels c on c.id = v.channel_id
    where x.field = 'title' order by x.changed_at desc limit ${limit}`;
  if (!rows.length) return [];
  const snaps = await db`select video_id, extract(epoch from taken_at) * 1000 as t, view_count::float8 as v from video_snapshots
    where video_id in ${db([...new Set(rows.map((r) => r.video_id as string))])} and view_count is not null`;
  return rows.map((r) => {
    const pts = snaps.filter((s) => s.video_id === r.video_id).map((s) => ({ t: Number(s.t), v: Number(s.v) }));
    return { id: r.id as number, video_id: r.video_id as string, title: r.title as string, channel: r.channel as string,
      old_value: r.old_value as string, new_value: r.new_value as string, changed_at: r.changed_at as string, ...rateAround(pts, Number(r.at)) };
  });
}
