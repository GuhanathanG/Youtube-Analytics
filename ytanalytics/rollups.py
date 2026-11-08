"""Running totals of comments, kept exact by the database itself.

A channel with 770k comments made every all-time number (daily chart, sentiment mix, totals, top
comparisons) scan all of them: 5-45 s each on the free database. These small tables hold
the same numbers already added up, so a page adds a few thousand rows instead:

    comment_day     (channel_id, day)                 counts, sentiment, likes, questions, requests
    comment_video   (video_id)                        the same per video
    comment_lang    (channel_id, language)            analysed comments per language
    comment_emotion (channel_id, emotion)             comments per emotion

Statement-level triggers on `comments` keep them up to date for every insert, update and delete
(new comments, AI labels, archiving), from the worker and the website alike. Each statement's changed
rows are added up once (old rows subtracted, new rows added), so batch writes stay cheap.

`ensure_rollups` creates everything once and fills the tables from the existing comments in the same
transaction (writes to `comments` wait for that minute; reads carry on).
"""
from __future__ import annotations

import logging

log = logging.getLogger(__name__)

VERSION = "2"  # bump when the tables or trigger code change: they are rebuilt and refilled

TABLES = """
create table if not exists comment_day (
  channel_id text not null, day date not null,
  comments integer not null default 0, positive integer not null default 0, neutral integer not null default 0,
  negative integer not null default 0, pending integer not null default 0, analyzed integer not null default 0,
  ai_read integer not null default 0, spam integer not null default 0, questions integer not null default 0,
  requests integer not null default 0, likes bigint not null default 0,
  sent_sum double precision not null default 0, sent_n integer not null default 0,
  primary key (channel_id, day));
create table if not exists comment_video (
  video_id text primary key, channel_id text not null,
  comments integer not null default 0, positive integer not null default 0, neutral integer not null default 0,
  negative integer not null default 0, analyzed integer not null default 0, ai_read integer not null default 0,
  questions integer not null default 0, requests integer not null default 0, likes bigint not null default 0,
  sent_sum double precision not null default 0, sent_n integer not null default 0);
create index if not exists ix_comment_video_channel on comment_video (channel_id);
create table if not exists comment_lang (
  channel_id text not null, language text not null, comments integer not null default 0,
  sent_sum double precision not null default 0, sent_n integer not null default 0,
  primary key (channel_id, language));
create table if not exists comment_emotion (
  channel_id text not null, emotion text not null, comments integer not null default 0,
  primary key (channel_id, emotion));
"""

# One "delta" source: the statement's changed rows, old ones counted -1 and new ones +1.
def _apply_sql(source: str) -> str:
    return f"""
  insert into comment_day as t (channel_id, day, comments, positive, neutral, negative, pending, analyzed, ai_read, spam,
      questions, requests, likes, sent_sum, sent_n)
    select channel_id, date(published_at), sum(s), sum(s * coalesce(sentiment = 'positive', false)::int), sum(s * coalesce(sentiment = 'neutral', false)::int),
      sum(s * coalesce(sentiment = 'negative', false)::int), sum(s * (sentiment is null)::int), sum(s * (analyzed_at is not null)::int),
      sum(s * (ai_at is not null)::int), sum(s * coalesce(is_spam, false)::int), sum(s * coalesce(is_question, false)::int),
      sum(s * coalesce(is_suggestion, false)::int), sum(s * coalesce(like_count, 0)), sum(s * coalesce(sentiment_value, 0)),
      sum(s * (sentiment_value is not null)::int)
    from ({source}) d where published_at is not null group by 1, 2 order by 1, 2
  on conflict (channel_id, day) do update set comments = t.comments + excluded.comments, positive = t.positive + excluded.positive,
    neutral = t.neutral + excluded.neutral, negative = t.negative + excluded.negative, pending = t.pending + excluded.pending,
    analyzed = t.analyzed + excluded.analyzed, ai_read = t.ai_read + excluded.ai_read, spam = t.spam + excluded.spam,
    questions = t.questions + excluded.questions, requests = t.requests + excluded.requests, likes = t.likes + excluded.likes,
    sent_sum = t.sent_sum + excluded.sent_sum, sent_n = t.sent_n + excluded.sent_n;

  insert into comment_video as t (video_id, channel_id, comments, positive, neutral, negative, analyzed, ai_read, questions,
      requests, likes, sent_sum, sent_n)
    select video_id, max(channel_id), sum(s), sum(s * coalesce(sentiment = 'positive', false)::int), sum(s * coalesce(sentiment = 'neutral', false)::int),
      sum(s * coalesce(sentiment = 'negative', false)::int), sum(s * (analyzed_at is not null)::int), sum(s * (ai_at is not null)::int),
      sum(s * coalesce(is_question, false)::int), sum(s * coalesce(is_suggestion, false)::int), sum(s * coalesce(like_count, 0)),
      sum(s * coalesce(sentiment_value, 0)), sum(s * (sentiment_value is not null)::int)
    from ({source}) d group by 1 order by 1
  on conflict (video_id) do update set comments = t.comments + excluded.comments, positive = t.positive + excluded.positive,
    neutral = t.neutral + excluded.neutral, negative = t.negative + excluded.negative, analyzed = t.analyzed + excluded.analyzed,
    ai_read = t.ai_read + excluded.ai_read, questions = t.questions + excluded.questions, requests = t.requests + excluded.requests,
    likes = t.likes + excluded.likes, sent_sum = t.sent_sum + excluded.sent_sum, sent_n = t.sent_n + excluded.sent_n;


  insert into comment_lang as t (channel_id, language, comments, sent_sum, sent_n)
    select channel_id, language, sum(s), sum(s * coalesce(sentiment_value, 0)), sum(s * (sentiment_value is not null)::int)
    from ({source}) d where analyzed_at is not null and language is not null group by 1, 2 order by 1, 2
  on conflict (channel_id, language) do update set comments = t.comments + excluded.comments,
    sent_sum = t.sent_sum + excluded.sent_sum, sent_n = t.sent_n + excluded.sent_n;

  insert into comment_emotion as t (channel_id, emotion, comments)
    select channel_id, emotion, sum(s) from ({source}) d where emotion is not null group by 1, 2 order by 1, 2
  on conflict (channel_id, emotion) do update set comments = t.comments + excluded.comments;
"""

