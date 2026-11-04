"""The AI layer: deep per-comment labels and written insights per video / channel.

1. enrich_comments  - batches of ~40 comments -> sentiment (understands Tanglish, Hinglish,
                      sarcasm, emoji), emotion, question / suggestion / spam / toxic flags,
                      what the comment is about (aspects) and an English translation.
                      Comments the local model was unsure about, and romanized ones, go first.
2. write_insights   - for videos with enough new comments, and for each channel once a day:
                      a summary, what viewers liked, complaints, requests, questions, topics,
                      and (channel) content ideas.
"""
from __future__ import annotations

import json
import logging
import time
from collections import Counter
from datetime import timedelta

from sqlalchemy import case, func, literal_column, or_, select, update
from sqlalchemy.orm import Session

from .db import Channel, Comment, Insight, RunLog, Video, utcnow
from .llm import LLMRouter, NoModelAvailable

log = logging.getLogger(__name__)

EMOTIONS = ["joy", "love", "gratitude", "admiration", "excitement", "humor", "surprise", "curiosity",
            "neutral", "confusion", "disappointment", "sadness", "anger", "disgust", "fear", "sarcasm"]
ASPECTS = ["content", "host", "editing", "audio", "video_quality", "thumbnail_title", "length_pacing",
           "music", "ads_sponsor", "information", "humor", "guest", "other"]

COMMENT_SYSTEM = f"""You analyze YouTube comments for a creator-analytics dashboard.
Comments can be in any language, in native script or romanized, and often code-mixed
(e.g. Tanglish = Tamil in English letters: "semma", "vera level", "mokka" = boring;
Hinglish = Hindi in English letters). Read slang, emoji and sarcasm the way a native speaker would.

For EVERY comment return one object:
- "i": the comment number given
- "sentiment": "positive" | "neutral" | "negative" (toward the video/creator/topic; sarcasm counts as what is really meant)
- "score": number from -1 (very negative) to 1 (very positive)
- "emotion": one of {", ".join(EMOTIONS)}
- "question": true if the comment asks something
- "suggestion": true if it requests or suggests content/changes ("make part 2", "please review X")
- "spam": true for spam, scams, self-promotion, bots
- "toxic": true for insults, hate or harassment
- "aspects": list of {{"a": aspect, "s": "pos"|"neg"|"neu"}} for what the comment talks about;
  aspect is one of {", ".join(ASPECTS)}; empty list if none
- "lang": language code (en, ta, hi, te, ml, kn, ...; add "-Latn" for romanized, e.g. "ta-Latn"; "und" if unclear)
- "en": short English translation if the comment is not English, else ""

Reply with JSON only: {{"results": [ ... ]}}"""

VIDEO_SYSTEM = """You are an audience-research analyst. You get statistics and a sample of viewer
comments (any language) for one YouTube video. Write findings in clear, simple English,
grounded only in the comments - quote or paraphrase real comments, never invent.

Reply with JSON only:
{
 "summary": "3-4 sentences: how the audience reacted overall and why",
 "mood": "one short phrase",
 "liked": ["what viewers praised", ...],
 "complaints": ["what viewers criticised", ...],
 "requests": ["content or changes viewers asked for", ...],
 "questions": ["important unanswered viewer questions", ...],
 "topics": [{"name": "short topic", "share_pct": number, "sentiment": "positive|neutral|negative|mixed",
             "example": "a representative comment (original language) + English meaning if needed"}],
 "language_notes": "which languages viewers used and any difference in their reactions"
}
Use at most 6 items per list, most important first. Use [] when there is nothing."""

CHANNEL_SYSTEM = """You are an audience-research analyst. You get per-video statistics and a sample
of recent viewer comments (any language) for one YouTube channel. Write findings in clear,
simple English, grounded only in the data - never invent.

Reply with JSON only:
{
 "summary": "4-5 sentences: the state of this audience recently",
 "trend": "is sentiment improving, stable or declining, and why",
 "audience_profile": "who seems to be watching (languages, regions, interests) based on comments",
 "liked": ["recurring praise", ...],
 "complaints": ["recurring criticism", ...],
 "requests": ["recurring content requests", ...],
 "best_videos": ["video title - why it resonated", ...],
 "worst_videos": ["video title - what went wrong", ...],
 "content_ideas": ["concrete video ideas this audience is asking for", ...],
 "topics": [{"name": "short topic", "share_pct": number, "sentiment": "positive|neutral|negative|mixed"}]
}
Use at most 6 items per list, most important first. Use [] when there is nothing."""


