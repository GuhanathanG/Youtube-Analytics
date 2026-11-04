"""Read-only queries used by the dashboard. Portable between SQLite and PostgreSQL."""
from __future__ import annotations

from datetime import datetime

import pandas as pd
from sqlalchemy import text
from sqlalchemy.engine import Engine

from .youtube import quota_day

LANGUAGE_NAMES = {
    "en": "English", "ta": "Tamil", "ta-Latn": "Tanglish (romanized Tamil)",
    "hi": "Hindi", "hi-Latn": "Hinglish (romanized Hindi)", "te": "Telugu", "kn": "Kannada",
    "ml": "Malayalam", "bn": "Bengali", "mr": "Marathi", "gu": "Gujarati", "pa": "Punjabi",
    "ur": "Urdu", "ar": "Arabic", "fa": "Persian", "si": "Sinhala", "ne": "Nepali", "or": "Odia",
    "es": "Spanish", "fr": "French", "de": "German", "pt": "Portuguese", "it": "Italian",
    "ru": "Russian", "ja": "Japanese", "ko": "Korean", "zh": "Chinese", "id": "Indonesian",
    "tl": "Tagalog", "vi": "Vietnamese", "th": "Thai", "tr": "Turkish", "nl": "Dutch",
    "und": "Unknown / emoji only",
}


FLAGS = {"question": "is_question", "suggestion": "is_suggestion", "spam": "is_spam", "toxic": "is_toxic"}
ASPECT_LABELS = {
    "content": "Content / topic", "host": "Host / creator", "editing": "Editing", "audio": "Audio",
    "video_quality": "Video quality", "thumbnail_title": "Thumbnail & title", "length_pacing": "Length & pacing",
    "music": "Music", "ads_sponsor": "Ads & sponsors", "information": "Information / accuracy",
    "humor": "Humour", "guest": "Guests", "other": "Other",
}


def language_name(code: str | None) -> str:
    if not code:
        return "Not analyzed yet"
    return LANGUAGE_NAMES.get(code, code)


def _df(engine: Engine, sql: str, **params) -> pd.DataFrame:
    with engine.connect() as conn:
        return pd.read_sql(text(sql), conn, params=params)


def _filters(channel_id: str | None = None, video_id: str | None = None,
             since: datetime | None = None, until: datetime | None = None,
             sentiment: str | None = None, language: str | None = None,
             search: str | None = None, top_level_only: bool = False,
             emotion: str | None = None, flag: str | None = None, hide_spam: bool = False,
             alias: str = "c") -> tuple[str, dict]:
    where, params = ["1=1"], {}
    if channel_id:
        where.append(f"{alias}.channel_id = :channel_id")
        params["channel_id"] = channel_id
    if video_id:
        where.append(f"{alias}.video_id = :video_id")
        params["video_id"] = video_id
    if since:
        where.append(f"{alias}.published_at >= :since")
        params["since"] = since
    if until:
        where.append(f"{alias}.published_at < :until")
        params["until"] = until
    if sentiment:
        where.append(f"{alias}.sentiment = :sentiment")
        params["sentiment"] = sentiment
    if language:
        where.append(f"{alias}.language = :language")
        params["language"] = language
    if search:
        where.append(f"lower({alias}.text) LIKE :search")
        params["search"] = f"%{search.lower()}%"
    if top_level_only:
        where.append(f"{alias}.parent_id IS NULL")
    if emotion:
        where.append(f"{alias}.emotion = :emotion")
        params["emotion"] = emotion
    if flag in FLAGS:
        where.append(f"{alias}.{FLAGS[flag]} = :flag_true")
        params["flag_true"] = True
    if hide_spam:
        where.append(f"({alias}.is_spam IS NULL OR {alias}.is_spam = :flag_false)")
        params["flag_false"] = False
    return " AND ".join(where), params


def kpis(engine: Engine) -> dict:
    df = _df(engine, """
        SELECT
          (SELECT count(*) FROM channels WHERE active) AS channels,
          (SELECT count(*) FROM videos) AS videos,
          (SELECT count(*) FROM comments) AS comments,
          (SELECT count(*) FROM comments WHERE analyzed_at IS NOT NULL) AS analyzed,
          (SELECT count(*) FROM comments WHERE ai_at IS NOT NULL) AS ai_read,
          (SELECT count(*) FROM videos WHERE comments_backfilled = :f AND comments_disabled = :f)
              AS videos_backfilling,
          (SELECT max(fetched_at) FROM comments) AS last_comment_fetch
    """, f=False)
    row = df.iloc[0].to_dict()
    q = _df(engine, "SELECT units FROM quota_usage WHERE day = :d", d=quota_day())
    row["quota_used_today"] = int(q["units"].iloc[0]) if len(q) else 0
    return row


