"""E7: copy-paste spam and bot detection (no model needed).

The same text (ignoring case, spaces, punctuation and emoji) posted by SPAM_MIN_AUTHORS (default 3) or more
different accounts on one channel within SPAM_WINDOW_DAYS is a bot or a paste campaign: all copies are marked
spam, so they drop out of moods, topics, superfans and Ask AI. Short generic comments ("super", "nice video",
"first") are never flagged: they're repeated by real people all the time. Runs in every sync job (cheap).
"""
from __future__ import annotations

import logging
import os
import re
from collections import defaultdict
from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .db import Comment, utcnow

log = logging.getLogger(__name__)
_NON_LETTERS = re.compile(r"[\W\d_]+", re.UNICODE)
_LINK = re.compile(r"https?://|www\.|t\.me/|wa\.me/|bit\.ly", re.I)


def fingerprint(text: str | None) -> str:
    return _NON_LETTERS.sub("", (text or "").lower())


def find_copy_paste(rows, min_authors: int, min_letters: int) -> set[str]:
    """rows: (id, channel_id, author_channel_id, author_name, text). Returns ids of copies to mark as spam."""
    groups: dict[tuple[str, str], list[tuple[str, str]]] = defaultdict(list)
    for cid, channel, author_id, author_name, text in rows:
        fp = fingerprint(text)
        # Links make even short copies suspicious; plain text must be long enough not to be a common phrase.
        if len(fp) < min_letters and not (_LINK.search(text or "") and len(fp) >= 6):
            continue
        groups[(channel, fp)].append((cid, author_id or author_name or cid))
    spam: set[str] = set()
    for members in groups.values():
        if len({a for _, a in members}) >= min_authors:
            spam.update(cid for cid, _ in members)
    return spam


def sweep_copy_paste(session: Session, now=None) -> int:
    now = now or utcnow()
    days = int(os.environ.get("SPAM_WINDOW_DAYS", "14"))
    rows = session.execute(
        select(Comment.id, Comment.channel_id, Comment.author_channel_id, Comment.author_name, Comment.text)
        .where(Comment.published_at >= now - timedelta(days=days), Comment.is_spam.isnot(True))
    ).all()
    spam = find_copy_paste(rows, int(os.environ.get("SPAM_MIN_AUTHORS", "3")), int(os.environ.get("SPAM_MIN_LETTERS", "25")))
    ids = list(spam)
    for i in range(0, len(ids), 500):
        session.execute(update(Comment).where(Comment.id.in_(ids[i:i + 500])).values(is_spam=True))
    session.commit()
    if ids:
        log.info("Copy-paste spam: marked %d comments", len(ids))
    return len(ids)