class AIRunner:
    def __init__(self, session: Session, router: LLMRouter, *, batch_size: int = 40,
                 deadline: float | None = None, insight_min_comments: int = 20,
                 insights_per_run: int = 5, channel_insight_hours: int = 24):
        self.s = session
        self.router = router
        self.batch_size = batch_size
        self.deadline = deadline
        self.insight_min_comments = insight_min_comments
        self.insights_per_run = insights_per_run
        self.channel_insight_hours = channel_insight_hours
        self.stats = Counter()

    def _time_left(self) -> bool:
        return self.deadline is None or time.monotonic() < self.deadline

    # -- 1. per-comment enrichment -------------------------------------------------
    def enrich_comments(self, max_batches: int | None = None) -> int:
        done = 0
        batches = 0
        priority = case(
            (or_(Comment.language.like("%-Latn"), Comment.language == "und",
                 Comment.sentiment_score.is_(None), Comment.sentiment_score < 0.6), 0),
            else_=1,
        )
        while self._time_left() and (max_batches is None or batches < max_batches):
            rows = self.s.execute(
                select(Comment.id, Comment.text, Comment.video_id)
                .where(Comment.ai_at.is_(None))
                .order_by(priority, Comment.published_at.desc())
                .limit(self.batch_size)
            ).all()
            if not rows:
                break
            titles = dict(self.s.execute(
                select(Video.id, Video.title).where(Video.id.in_({r.video_id for r in rows}))
            ).all())
            video_nums = {vid: n for n, vid in enumerate(titles, start=1)}
            lines = ["Videos:"] + [f"V{n}: {titles[vid]}" for vid, n in video_nums.items()]
            lines.append("\nComments:")
            for i, r in enumerate(rows, start=1):
                text = " ".join((r.text or "").split())[:500]
                lines.append(f"{i}. [V{video_nums.get(r.video_id, 0)}] {text}")
            try:
                data, model = self.router.chat_json(COMMENT_SYSTEM, "\n".join(lines),
                                                    max_tokens=6000, deadline=self.deadline)
            except NoModelAvailable as e:
                self.stats["stopped"] = 1
                log.info("AI enrichment paused: %s", e)
                break
            results = {}
            for item in data.get("results") or []:
                try:
                    results[int(item.get("i"))] = item
                except (TypeError, ValueError):
                    continue
            if not results:
                self.stats["empty_batches"] += 1
                if self.stats["empty_batches"] >= 3:
                    break
                continue
            now = utcnow()
            updates = []
            for i, r in enumerate(rows, start=1):
                item = results.get(i)
                if item is None:
                    # The model skipped it; mark so we don't loop forever, keep model sentiment.
                    updates.append({"id": r.id, "ai_at": now, "ai_model": "skipped"})
                    continue
                updates.append(_comment_update(r.id, item, now, model))
            self.s.execute(update(Comment), updates)
            self.s.commit()
            done += len(results)
            batches += 1
            log.info("AI labelled %d comments (%s)", done, model)
        self.stats["comments"] += done
        return done

    # -- 2. insights ---------------------------------------------------------------
    def write_insights(self) -> int:
        written = 0
        for video in self._videos_needing_insight():
            if not self._time_left() or written >= self.insights_per_run:
                break
            try:
                self._video_insight(video)
            except NoModelAvailable:
                return written
            written += 1
        for channel in self.s.scalars(select(Channel).where(Channel.active.is_(True))).all():
            if not self._time_left():
                break
            last = self._last_insight("channel", channel.id)
            if last and utcnow() - last.created_at < timedelta(hours=self.channel_insight_hours):
                continue
            total = self.s.scalar(select(func.count()).select_from(Comment)
                                  .where(Comment.channel_id == channel.id)) or 0
            if total < self.insight_min_comments or (last and total == last.comment_count):
                continue
            try:
                self._channel_insight(channel, total)
            except NoModelAvailable:
                return written
            written += 1
        self.stats["insights"] += written
        return written

    def _last_insight(self, scope: str, target_id: str) -> Insight | None:
        return self.s.scalars(
            select(Insight).where(Insight.scope == scope, Insight.target_id == target_id)
            .order_by(Insight.created_at.desc()).limit(1)
        ).first()

    def _videos_needing_insight(self) -> list[Video]:
        counts = dict(self.s.execute(
            select(Comment.video_id, func.count()).group_by(Comment.video_id)
            .having(func.count() >= self.insight_min_comments)
        ).all())
        if not counts:
            return []
        latest = {}
        for ins in self.s.scalars(select(Insight).where(Insight.scope == "video")).all():
            if ins.target_id not in latest or ins.created_at > latest[ins.target_id].created_at:
                latest[ins.target_id] = ins
        due = []
        for vid, n in counts.items():
            last = latest.get(vid)
            # New video insight when there is none yet, or comments grew by 25% (and 20+).
            if last is None or (n >= last.comment_count * 1.25 and n - last.comment_count >= 20):
                due.append(vid)
        if not due:
            return []
        videos = self.s.scalars(
            select(Video).join(Channel, Channel.id == Video.channel_id)
            .where(Video.id.in_(due), Channel.active.is_(True))
            .order_by(Video.published_at.desc())
        ).all()
        return list(videos)

    def _sample(self, *where, per_bucket: int = 60, cap: int = 220) -> list[Comment]:
        def q(order, extra=()):
            return self.s.scalars(select(Comment).where(*where, *extra).order_by(order).limit(per_bucket)).all()

        picked: dict[str, Comment] = {}
        for bucket in (
            q(Comment.like_count.desc()),
            q(Comment.published_at.desc()),
            q(Comment.sentiment_value.asc(), (Comment.sentiment_value.is_not(None),)),
            q(Comment.like_count.desc(), (or_(Comment.is_question.is_(True), Comment.is_suggestion.is_(True)),)),
        ):
            for c in bucket:
                if len(picked) >= cap:
                    break
                if not c.is_spam:
                    picked.setdefault(c.id, c)
        return list(picked.values())

    def _stats_block(self, *where) -> str:
        label = func.coalesce(Comment.sentiment, literal_column("'pending'"))
        sentiments = dict(self.s.execute(
            select(label, func.count()).where(*where).group_by(label)
        ).all())
        languages = self.s.execute(
            select(Comment.language, func.count()).where(*where).group_by(Comment.language)
            .order_by(func.count().desc()).limit(8)
        ).all()
        emotions = self.s.execute(
            select(Comment.emotion, func.count()).where(*where, Comment.emotion.is_not(None))
            .group_by(Comment.emotion).order_by(func.count().desc()).limit(6)
        ).all()
        aspect_counts: Counter = Counter()
        for (aspects,) in self.s.execute(select(Comment.aspects).where(*where, Comment.aspects.is_not(None))):
            for part in (aspects or "").split(","):
                if ":" in part:
                    aspect_counts[part] += 1
        lang_text = ", ".join(f"{lang or '?'}={n}" for lang, n in languages)
        emo_text = ", ".join(f"{e}={n}" for e, n in emotions) or "n/a"
        aspect_text = ", ".join(f"{k}={v}" for k, v in aspect_counts.most_common(12)) or "n/a"
        return "\n".join([
            f"Sentiment counts: {json.dumps(sentiments)}",
            f"Languages: {lang_text}",
            f"Emotions: {emo_text}",
            f"Aspects (aspect:polarity=count): {aspect_text}",
        ])

    @staticmethod
    def _format_comments(comments: list[Comment]) -> str:
        lines = []
        for c in comments:
            text = " ".join((c.text or "").split())[:300]
            tag = f"{c.sentiment or '?'}, {c.like_count} likes"
            if c.translation:
                text += f"  [EN: {c.translation[:200]}]"
            lines.append(f"- ({tag}) {text}")
        return "\n".join(lines)

    def _video_insight(self, video: Video) -> None:
        where = (Comment.video_id == video.id,)
        total = self.s.scalar(select(func.count()).select_from(Comment).where(*where)) or 0
        sample = self._sample(*where)
        prompt = "\n".join([
            f"Video: {video.title}",
            f"Published: {video.published_at:%Y-%m-%d}" if video.published_at else "",
            f"Views: {video.view_count}, likes: {video.like_count}, comments stored: {total}",
            self._stats_block(*where),
            f"\nSample of {len(sample)} comments (most liked, newest, most negative, questions):",
            self._format_comments(sample),
        ])
        data, model = self.router.chat_json(VIDEO_SYSTEM, prompt, max_tokens=4000, deadline=self.deadline)
        self.s.add(Insight(scope="video", target_id=video.id, comment_count=total, model=model,
                           data=json.dumps(data, ensure_ascii=False)))
        self.s.commit()
        log.info("Wrote insight for video %s (%s)", video.id, model)

    def _channel_insight(self, channel: Channel, total: int) -> None:
        since = utcnow() - timedelta(days=30)
        recent = (Comment.channel_id == channel.id, Comment.published_at >= since)
        n_recent = self.s.scalar(select(func.count()).select_from(Comment).where(*recent)) or 0
        where = recent if n_recent >= self.insight_min_comments else (Comment.channel_id == channel.id,)
        per_video = self.s.execute(
            select(Video.title, Video.published_at, Video.view_count, func.count(Comment.id),
                   func.avg(Comment.sentiment_value))
            .join(Comment, Comment.video_id == Video.id)
            .where(Video.channel_id == channel.id)
            .group_by(Video.id, Video.title, Video.published_at, Video.view_count)
            .order_by(Video.published_at.desc()).limit(25)
        ).all()
        video_lines = [
            f"- {p:%Y-%m-%d} | {t} | views {v} | comments {n} | sentiment {round((s or 0) * 100):+d}"
            for t, p, v, n, s in per_video if p is not None
        ]
        sample = self._sample(*where, per_bucket=70, cap=260)
        prompt = "\n".join([
            f"Channel: {channel.title} ({channel.handle or channel.id}), subscribers: {channel.subscriber_count}",
            f"Comments stored in total: {total}; analysed window: "
            f"{'last 30 days' if where is recent else 'all time'}",
            self._stats_block(*where),
            "\nRecent videos (date | title | views | comments | sentiment -100..+100):",
            *video_lines,
            f"\nSample of {len(sample)} comments:",
            self._format_comments(sample),
        ])
        data, model = self.router.chat_json(CHANNEL_SYSTEM, prompt, max_tokens=4000, deadline=self.deadline)
        self.s.add(Insight(scope="channel", target_id=channel.id, comment_count=total, model=model,
                           data=json.dumps(data, ensure_ascii=False)))
        self.s.commit()
        log.info("Wrote insight for channel %s (%s)", channel.id, model)