def channels_overview(engine: Engine) -> pd.DataFrame:
    return _df(engine, """
        SELECT ch.id, ch.title, ch.handle, ch.thumbnail_url, ch.subscriber_count, ch.view_count,
               ch.video_count, ch.active, ch.last_synced_at,
               coalesce(v.videos_stored, 0) AS videos_stored,
               coalesce(v.videos_done, 0) AS videos_backfilled,
               coalesce(c.comments, 0) AS comments,
               coalesce(c.positive, 0) AS positive,
               coalesce(c.neutral, 0) AS neutral,
               coalesce(c.negative, 0) AS negative,
               c.avg_sentiment
        FROM channels ch
        LEFT JOIN (
            SELECT channel_id, count(*) AS videos_stored,
                   sum(CASE WHEN comments_backfilled THEN 1 ELSE 0 END) AS videos_done
            FROM videos GROUP BY channel_id
        ) v ON v.channel_id = ch.id
        LEFT JOIN (
            SELECT channel_id, count(*) AS comments,
                   sum(CASE WHEN sentiment = 'positive' THEN 1 ELSE 0 END) AS positive,
                   sum(CASE WHEN sentiment = 'neutral' THEN 1 ELSE 0 END) AS neutral,
                   sum(CASE WHEN sentiment = 'negative' THEN 1 ELSE 0 END) AS negative,
                   avg(sentiment_value) AS avg_sentiment
            FROM comments GROUP BY channel_id
        ) c ON c.channel_id = ch.id
        ORDER BY ch.title
    """)


def videos_overview(engine: Engine, channel_id: str) -> pd.DataFrame:
    return _df(engine, """
        SELECT v.id, v.title, v.published_at, v.view_count, v.like_count,
               v.comment_count AS comments_on_youtube, v.comments_disabled, v.comments_backfilled,
               coalesce(c.stored, 0) AS comments_stored,
               coalesce(c.positive, 0) AS positive,
               coalesce(c.neutral, 0) AS neutral,
               coalesce(c.negative, 0) AS negative,
               c.avg_sentiment
        FROM videos v
        LEFT JOIN (
            SELECT video_id, count(*) AS stored,
                   sum(CASE WHEN sentiment = 'positive' THEN 1 ELSE 0 END) AS positive,
                   sum(CASE WHEN sentiment = 'neutral' THEN 1 ELSE 0 END) AS neutral,
                   sum(CASE WHEN sentiment = 'negative' THEN 1 ELSE 0 END) AS negative,
                   avg(sentiment_value) AS avg_sentiment
            FROM comments WHERE channel_id = :channel_id GROUP BY video_id
        ) c ON c.video_id = v.id
        WHERE v.channel_id = :channel_id
        ORDER BY v.published_at DESC
    """, channel_id=channel_id)


def daily_sentiment(engine: Engine, **filters) -> pd.DataFrame:
    """Comments per day split by sentiment label."""
    where, params = _filters(**filters)
    df = _df(engine, f"""
        SELECT date(c.published_at) AS day, coalesce(c.sentiment, 'pending') AS sentiment,
               count(*) AS comments, avg(c.sentiment_value) AS avg_value
        FROM comments c WHERE {where}
        GROUP BY date(c.published_at), coalesce(c.sentiment, 'pending')
        ORDER BY day
    """, **params)
    if len(df):
        df["day"] = pd.to_datetime(df["day"])
    return df


def sentiment_counts(engine: Engine, **filters) -> pd.DataFrame:
    where, params = _filters(**filters)
    return _df(engine, f"""
        SELECT coalesce(c.sentiment, 'pending') AS sentiment, count(*) AS comments
        FROM comments c WHERE {where}
        GROUP BY coalesce(c.sentiment, 'pending')
    """, **params)


def language_counts(engine: Engine, **filters) -> pd.DataFrame:
    where, params = _filters(**filters)
    df = _df(engine, f"""
        SELECT c.language, count(*) AS comments,
               avg(c.sentiment_value) AS avg_sentiment,
               sum(CASE WHEN c.sentiment = 'negative' THEN 1 ELSE 0 END) AS negative
        FROM comments c WHERE {where} AND c.analyzed_at IS NOT NULL
        GROUP BY c.language ORDER BY count(*) DESC
    """, **params)
    df["language_name"] = df["language"].map(language_name)
    return df