COLS = ("channel_id, video_id, author_channel_id, author_name, published_at, like_count, sentiment, sentiment_value, "
        "analyzed_at, ai_at, is_spam, is_question, is_suggestion, language, emotion")
_OLD = f"select {COLS}, -1 as s from old_rows"
_NEW = f"select {COLS}, 1 as s from new_rows"

FUNCTIONS = {
    "rollup_on_insert": _apply_sql(_NEW),
    "rollup_on_delete": _apply_sql(_OLD),
    "rollup_on_update": _apply_sql(f"{_OLD} union all {_NEW}"),
}
TRIGGERS = {
    "trg_rollup_insert": ("INSERT", "REFERENCING NEW TABLE AS new_rows", "rollup_on_insert"),
    "trg_rollup_delete": ("DELETE", "REFERENCING OLD TABLE AS old_rows", "rollup_on_delete"),
    "trg_rollup_update": ("UPDATE", "REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows", "rollup_on_update"),
}
ALL_TABLES = ["comment_day", "comment_video", "comment_lang", "comment_emotion"]


def _split(script: str) -> list[str]:
    return [x.strip() for x in script.split(";") if x.strip()]


def ensure_rollups(engine) -> bool:
    """Create the tables and triggers and fill them once (Postgres only). Returns True if it (re)built them."""
    if engine.dialect.name != "postgresql":
        return False
    from sqlalchemy import text

    with engine.connect() as conn:
        have = conn.execute(text("select value from schema_meta where key = 'rollups'")).scalar()
        triggers = set(conn.execute(text("select tgname from pg_trigger where tgrelid = 'comments'::regclass")).scalars())
    if have == VERSION and set(TRIGGERS) <= triggers:
        return False
    log.info("Building comment running totals (one-time, about a minute on a big database)")
    with engine.begin() as conn:
        conn.execute(text("set local lock_timeout = '20s'"))
        conn.execute(text("set local statement_timeout = 0"))
        # Writers wait while the totals are filled from a fixed picture of the comments; readers carry on.
        conn.execute(text("lock table comments in share row exclusive mode"))
        for name in TRIGGERS:
            conn.execute(text(f"drop trigger if exists {name} on comments"))
        conn.execute(text("drop table if exists comment_author"))  # per-commenter totals: too big for the free plan
        for stmt in _split(TABLES):
            conn.execute(text(stmt))
        for t in ALL_TABLES:
            conn.execute(text(f"truncate {t}"))
            conn.execute(text(f"alter table {t} enable row level security"))  # same as every table: no public API access
        for fn, body in FUNCTIONS.items():
            conn.execute(text(f"create or replace function {fn}() returns trigger language plpgsql as $f$ begin {body} return null; end $f$"))
        # Fill from the existing comments (the same arithmetic as the triggers, all counted +1).
        for stmt in _split(_apply_sql(f"select {COLS}, 1 as s from comments")):
            conn.execute(text(stmt))
        for name, (event, ref, fn) in TRIGGERS.items():
            conn.execute(text(f"create trigger {name} after {event} on comments {ref} for each statement execute function {fn}()"))
        conn.execute(text("insert into schema_meta (key, value) values ('rollups', :v) on conflict (key) do update set value = excluded.value"),
                     {"v": VERSION})
    log.info("Comment running totals ready")
    return True