def _comment_update(cid: str, item: dict, now, model: str) -> dict:
    sentiment = str(item.get("sentiment", "")).lower().strip()
    if sentiment not in ("positive", "neutral", "negative"):
        sentiment = None
    try:
        score = max(-1.0, min(1.0, float(item.get("score"))))
    except (TypeError, ValueError):
        score = {"positive": 0.7, "neutral": 0.0, "negative": -0.7}.get(sentiment or "", None)
    emotion = str(item.get("emotion", "")).lower().strip()
    aspects = []
    for a in item.get("aspects") or []:
        if isinstance(a, dict):
            name = str(a.get("a", "")).lower().strip().replace(" ", "_")
            pol = str(a.get("s", "neu")).lower()[:3]
            if name in ASPECTS and pol in ("pos", "neg", "neu"):
                aspects.append(f"{name}:{pol}")
    lang = str(item.get("lang", "")).strip()
    translation = str(item.get("en") or "").strip()
    row = {
        "id": cid,
        "emotion": emotion if emotion in EMOTIONS else None,
        "is_question": bool(item.get("question")),
        "is_suggestion": bool(item.get("suggestion")),
        "is_spam": bool(item.get("spam")),
        "is_toxic": bool(item.get("toxic")),
        "aspects": ",".join(dict.fromkeys(aspects))[:300] or None,
        "translation": translation[:2000] or None,
        "ai_at": now,
        "ai_model": model[:100],
    }
    if sentiment is not None and score is not None:
        row.update(sentiment=sentiment, sentiment_value=round(score, 4),
                   sentiment_score=round(abs(score) if sentiment != "neutral" else 1 - abs(score), 4),
                   sentiment_source="ai", analyzed_at=now, analyzer=model[:200])
    if 2 <= len(lang) <= 10 and lang.replace("-", "").isalpha():
        row["language"] = lang
    return row


