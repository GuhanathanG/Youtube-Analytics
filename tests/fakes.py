"""An in-memory stand-in for the YouTube API, shaped like the real responses."""
from __future__ import annotations

from datetime import datetime, timedelta

from ytanalytics.youtube import QuotaTracker, YouTubeError, parse_channel_query

BASE = datetime(2026, 1, 1)


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


class FakeYouTube:
    def __init__(self, quota: QuotaTracker):
        self.quota = quota
        self.channels: dict[str, dict] = {}
        self.handles: dict[str, str] = {}
        self.uploads: dict[str, list[str]] = {}  # playlist -> video ids, newest first
        self.videos: dict[str, dict] = {}
        self.threads: dict[str, list[dict]] = {}  # video -> threads, newest first
        self.replies: dict[str, list[dict]] = {}  # parent -> replies
        self.disabled: set[str] = set()
        self.calls: list[str] = []

    # ---- building fake data -------------------------------------------------------
    def add_channel(self, cid: str, handle: str, n_videos: int, comments_per_video: int = 0,
                    replies_per_thread: int = 0) -> None:
        playlist = "UU" + cid[2:]
        self.channels[cid] = {
            "id": cid,
            "snippet": {"title": f"Channel {handle}", "customUrl": handle, "thumbnails": {}},
            "statistics": {"subscriberCount": "1000", "viewCount": "50000", "videoCount": str(n_videos)},
            "contentDetails": {"relatedPlaylists": {"uploads": playlist}},
        }
        self.handles[handle.lower()] = cid
        self.uploads[playlist] = []
        for i in range(n_videos):
            vid = f"{cid[-4:]}v{i:06d}"[:11].ljust(11, "x")
            published = BASE + timedelta(days=n_videos - i)  # index 0 is newest
            self.uploads[playlist].append(vid)
            self.videos[vid] = {
                "id": vid,
                "snippet": {"title": f"Video {i}", "publishedAt": iso(published), "channelId": cid,
                            "thumbnails": {}},
                "statistics": {"viewCount": "100", "likeCount": "10", "commentCount": "0"},
                "contentDetails": {"duration": "PT5M"},
            }
            self.threads[vid] = []
            for j in range(comments_per_video):
                self.post_comment(vid, published + timedelta(hours=comments_per_video - j),
                                  text=f"comment {j} on {vid}", replies=replies_per_thread, append=True)

    def post_comment(self, vid: str, when: datetime, text: str = "new!", replies: int = 0,
                     append: bool = False) -> str:
        tid = f"{vid}-t{len(self.threads[vid])}"
        thread_replies = []
        for k in range(replies):
            thread_replies.append({
                "id": f"{tid}.r{k}",
                "snippet": {"textOriginal": f"reply {k}", "authorDisplayName": "R", "parentId": tid,
                            "likeCount": 0, "publishedAt": iso(when + timedelta(minutes=k + 1)),
                            "updatedAt": iso(when + timedelta(minutes=k + 1))},
            })
        self.replies[tid] = thread_replies
        thread = {
            "id": tid,
            "snippet": {
                "totalReplyCount": replies,
                "topLevelComment": {"id": tid, "snippet": {
                    "textOriginal": text, "authorDisplayName": "A", "likeCount": 1,
                    "authorChannelId": {"value": "UCauthor"},
                    "publishedAt": iso(when), "updatedAt": iso(when)}},
            },
            "replies": {"comments": thread_replies[:5]} if replies else {},
        }
        if append:
            self.threads[vid].append(thread)
        else:
            self.threads[vid].insert(0, thread)
        self._recount(vid)
        return tid

    def _recount(self, vid: str) -> None:
        total = sum(1 + t["snippet"]["totalReplyCount"] for t in self.threads[vid])
        self.videos[vid]["statistics"]["commentCount"] = str(total)

    # ---- API surface used by the syncer -------------------------------------------
    def _spend(self, name: str) -> None:
        self.quota.spend(1)
        self.calls.append(name)

    @staticmethod
    def _page(items: list, token: str | None, size: int) -> tuple[list, str | None]:
        start = int(token) if token else 0
        end = start + size
        return items[start:end], (str(end) if end < len(items) else None)

    def get_channels(self, *, ids=None, handle=None, username=None) -> list[dict]:
        self._spend("channels")
        if ids:
            return [self.channels[i] for i in ids if i in self.channels]
        key = (handle or username or "").lower()
        if not key.startswith("@"):
            key = "@" + key
        cid = self.handles.get(key)
        return [self.channels[cid]] if cid else []

    def resolve_channel(self, query: str):
        kind, value = parse_channel_query(query)
        if kind == "id":
            items = self.get_channels(ids=[value])
        elif kind in ("handle", "username"):
            items = self.get_channels(handle=value)
        else:
            return None
        return items[0] if items else None

    def list_uploads(self, playlist_id: str, page_token=None) -> dict:
        self._spend("playlistItems")
        if playlist_id not in self.uploads:
            raise YouTubeError(404, "playlistNotFound", "nope")
        page, nxt = self._page(self.uploads[playlist_id], page_token, 50)
        return {"items": [{"contentDetails": {"videoId": v}} for v in page], "nextPageToken": nxt}

    def get_videos(self, ids: list[str]) -> list[dict]:
        out = []
        for i in range(0, len(ids), 50):
            self._spend("videos")
            out.extend(self.videos[v] for v in ids[i:i + 50] if v in self.videos)
        return out

    def list_comment_threads(self, video_id: str, page_token=None) -> dict:
        self._spend("commentThreads")
        if video_id in self.disabled:
            raise YouTubeError(403, "commentsDisabled", "disabled")
        page, nxt = self._page(self.threads[video_id], page_token, 100)
        return {"items": page, "nextPageToken": nxt}

    def list_replies(self, parent_id: str, page_token=None) -> dict:
        self._spend("comments")
        page, nxt = self._page(self.replies.get(parent_id, []), page_token, 100)
        return {"items": page, "nextPageToken": nxt}