def comments(engine: Engine, limit: int = 500, order: str = "newest", **filters) -> pd.DataFrame:
    where, params = _filters(**filters)
    order_sql = {
        "newest": "c.published_at DESC",
        "oldest": "c.published_at ASC",
        "most_liked": "c.like_count DESC",
        "most_negative": "c.sentiment_value ASC",
        "most_positive": "c.sentiment_value DESC",
    }.get(order, "c.published_at DESC")
    params["limit"] = int(limit)
    if order in ("most_negative", "most_positive"):
        where += " AND c.sentiment_value IS NOT NULL"
    df = _df(engine, f"""
        SELECT c.published_at, c.author_name, c.text, c.translation, c.like_count, c.reply_count,
               c.sentiment, c.sentiment_value, c.sentiment_source, c.emotion, c.language,
               c.is_question, c.is_suggestion, c.is_spam, c.parent_id IS NOT NULL AS is_reply,
               v.title AS video_title, c.video_id, c.id
        FROM comments c JOIN videos v ON v.id = c.video_id
        WHERE {where}
        ORDER BY {order_sql}
        LIMIT :limit
    """, **params)
    df["language"] = df["language"].map(language_name)
    return df


def channel_snapshots(engine: Engine, channel_id: str) -> pd.DataFrame:
    df = _df(engine, """
        SELECT taken_at, subscriber_count, view_count, video_count
        FROM channel_snapshots WHERE channel_id = :cid ORDER BY taken_at
    """, cid=channel_id)
    if len(df):
        df["taken_at"] = pd.to_datetime(df["taken_at"])
    return df


def video_snapshots(engine: Engine, video_id: str) -> pd.DataFrame:
    df = _df(engine, """
        SELECT taken_at, view_count, like_count, comment_count
        FROM video_snapshots WHERE video_id = :vid ORDER BY taken_at
    """, vid=video_id)
    if len(df):
        df["taken_at"] = pd.to_datetime(df["taken_at"])
    return df


def recent_runs(engine: Engine, limit: int = 20) -> pd.DataFrame:
    return _df(engine, """
        SELECT kind, started_at, finished_at, status, summary
        FROM run_log ORDER BY started_at DESC LIMIT :limit
    """, limit=limit)


def channel_requests(engine: Engine) -> pd.DataFrame:
    return _df(engine, """
        SELECT query, status, error, created_at FROM channel_requests
        ORDER BY created_at DESC LIMIT 50
    """)


def emotion_counts(engine: Engine, **filters) -> pd.DataFrame:
    where, params = _filters(**filters)
    return _df(engine, f"""
        SELECT c.emotion, count(*) AS comments FROM comments c
        WHERE {where} AND c.emotion IS NOT NULL
        GROUP BY c.emotion ORDER BY count(*) DESC
    """, **params)


def aspect_counts(engine: Engine, **filters) -> pd.DataFrame:
    """How often each aspect is praised / criticised. One row per aspect."""
    where, params = _filters(**filters)
    sums = []
    for name in ASPECT_LABELS:
        for pol in ("pos", "neg", "neu"):
            sums.append(f"sum(CASE WHEN c.aspects LIKE '%{name}:{pol}%' THEN 1 ELSE 0 END) AS {name}__{pol}")
    df = _df(engine, f"SELECT {', '.join(sums)} FROM comments c WHERE {where} AND c.aspects IS NOT NULL",
             **params)
    rows = []
    if len(df):
        r = df.iloc[0].fillna(0)
        for name, label in ASPECT_LABELS.items():
            pos, neg, neu = (int(r[f"{name}__{p}"]) for p in ("pos", "neg", "neu"))
            if pos + neg + neu:
                rows.append({"aspect": label, "positive": pos, "negative": neg, "neutral": neu,
                             "mentions": pos + neg + neu})
    return pd.DataFrame(rows, columns=["aspect", "positive", "negative", "neutral", "mentions"])


def latest_insight(engine: Engine, scope: str, target_id: str) -> dict | None:
    df = _df(engine, """
        SELECT created_at, comment_count, model, data FROM insights
        WHERE scope = :scope AND target_id = :tid ORDER BY created_at DESC LIMIT 1
    """, scope=scope, tid=target_id)
    if df.empty:
        return None
    import json

    row = df.iloc[0]
    try:
        data = json.loads(row["data"])
    except ValueError:
        return None
    return {"data": data, "created_at": row["created_at"], "comment_count": int(row["comment_count"]),
            "model": row["model"]}


def llm_usage_today(engine: Engine) -> pd.DataFrame:
    return _df(engine, """
        SELECT model_key AS model, requests, tokens, exhausted, last_error
        FROM llm_usage WHERE day = :d ORDER BY model_key
    """, d=quota_day())


def actions_minutes_this_month(engine: Engine) -> int:
    from datetime import datetime as _dt
    import math

    start = _dt.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    df = _df(engine, """
        SELECT started_at, finished_at FROM run_log
        WHERE kind = 'job' AND started_at >= :start AND finished_at IS NOT NULL
    """, start=start)
    if df.empty:
        return 0
    secs = (pd.to_datetime(df["finished_at"]) - pd.to_datetime(df["started_at"])).dt.total_seconds()
    return int(sum(max(1, math.ceil(x / 60)) for x in secs))