def run_ai(session: Session, router: LLMRouter, max_minutes: float, **kwargs) -> dict:
    deadline = time.monotonic() + max_minutes * 60
    runner = AIRunner(session, router, deadline=deadline, **kwargs)
    run = RunLog(kind="ai")
    session.add(run)
    session.commit()
    try:
        # Spend ~70% of the time on comments, then write insights with what is left.
        runner.deadline = time.monotonic() + max_minutes * 60 * 0.7
        runner.enrich_comments()
        runner.deadline = deadline
        runner.write_insights()
        run.status = "ok"
    except Exception as e:
        session.rollback()
        run.status = "error"
        run.summary = json.dumps({**runner.stats, "error": repr(e)[:500]})
        run.finished_at = utcnow()
        session.commit()
        raise
    run.summary = json.dumps(dict(runner.stats))
    run.finished_at = utcnow()
    session.commit()
    return dict(runner.stats)


def latest_insight(session: Session, scope: str, target_id: str) -> tuple[dict, Insight] | None:
    ins = session.scalars(
        select(Insight).where(Insight.scope == scope, Insight.target_id == target_id)
        .order_by(Insight.created_at.desc()).limit(1)
    ).first()
    if ins is None:
        return None
    try:
        return json.loads(ins.data), ins
    except ValueError:
        return None
