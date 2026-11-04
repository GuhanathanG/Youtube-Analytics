"""Command line entry point.

    python -m ytanalytics init-db
    python -m ytanalytics add-channel "@SomeCreator"
    python -m ytanalytics sync
    python -m ytanalytics analyze
    python -m ytanalytics pending      # prints how many comments still need analysis
    python -m ytanalytics status
"""
from __future__ import annotations

import argparse
import json
import logging
import sys

from sqlalchemy import func, select

from .config import Settings
from .db import Channel, Comment, Video, init_db, make_engine, make_session_factory


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ytanalytics")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init-db", help="create tables")
    add = sub.add_parser("add-channel", help="track a channel (@handle, URL or ID)")
    add.add_argument("query")
    sub.add_parser("sync", help="fetch new data from YouTube")
    an = sub.add_parser("analyze", help="run sentiment on new comments")
    an.add_argument("--limit", type=int, default=None)
    sub.add_parser("pending", help="number of comments waiting for analysis")
    sub.add_parser("status", help="summary of what is stored")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    settings = Settings.from_env()
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

            stats = run_sync(session, settings)
            print(json.dumps(stats.__dict__, indent=2))
        elif args.cmd == "analyze":
            from .sentiment import analyze_pending

            n = analyze_pending(session, settings, limit=args.limit)
            print(f"Analyzed {n} comments.")
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
