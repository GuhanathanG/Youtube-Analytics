import "server-only";
import { sql } from "./db";
import { judge, type EngineCheck } from "./freshness-math";

/**
 * Engine freshness watchdog (E1): one cheap query per engine, judged against docs/ENGINES_PHASE.md's limits.
 * Shown on the Manage page and checked by the engine's health turn (Telegram alert when red).
 */
const mins = (v: unknown) => (v === null || v === undefined ? null : Math.max(0, Number(v)));

export async function engineFreshness(): Promise<EngineCheck[]> {
  const db = sql();
  const one = async <T,>(q: Promise<T[]>, fallback: T): Promise<T> => (await q.catch(() => [fallback]))[0] ?? fallback;

  const [live, job, yt, ytStats, igProf, igCom, ai, fc, vid, tr, trs, hasYt, hasIg] = await Promise.all([
    one(db`select extract(epoch from (now() at time zone 'utc') - max(last_cron_at)) / 60 as m from live_state`, { m: null }),
    one(db`select extract(epoch from (now() at time zone 'utc') - max(started_at)) / 60 as m from run_log`, { m: null }),
    one(db`select extract(epoch from (now() at time zone 'utc') - max(c.fetched_at)) / 60 as m from comments c
      where c.fetched_at >= (now() at time zone 'utc') - interval '7 days'
        and c.channel_id in (select id from channels where active and coalesce(platform, 'youtube') = 'youtube')`, { m: null }),
    one(db`select extract(epoch from (now() at time zone 'utc') - max(s.taken_at)) / 60 as m from channel_snapshots s
      where s.taken_at >= (now() at time zone 'utc') - interval '7 days'
        and s.channel_id in (select id from channels where active and coalesce(platform, 'youtube') = 'youtube')`, { m: null }),
    // The stalest Instagram account decides (each should refresh every 2 h).
    one(db`select max(m) as m from (select extract(epoch from (now() at time zone 'utc') - max(r.started_at)) / 60 as m from channels c
        left join ig_runs r on r.channel_id = c.id and r.kind = 'details' and r.status = 'SUCCEEDED'
        where c.active and c.platform = 'instagram' group by c.id) x`, { m: null }),
    // Recent posts with comments that were never read, counted once they're older than the limit.
    one(db`select count(*) filter (where v.published_at < (now() at time zone 'utc') - interval '6 hours')::int as stuck,
        extract(epoch from (now() at time zone 'utc') - min(v.published_at)) / 60 as m
      from videos v join channels c on c.id = v.channel_id
      where c.active and c.platform = 'instagram' and v.comment_count > 0 and not coalesce(v.comments_disabled, false)
        and v.comment_count_checked is null and v.published_at >= (now() at time zone 'utc') - interval '3 days'`, { stuck: 0, m: null }),
    one(db`select count(*) filter (where fetched_at < (now() at time zone 'utc') - interval '2 hours')::int as stuck, extract(epoch from (now() at time zone 'utc') - min(fetched_at)) / 60 as m
      from comments where ai_at is null`, { stuck: 0, m: null }),
    one(db`select extract(epoch from (now() at time zone 'utc') - max(updated_at)) / 60 as m from video_forecast`, { m: null }),
    one(db`select count(*)::int as stuck, extract(epoch from (now() at time zone 'utc') - min(v.published_at)) / 60 as m from videos v join channels c on c.id = v.channel_id
      where c.active and v.published_at >= (now() at time zone 'utc') - interval '7 days' and v.published_at < (now() at time zone 'utc') - interval '12 hours'
        and (c.platform is null or c.platform = 'youtube' or v.media_url is not null)
        and not exists (select 1 from video_analysis a where a.video_id = v.id)`, { stuck: 0, m: null }),
    one(db`select count(*)::int as stuck, extract(epoch from (now() at time zone 'utc') - min(v.published_at)) / 60 as m from videos v join channels c on c.id = v.channel_id
      where c.active and coalesce(c.platform, 'youtube') = 'youtube'
        and v.published_at >= (now() at time zone 'utc') - interval '7 days' and v.published_at < (now() at time zone 'utc') - interval '12 hours'
        and not exists (select 1 from video_transcripts t where t.video_id = v.id and t.status in ('ok', 'none'))`, { stuck: -1, m: null }),
    one(db`select count(*) filter (where status = 'ok')::int as ok, count(*) filter (where status = 'blocked')::int as blocked
      from video_transcripts`, { ok: 0, blocked: 0 }),
    one(db`select count(*)::int as n from channels where active and coalesce(platform, 'youtube') = 'youtube'`, { n: 0 }),
    one(db`select count(*)::int as n from channels where active and platform = 'instagram'`, { n: 0 }),
  ]);

  const checks: EngineCheck[] = [
    judge("live", mins(live.m), 0, "not started yet (set up the cron-job.org timer)"),
    judge("job", mins(job.m), 0, "hasn't run yet"),
  ];
  if (Number(hasYt.n)) {
    checks.push(judge("yt_comments", mins(yt.m), 0, "no comments yet"));
    checks.push(judge("yt_stats", mins(ytStats.m), 0, "no snapshots yet"));
  }
  if (Number(hasIg.n)) {
    checks.push(judge("ig_profiles", mins(igProf.m), 0, "no check yet"));
    checks.push(judge("ig_comments", Number(igCom.stuck) ? mins(igCom.m) : null, Number(igCom.stuck), "all recent posts read"));
  }
  checks.push(judge("ai", Number(ai.stuck) ? mins(ai.m) : null, Number(ai.stuck), "nothing waiting"));
  checks.push(judge("forecasts", mins(fc.m), 0, "not trained yet"));
  checks.push(judge("video_ai", Number(vid.stuck) ? mins(vid.m) : null, Number(vid.stuck), "every new upload analysed"));
  if (Number(tr.stuck) >= 0) {
    // YouTube refuses caption downloads from many cloud machines: that's a known limit, not a broken engine.
    const blockedOnly = Number(trs.blocked) > 0 && Number(trs.ok) === 0;
    checks.push(blockedOnly ? judge("transcripts", null, 0, "YouTube blocks caption downloads from the worker's servers; retried daily")
      : judge("transcripts", Number(tr.stuck) ? mins(tr.m) : null, Number(tr.stuck), "every new upload has its transcript"));
  }
  return checks;
}
