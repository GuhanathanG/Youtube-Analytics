"""Creator Analytics dashboard (Streamlit).

Run locally:   streamlit run streamlit_app.py
Hosted free:   Streamlit Community Cloud (see README).
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st
from sqlalchemy import update

from ytanalytics import queries as q
from ytanalytics.config import normalize_db_url
from ytanalytics.db import Channel, ChannelRequest, init_db, make_engine, make_session_factory

st.set_page_config(page_title="Creator Analytics", page_icon="📊", layout="wide")

# Sentiment is a polarity scale: two opposite poles and a neutral gray between them.
SENTIMENT_COLORS = {
    "positive": "#2a78d6",
    "neutral": "#a8a69f",
    "negative": "#e34948",
    "pending": "#e1e0d9",
}
SENTIMENT_ORDER = ["negative", "neutral", "positive", "pending"]
CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]


def secret(name: str, default: str = "") -> str:
    try:
        if name in st.secrets:
            return str(st.secrets[name])
    except Exception:  # no secrets file
        pass
    return os.environ.get(name, default)


@st.cache_resource
def get_engine():
    engine = make_engine(normalize_db_url(secret("DATABASE_URL", "sqlite:///ytanalytics.db")))
    init_db(engine)
    return engine


engine = get_engine()
SessionLocal = make_session_factory(engine)


# ---------------------------------------------------------------------------- auth
def check_password() -> bool:
    password = secret("APP_PASSWORD")
    if not password or st.session_state.get("authed"):
        return True
    st.title("📊 Creator Analytics")
    entered = st.text_input("Password", type="password")
    if entered:
        if entered == password:
            st.session_state["authed"] = True
            st.rerun()
        st.error("Wrong password")
    return False


if not check_password():
    st.stop()


# ---------------------------------------------------------------------------- cached data
@st.cache_data(ttl=300)
def load_kpis():
    return q.kpis(engine)


@st.cache_data(ttl=300)
def load_channels():
    return q.channels_overview(engine)


@st.cache_data(ttl=300)
def load_videos(channel_id):
    return q.videos_overview(engine, channel_id)


@st.cache_data(ttl=300)
def load_daily(**filters):
    return q.daily_sentiment(engine, **filters)


@st.cache_data(ttl=300)
def load_sentiment_counts(**filters):
    return q.sentiment_counts(engine, **filters)


@st.cache_data(ttl=300)
def load_languages(**filters):
    return q.language_counts(engine, **filters)


@st.cache_data(ttl=120)
def load_comments(limit, order, **filters):
    return q.comments(engine, limit=limit, order=order, **filters)


@st.cache_data(ttl=300)
def load_emotions(**filters):
    return q.emotion_counts(engine, **filters)


@st.cache_data(ttl=300)
def load_aspects(**filters):
    return q.aspect_counts(engine, **filters)


@st.cache_data(ttl=300)
def load_insight(scope, target_id):
    return q.latest_insight(engine, scope, target_id)


# ---------------------------------------------------------------------------- helpers
def fmt(n) -> str:
    if n is None or (isinstance(n, float) and pd.isna(n)):
        return "–"
    n = float(n)
    for unit, div in (("B", 1e9), ("M", 1e6), ("K", 1e3)):
        if abs(n) >= div:
            return f"{n / div:.1f}{unit}"
    return f"{n:,.0f}"


def sentiment_score_label(value) -> str:
    """Average of (positive prob - negative prob), shown on a -100..+100 scale."""
    if value is None or pd.isna(value):
        return "–"
    return f"{value * 100:+.0f}"


def period_picker(key: str) -> datetime | None:
    choice = st.selectbox("Period", ["Last 7 days", "Last 30 days", "Last 90 days", "Last 365 days",
                                     "All time"], index=4, key=key)
    days = {"Last 7 days": 7, "Last 30 days": 30, "Last 90 days": 90, "Last 365 days": 365}.get(choice)
    return datetime.utcnow() - timedelta(days=days) if days else None


def sentiment_trend_chart(daily: pd.DataFrame, title: str):
    if daily.empty:
        st.info("No comments in this period yet.")
        return
    span_days = (daily["day"].max() - daily["day"].min()).days
    freq = "D" if span_days <= 60 else ("W-MON" if span_days <= 730 else "MS")
    grouped = (daily.groupby([pd.Grouper(key="day", freq=freq), "sentiment"])["comments"]
               .sum().reset_index())
    fig = px.bar(grouped, x="day", y="comments", color="sentiment",
                 color_discrete_map=SENTIMENT_COLORS,
                 category_orders={"sentiment": SENTIMENT_ORDER},
                 labels={"day": "", "comments": "Comments", "sentiment": "Sentiment"})
    fig.update_layout(title=title, barmode="stack", bargap=0.25, legend_title_text="",
                      legend=dict(orientation="h", y=1.12, x=0), margin=dict(t=70, b=10),
                      hovermode="x unified")
    fig.update_traces(marker_line_width=0)
    st.plotly_chart(fig, use_container_width=True)


def sentiment_mix_bar(counts: pd.DataFrame):
    """One horizontal 100% bar — clearer than a donut for three parts."""
    if counts.empty:
        return
    total = counts["comments"].sum()
    fig = go.Figure()
    for label in SENTIMENT_ORDER:
        n = int(counts.loc[counts["sentiment"] == label, "comments"].sum())
        if not n:
            continue
        pct = n / total * 100
        fig.add_bar(y=[""], x=[pct], orientation="h", name=label.capitalize(),
                    marker_color=SENTIMENT_COLORS[label],
                    text=f"{label.capitalize()} {pct:.0f}%" if pct >= 8 else "",
                    textposition="inside", insidetextanchor="middle",
                    hovertemplate=f"{label.capitalize()}: {n:,} comments ({pct:.1f}%)<extra></extra>")
    fig.update_layout(barmode="stack", height=110, margin=dict(t=10, b=10, l=10, r=10),
                      xaxis=dict(visible=False, range=[0, 100]), yaxis=dict(visible=False),
                      legend=dict(orientation="h", y=-0.2, traceorder="normal"), showlegend=True)
    fig.update_traces(marker_line_width=2, marker_line_color="rgba(0,0,0,0)")
    st.plotly_chart(fig, use_container_width=True)


def language_chart(langs: pd.DataFrame):
    if langs.empty:
        st.info("Languages appear once comments are analyzed.")
        return
    top = langs.head(8).copy()
    if len(langs) > 8:
        rest = langs.iloc[8:]
        top = pd.concat([top.head(7), pd.DataFrame([{
            "language_name": "Other", "comments": rest["comments"].sum() + langs.iloc[7]["comments"],
        }])])
    top = top.iloc[::-1]
    fig = px.bar(top, x="comments", y="language_name", orientation="h",
                 labels={"comments": "Comments", "language_name": ""})
    fig.update_traces(marker_color=CATEGORICAL[0], hovertemplate="%{y}: %{x:,} comments<extra></extra>")
    fig.update_layout(height=60 + 34 * len(top), margin=dict(t=10, b=10), bargap=0.35)
    st.plotly_chart(fig, use_container_width=True)


def comment_table(df: pd.DataFrame, show_video: bool = True):
    if df.empty:
        st.info("No comments match these filters.")
        return
    view = df.copy()
    view["sentiment"] = view["sentiment"].fillna("pending")
    view["score"] = (view["sentiment_value"] * 100).round(0)
    view["translation"] = view["translation"].fillna("")
    view["emotion"] = view["emotion"].map(lambda e: f"{EMOTION_ICONS.get(e, '')} {e}" if e else "")
    view["sentiment"] = view.apply(
        lambda r: f"{r.sentiment} 🤖" if r.get("sentiment_source") == "ai" else r.sentiment, axis=1)
    cols = ["published_at", "author_name", "text", "translation", "sentiment", "score", "emotion", "language",
            "like_count", "reply_count"]
    if show_video:
        cols.append("video_title")
    st.dataframe(
        view[cols],
        use_container_width=True,
        hide_index=True,
        column_config={
            "published_at": st.column_config.DatetimeColumn("Posted", format="YYYY-MM-DD HH:mm"),
            "author_name": "Author",
            "text": st.column_config.TextColumn("Comment", width="large"),
            "translation": st.column_config.TextColumn("English (AI)", width="medium"),
            "sentiment": st.column_config.TextColumn("Sentiment", help="🤖 = checked by the AI"),
            "emotion": "Emotion",
            "score": st.column_config.NumberColumn("Score", help="-100 very negative … +100 very positive"),
            "language": "Language",
            "like_count": st.column_config.NumberColumn("Likes", format="%d"),
            "reply_count": st.column_config.NumberColumn("Replies", format="%d"),
            "video_title": "Video",
        },
    )


EMOTION_ICONS = {
    "joy": "😄", "love": "❤️", "gratitude": "🙏", "admiration": "🤩", "excitement": "🔥", "humor": "😂",
    "surprise": "😮", "curiosity": "🤔", "neutral": "😐", "confusion": "😕", "disappointment": "😞",
    "sadness": "😢", "anger": "😠", "disgust": "🤢", "fear": "😨", "sarcasm": "🙃",
}


def _bullets(items) -> str:
    items = [i for i in (items or []) if i]
    return "\n".join(f"- {i}" for i in items) if items else "_Nothing notable yet._"


def insight_panel(scope: str, target_id: str):
    ins = load_insight(scope, target_id)
    with st.container(border=True):
        st.markdown("#### 🤖 AI insights")
        if ins is None:
            st.caption("Not written yet. Insights appear once there are enough comments and an AI key "
                       "(GEMINI_API_KEY or GROQ_API_KEY) is set up — see the README.")
            return
        d = ins["data"]
        when = pd.to_datetime(ins["created_at"])
        st.caption(f"Written {when:%Y-%m-%d %H:%M} UTC from {ins['comment_count']:,} comments · {ins['model']}")
        if d.get("summary"):
            st.markdown(d["summary"])
        extra = [x for x in (d.get("mood"), d.get("trend")) if x]
        if extra:
            st.markdown(" · ".join(f"**{x}**" if i == 0 else x for i, x in enumerate(extra)))
        if d.get("audience_profile"):
            st.markdown(f"**Audience:** {d['audience_profile']}")
        c1, c2, c3 = st.columns(3)
        c1.markdown("**👍 What viewers liked**\n\n" + _bullets(d.get("liked")))
        c2.markdown("**👎 Complaints**\n\n" + _bullets(d.get("complaints")))
        c3.markdown("**💡 Requests**\n\n" + _bullets(d.get("requests")))
        if scope == "channel":
            c1, c2, c3 = st.columns(3)
            c1.markdown("**🏆 Best received videos**\n\n" + _bullets(d.get("best_videos")))
            c2.markdown("**⚠️ Weakest videos**\n\n" + _bullets(d.get("worst_videos")))
            c3.markdown("**🎯 Content ideas from the audience**\n\n" + _bullets(d.get("content_ideas")))
        elif d.get("questions"):
            st.markdown("**❓ Viewer questions**\n\n" + _bullets(d.get("questions")))
        topics = d.get("topics") or []
        if topics:
            tdf = pd.DataFrame(topics)
            cols = [c for c in ("name", "share_pct", "sentiment", "example") if c in tdf.columns]
            st.markdown("**🗂️ What people talk about**")
            st.dataframe(tdf[cols], hide_index=True, use_container_width=True, column_config={
                "name": "Topic",
                "share_pct": st.column_config.NumberColumn("Share %", format="%.0f%%"),
                "sentiment": "Sentiment",
                "example": st.column_config.TextColumn("Example", width="large"),
            })
        if d.get("language_notes"):
            st.caption(f"🌐 {d['language_notes']}")


def aspect_chart(df: pd.DataFrame):
    """Diverging bars: criticism to the left, praise to the right, per aspect."""
    if df.empty:
        st.caption("Appears after the AI has read comments.")
        return
    df = df.sort_values("mentions").tail(10)
    fig = go.Figure()
    fig.add_bar(y=df["aspect"], x=-df["negative"], orientation="h", name="Criticised",
                marker_color=SENTIMENT_COLORS["negative"], customdata=df["negative"],
                hovertemplate="%{y}: %{customdata:,} critical comments<extra></extra>")
    fig.add_bar(y=df["aspect"], x=df["positive"], orientation="h", name="Praised",
                marker_color=SENTIMENT_COLORS["positive"],
                hovertemplate="%{y}: %{x:,} positive comments<extra></extra>")
    fig.update_layout(barmode="relative", bargap=0.35, height=80 + 32 * len(df),
                      margin=dict(t=10, b=10), legend=dict(orientation="h", y=1.08, x=0),
                      xaxis=dict(title="← criticised · praised →", zeroline=True, zerolinewidth=1))
    st.plotly_chart(fig, use_container_width=True)


def emotion_chart(df: pd.DataFrame):
    if df.empty:
        st.caption("Appears after the AI has read comments.")
        return
    df = df[df["emotion"] != "neutral"].head(8).iloc[::-1].copy()
    if df.empty:
        st.caption("Mostly neutral comments.")
        return
    df["label"] = df["emotion"].map(lambda e: f"{EMOTION_ICONS.get(e, '')} {e}")
    fig = px.bar(df, x="comments", y="label", orientation="h", labels={"comments": "Comments", "label": ""})
    fig.update_traces(marker_color=CATEGORICAL[6], hovertemplate="%{y}: %{x:,}<extra></extra>")
    fig.update_layout(height=60 + 32 * len(df), margin=dict(t=10, b=10), bargap=0.35)
    st.plotly_chart(fig, use_container_width=True)


def pick_channel(channels: pd.DataFrame, key: str) -> pd.Series | None:
    if channels.empty:
        st.info("No channels yet. Add one under **Manage channels**.")
        return None
    labels = {row.id: f"{row.title} ({row.handle or row.id})" for row in channels.itertuples()}
    cid = st.selectbox("Channel", list(labels), format_func=labels.get, key=key)
    return channels.set_index("id").loc[cid]


# ---------------------------------------------------------------------------- pages
def page_overview():
    st.title("📊 Overview")
    k = load_kpis()
    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric("Channels tracked", fmt(k["channels"]))
    c2.metric("Videos", fmt(k["videos"]))
    c3.metric("Comments stored", fmt(k["comments"]))
    pct = (k["analyzed"] / k["comments"] * 100) if k["comments"] else 0
    ai_pct = (k["ai_read"] / k["comments"] * 100) if k["comments"] else 0
    c4.metric("Analyzed", f"{pct:.0f}%", help=f"AI deep-read: {ai_pct:.0f}% of comments")
    c5.metric("YouTube quota today", f"{k['quota_used_today']:,} / 10,000")
    if k["videos_backfilling"]:
        st.caption(f"⏳ Still downloading past comments for {k['videos_backfilling']:,} videos. "
                   "This continues automatically on every run.")

    channels = load_channels()
    if channels.empty:
        st.info("No channels yet. Go to **Manage channels** to add the creators you want to watch.")
        return

    st.subheader("Channels at a glance")
    view = channels.copy()
    view["analyzed"] = view["positive"] + view["neutral"] + view["negative"]
    view["% positive"] = (view["positive"] / view["analyzed"].where(view["analyzed"] > 0) * 100).round(1)
    view["% negative"] = (view["negative"] / view["analyzed"].where(view["analyzed"] > 0) * 100).round(1)
    view["Sentiment score"] = (view["avg_sentiment"] * 100).round(0)
    st.dataframe(
        view[["thumbnail_url", "title", "subscriber_count", "view_count", "videos_stored",
              "comments", "% positive", "% negative", "Sentiment score"]],
        hide_index=True, use_container_width=True,
        column_config={
            "thumbnail_url": st.column_config.ImageColumn("", width="small"),
            "title": "Channel",
            "subscriber_count": st.column_config.NumberColumn("Subscribers", format="compact"),
            "view_count": st.column_config.NumberColumn("Views", format="compact"),
            "videos_stored": st.column_config.NumberColumn("Videos", format="%d"),
            "comments": st.column_config.NumberColumn("Comments", format="%d"),
            "Sentiment score": st.column_config.NumberColumn(
                help="Average of (positive − negative) across comments, from −100 to +100"),
        },
    )

    since = period_picker("ov_period")
    sentiment_trend_chart(load_daily(since=since), "Comments over time, by sentiment (all channels)")

    # Compare channels: share of each sentiment, one row per channel.
    comp = channels[channels["comments"] > 0][["title", "positive", "neutral", "negative"]]
    if not comp.empty:
        long = comp.melt(id_vars="title", var_name="sentiment", value_name="comments")
        totals = long.groupby("title")["comments"].transform("sum")
        long["share"] = long["comments"] / totals.where(totals > 0) * 100
        fig = px.bar(long, x="share", y="title", color="sentiment", orientation="h",
                     color_discrete_map=SENTIMENT_COLORS,
                     category_orders={"sentiment": SENTIMENT_ORDER[:3]},
                     custom_data=["comments"],
                     labels={"share": "% of analyzed comments", "title": "", "sentiment": ""})
        fig.update_traces(hovertemplate="%{y}: %{x:.1f}% (%{customdata[0]:,} comments)<extra></extra>")
        fig.update_layout(title="Sentiment mix by channel", barmode="stack", bargap=0.35,
                          height=120 + 40 * len(comp), legend=dict(orientation="h", y=1.15, x=0),
                          margin=dict(t=80, b=10), xaxis=dict(range=[0, 100]))
        st.plotly_chart(fig, use_container_width=True)


def page_channel():
    st.title("📺 Channel deep-dive")
    channels = load_channels()
    ch = pick_channel(channels, "ch_pick")
    if ch is None:
        return
    cid = ch.name
    top = st.columns([1, 5])
    if ch["thumbnail_url"]:
        top[0].image(ch["thumbnail_url"], width=96)
    top[1].markdown(f"### {ch['title']}\n[{ch['handle'] or cid}](https://www.youtube.com/channel/{cid})")

    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric("Subscribers", fmt(ch["subscriber_count"]))
    c2.metric("Total views", fmt(ch["view_count"]))
    c3.metric("Videos", f"{fmt(ch['videos_stored'])} / {fmt(ch['video_count'])}")
    c4.metric("Comments stored", fmt(ch["comments"]))
    c5.metric("Sentiment score", sentiment_score_label(ch["avg_sentiment"]),
              help="−100 (all negative) … +100 (all positive)")

    insight_panel("channel", cid)

    since = period_picker("ch_period")
    sentiment_mix_bar(load_sentiment_counts(channel_id=cid, since=since))
    left, right = st.columns([2, 1])
    with left:
        sentiment_trend_chart(load_daily(channel_id=cid, since=since), "Comments over time")
    with right:
        st.markdown("**Comment languages**")
        language_chart(load_languages(channel_id=cid, since=since))

    a1, a2 = st.columns([3, 2])
    with a1:
        st.markdown("**What viewers praise and criticise**")
        aspect_chart(load_aspects(channel_id=cid, since=since))
    with a2:
        st.markdown("**Emotions**")
        emotion_chart(load_emotions(channel_id=cid, since=since))

    snaps = q.channel_snapshots(engine, cid)
    if len(snaps) > 1:
        daily = snaps.set_index("taken_at").resample("D").last().dropna(how="all").reset_index()
        g1, g2 = st.columns(2)
        with g1:
            fig = px.line(daily, x="taken_at", y="subscriber_count", labels={"taken_at": "", "subscriber_count": ""},
                          title="Subscribers")
            fig.update_traces(line=dict(width=2, color=CATEGORICAL[0]))
            st.plotly_chart(fig, use_container_width=True)
        with g2:
            fig = px.line(daily, x="taken_at", y="view_count", labels={"taken_at": "", "view_count": ""},
                          title="Total views")
            fig.update_traces(line=dict(width=2, color=CATEGORICAL[0]))
            st.plotly_chart(fig, use_container_width=True)

    st.subheader("Videos")
    vids = load_videos(cid)
    if vids.empty:
        st.info("Videos appear after the next sync run.")
        return
    vids["analyzed"] = vids["positive"] + vids["neutral"] + vids["negative"]
    vids["% negative"] = (vids["negative"] / vids["analyzed"].where(vids["analyzed"] > 0) * 100).round(1)
    vids["Sentiment score"] = (vids["avg_sentiment"] * 100).round(0)
    vids["link"] = "https://youtu.be/" + vids["id"]
    vids["status"] = vids.apply(
        lambda r: "comments off" if r.comments_disabled else ("complete" if r.comments_backfilled else "downloading"),
        axis=1)
    st.dataframe(
        vids[["published_at", "title", "view_count", "like_count", "comments_on_youtube", "comments_stored",
              "% negative", "Sentiment score", "status", "link"]],
        hide_index=True, use_container_width=True,
        column_config={
            "published_at": st.column_config.DatetimeColumn("Published", format="YYYY-MM-DD"),
            "title": st.column_config.TextColumn("Title", width="large"),
            "view_count": st.column_config.NumberColumn("Views", format="compact"),
            "like_count": st.column_config.NumberColumn("Likes", format="compact"),
            "comments_on_youtube": st.column_config.NumberColumn("Comments (YouTube)", format="%d"),
            "comments_stored": st.column_config.NumberColumn("Comments stored", format="%d"),
            "status": "Comment download",
            "link": st.column_config.LinkColumn("Open", display_text="▶"),
        },
    )


def page_video():
    st.title("🎬 Video deep-dive")
    channels = load_channels()
    ch = pick_channel(channels, "vid_ch_pick")
    if ch is None:
        return
    vids = load_videos(ch.name)
    if vids.empty:
        st.info("No videos stored for this channel yet.")
        return
    labels = {r.id: f"{pd.to_datetime(r.published_at):%Y-%m-%d} · {r.title}" for r in vids.itertuples()}
    vid = st.selectbox("Video", list(labels), format_func=labels.get)
    v = vids.set_index("id").loc[vid]

    left, right = st.columns([1, 2])
    left.video(f"https://www.youtube.com/watch?v={vid}")
    with right:
        st.markdown(f"### {v['title']}")
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Views", fmt(v["view_count"]))
        c2.metric("Likes", fmt(v["like_count"]))
        c3.metric("Comments", f"{fmt(v['comments_stored'])} / {fmt(v['comments_on_youtube'])}")
        c4.metric("Sentiment score", sentiment_score_label(v["avg_sentiment"]))
        sentiment_mix_bar(load_sentiment_counts(video_id=vid))

    insight_panel("video", vid)

    a, b = st.columns([2, 1])
    with a:
        sentiment_trend_chart(load_daily(video_id=vid), "When people commented")
    with b:
        st.markdown("**Comment languages**")
        language_chart(load_languages(video_id=vid))

    a1, a2 = st.columns([3, 2])
    with a1:
        st.markdown("**What viewers praise and criticise**")
        aspect_chart(load_aspects(video_id=vid))
    with a2:
        st.markdown("**Emotions**")
        emotion_chart(load_emotions(video_id=vid))

    snaps = q.video_snapshots(engine, vid)
    if len(snaps) > 1:
        fig = px.line(snaps, x="taken_at", y="view_count", title="Views since tracking started",
                      labels={"taken_at": "", "view_count": ""})
        fig.update_traces(line=dict(width=2, color=CATEGORICAL[0]))
        st.plotly_chart(fig, use_container_width=True)

    t1, t2, t3, t4, t5, t6 = st.tabs(["👍 Most liked", "😊 Most positive", "😠 Most negative",
                                      "❓ Questions", "💡 Requests", "🕒 Newest"])
    with t1:
        comment_table(load_comments(50, "most_liked", video_id=vid, top_level_only=True, hide_spam=True),
                      show_video=False)
    with t2:
        comment_table(load_comments(50, "most_positive", video_id=vid, hide_spam=True), show_video=False)
    with t3:
        comment_table(load_comments(50, "most_negative", video_id=vid, hide_spam=True), show_video=False)
    with t4:
        comment_table(load_comments(100, "most_liked", video_id=vid, flag="question"), show_video=False)
    with t5:
        comment_table(load_comments(100, "most_liked", video_id=vid, flag="suggestion"), show_video=False)
    with t6:
        comment_table(load_comments(100, "newest", video_id=vid), show_video=False)


def page_explorer():
    st.title("🔎 Comment explorer")
    channels = load_channels()
    if channels.empty:
        st.info("No channels yet.")
        return
    f1, f2, f3, f4 = st.columns(4)
    ch_labels = {"": "All channels", **{r.id: r.title for r in channels.itertuples()}}
    cid = f1.selectbox("Channel", list(ch_labels), format_func=ch_labels.get)
    vid = ""
    if cid:
        vids = load_videos(cid)
        v_labels = {"": "All videos", **{r.id: r.title for r in vids.itertuples()}}
        vid = f2.selectbox("Video", list(v_labels), format_func=v_labels.get)
    sentiment = f3.selectbox("Sentiment", ["", "positive", "neutral", "negative"],
                             format_func=lambda s: s.capitalize() or "Any")
    langs = load_languages(channel_id=cid or None, video_id=vid or None)
    lang_opts = {"": "Any language", **dict(zip(langs["language"], langs["language_name"]))}
    language = f4.selectbox("Language", list(lang_opts), format_func=lambda c: lang_opts.get(c, c))

    h1, h2, h3 = st.columns([1, 1, 1])
    emotion = h1.selectbox("Emotion", [""] + list(EMOTION_ICONS),
                           format_func=lambda e: f"{EMOTION_ICONS[e]} {e}" if e else "Any")
    flag = h2.selectbox("Type", ["", "question", "suggestion", "spam", "toxic"],
                        format_func=lambda f: {"": "Any", "question": "❓ Questions",
                                               "suggestion": "💡 Requests / suggestions",
                                               "spam": "🚫 Spam", "toxic": "☠️ Toxic"}[f])
    hide_spam = h3.checkbox("Hide spam", value=True)

    g1, g2, g3 = st.columns([3, 1, 1])
    search = g1.text_input("Search text", placeholder="e.g. audio, thumbnail, part 2")
    order = g2.selectbox("Sort", ["newest", "most_liked", "most_negative", "most_positive", "oldest"],
                         format_func=lambda o: o.replace("_", " ").capitalize())
    limit = g3.selectbox("Show", [100, 500, 2000, 10000], index=1)

    filters = dict(channel_id=cid or None, video_id=vid or None, sentiment=sentiment or None,
                   language=language or None, search=search.strip() or None, emotion=emotion or None,
                   flag=flag or None, hide_spam=hide_spam and flag != "spam")
    df = load_comments(limit, order, **filters)
    st.caption(f"{len(df):,} comments shown")
    comment_table(df)
    if not df.empty:
        st.download_button("⬇️ Download as CSV", df.to_csv(index=False).encode("utf-8"),
                           file_name="comments.csv", mime="text/csv")


def page_manage():
    st.title("⚙️ Manage channels")
    st.markdown(
        "Paste a channel **@handle**, a **channel URL**, or **any video URL** from the channel. "
        "It will be picked up on the next automatic run (every 2 hours), or right away if you "
        "start the workflow manually in GitHub → **Actions** → **Sync & analyze** → **Run workflow**."
    )
    with st.form("add", clear_on_submit=True):
        query = st.text_input("Channel to track", placeholder="@creatorname or https://youtube.com/@creatorname")
        if st.form_submit_button("Add channel") and query.strip():
            with SessionLocal() as s:
                s.add(ChannelRequest(query=query.strip()))
                s.commit()
            st.success(f"Queued **{query.strip()}**. It will appear after the next sync run.")
            st.cache_data.clear()

    reqs = q.channel_requests(engine)
    if not reqs.empty:
        st.subheader("Recent requests")
        st.dataframe(reqs, hide_index=True, use_container_width=True)

    channels = load_channels()
    if not channels.empty:
        st.subheader("Tracked channels")
        st.caption("Pausing a channel stops new downloads; its stored data stays.")
        for row in channels.itertuples():
            c1, c2 = st.columns([5, 1])
            status = "🟢 active" if row.active else "⏸️ paused"
            c1.write(f"**{row.title}** · {row.handle or row.id} · {status}")
            label = "Pause" if row.active else "Resume"
            if c2.button(label, key=f"toggle_{row.id}"):
                with SessionLocal() as s:
                    s.execute(update(Channel).where(Channel.id == row.id).values(active=not row.active))
                    s.commit()
                st.cache_data.clear()
                st.rerun()

    st.subheader("Free-tier usage")
    m1, m2 = st.columns(2)
    used = q.actions_minutes_this_month(engine)
    m1.metric("GitHub Actions minutes this month", f"{used:,} / 2,000",
              help="Private repos get 2,000 free minutes a month. Runs adapt automatically.")
    m2.metric("YouTube quota today", f"{load_kpis()['quota_used_today']:,} / 10,000")
    usage = q.llm_usage_today(engine)
    if usage.empty:
        st.caption("No AI requests today yet.")
    else:
        st.markdown("**Free AI models today** (resets at midnight US Pacific time)")
        st.dataframe(usage, hide_index=True, use_container_width=True, column_config={
            "exhausted": st.column_config.CheckboxColumn("Used up"),
            "last_error": st.column_config.TextColumn("Last problem", width="large"),
        })

    st.subheader("Recent background runs")
    runs = q.recent_runs(engine)
    if runs.empty:
        st.caption("No runs yet.")
    else:
        st.dataframe(runs, hide_index=True, use_container_width=True)


PAGES = {
    "Overview": page_overview,
    "Channel deep-dive": page_channel,
    "Video deep-dive": page_video,
    "Comment explorer": page_explorer,
    "Manage channels": page_manage,
}

with st.sidebar:
    st.markdown("## 📊 Creator Analytics")
    choice = st.radio("Go to", list(PAGES), label_visibility="collapsed")
    if st.button("🔄 Refresh data"):
        st.cache_data.clear()
        st.rerun()
    st.caption("New data arrives automatically every 2 hours.")

PAGES[choice]()
