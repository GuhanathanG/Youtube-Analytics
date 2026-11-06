"""Command line entry point.

    python -m ytanalytics init-db
    python -m ytanalytics add-channel "@SomeCreator"
    python -m ytanalytics sync
    python -m ytanalytics analyze
    python -m ytanalytics pending      # prints how many comments still need analysis
    python -m ytanalytics status
    python -m ytanalytics ai             # AI labels + insights (needs GEMINI_API_KEY / GROQ_API_KEY)
    python -m ytanalytics ai-check       # test which free AI models your keys can use
    python -m ytanalytics plan           # minutes this run may use (GitHub free-minutes budget)
    python -m ytanalytics record-job --started <unix time>
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time

from sqlalchemy import func, select

from .config import Settings
from .db import Channel, Comment, Video, init_db, make_engine, make_session_factory


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ytanalytics")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init-db", help="create tables")
    add = sub.add_parser("add-channel", help="track a channel (@handle, URL or ID)")
    add.add_argument("query")
    sy = sub.add_parser("sync", help="fetch new data from YouTube")
    sy.add_argument("--minutes", type=float, default=None)
    sy.add_argument("--until", type=float, default=None, help="stop by this unix time")
    an = sub.add_parser("analyze", help="run sentiment on new comments")
    an.add_argument("--limit", type=int, default=None)
    an.add_argument("--minutes", type=float, default=None)
    an.add_argument("--until", type=float, default=None, help="stop by this unix time")
    ai = sub.add_parser("ai", help="AI labels for comments + written insights")
    ai.add_argument("--minutes", type=float, default=None)
    ai.add_argument("--until", type=float, default=None, help="stop by this unix time")
    sub.add_parser("ai-check", help="test the configured free AI models")
    la = sub.add_parser("local-ai", help="free on-machine AI: emotions, questions/requests, topic groups")
    la.add_argument("--until", type=float, default=None, help="stop by this unix time")
    sub.add_parser("topics-due", help="print 1 if any channel's topic groups need rebuilding, else 0")
    ar = sub.add_parser("archive", help="move old analysed comments to the archive database (ARCHIVE_DATABASE_URL)")
    ar.add_argument("--until", type=float, default=None, help="stop by this unix time")
    sub.add_parser("pending", help="number of comments waiting for analysis")
    sub.add_parser("status", help="summary of what is stored")
    sub.add_parser("plan", help="print minutes for this run (GitHub Actions budget)")
    rj = sub.add_parser("record-job", help="record a finished GitHub Actions job")
    rj.add_argument("--started", type=float, required=True)
    rj.add_argument("--status", default="ok")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    settings = Settings.from_env()
    if getattr(args, "minutes", None):
        settings.max_run_minutes = args.minutes
    if getattr(args, "until", None):

        # At least ~20 seconds, so new comments are always picked up.
        settings.max_run_minutes = max(0.35, (args.until - time.time()) / 60)
    engine = make_engine(settings.database_url)
    init_db(engine)
    Session = make_session_factory(engine)

    with Session() as session:
        if args.cmd == "init-db":
            print("Tables ready.")
        elif args.cmd == "add-channel":
            from .sync import Syncer
            from .youtube import QuotaTracker, YouTubeClient

            yt = YouTubeClient(settings.youtube_api_key, QuotaTracker(session, settings.daily_quota))
            channel = Syncer(session, yt, settings).add_channel(args.query)
            if channel is None:
                print(f"Could not find a channel for {args.query!r}", file=sys.stderr)
                return 1
            print(f"Tracking {channel.title} ({channel.id})")
        elif args.cmd == "sync":
            from .sync import run_sync

            if not settings.youtube_api_key:
                print("YOUTUBE_API_KEY is not set. Add it under GitHub → Settings → Secrets and variables "
                      "→ Actions (see README step 4).", file=sys.stderr)
                return 1

            stats = run_sync(session, settings)
            print(json.dumps(stats.__dict__, indent=2))
        elif args.cmd == "analyze":
            from .sentiment import analyze_pending

            n = analyze_pending(session, settings, limit=args.limit)
            print(f"Analyzed {n} comments.")
        elif args.cmd == "ai":
            from .ai import run_ai
            from .llm import LLMRouter, slots_from_env

            slots = slots_from_env(discover=True)
            if not slots:
                print("No AI key set (GEMINI_API_KEY / GROQ_API_KEY); skipping AI step.")
                return 0
            router = LLMRouter(session, slots)
            stats = run_ai(
                session, router, settings.max_run_minutes,
                batch_size=int(os.environ.get("AI_BATCH_SIZE", "100")),
                insights_per_run=int(os.environ.get("AI_INSIGHTS_PER_RUN", "5")),
                channel_insight_hours=int(os.environ.get("AI_CHANNEL_INSIGHT_HOURS", "24")),
            )
            print(json.dumps(stats, indent=2))
            print("\nFree AI models today:")
            for slot in slots:
                usage = router._usage(slot)
                problem = router.errors.get(slot.key) or (usage.last_error if usage.exhausted else None)
                state = f"NOT AVAILABLE - {problem}" if problem else "OK"
                print(f"  {slot.key:45s} {usage.requests:4d} requests today  {state}")
            session.commit()
        elif args.cmd == "local-ai":
            from .llm import LLMRouter, slots_from_env
            from .local_ai import build_topics, local_emotions

            deadline = time.monotonic() + settings.max_run_minutes * 60
            n = local_emotions(session, deadline=deadline - 60)
            slots = slots_from_env(discover=True)
            router = LLMRouter(session, slots) if slots else None
            t = build_topics(session, router=router, deadline=deadline)
            print(json.dumps({"emotions": n, "topic_channels": t}))
        elif args.cmd == "archive":
            from .archive import archive_old_comments, should_archive

            go, why = should_archive(session)
            print(f"Archive: {why}")
            if go:
                n = archive_old_comments(session, os.environ["ARCHIVE_DATABASE_URL"],
                                         deadline=time.monotonic() + settings.max_run_minutes * 60)
                print(json.dumps({"archived": n}))
        elif args.cmd == "topics-due":
            from .local_ai import topics_due

            print(1 if topics_due(session) else 0)
        elif args.cmd == "ai-check":
            from .llm import check_models, slots_from_env

            slots = slots_from_env(discover=True)
            if not slots:
                print("No AI key set. Add GEMINI_API_KEY and/or GROQ_API_KEY.")
                return 1
            for model, status in check_models(session, slots):
                print(f"{model:45s} {status}")
        elif args.cmd == "plan":
            from .budget import plan_minutes

            print(plan_minutes(session).as_outputs())
        elif args.cmd == "record-job":
            from .budget import record_job

            record_job(session, args.started, args.status)
        elif args.cmd == "pending":
            from .sentiment import count_pending

            print(count_pending(session))
        elif args.cmd == "status":
            print(json.dumps({
                "channels": session.scalar(select(func.count()).select_from(Channel)),
                "videos": session.scalar(select(func.count()).select_from(Video)),
                "comments": session.scalar(select(func.count()).select_from(Comment)),
                "analyzed": session.scalar(select(func.count()).select_from(Comment)
                                           .where(Comment.analyzed_at.is_not(None))),
            }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
