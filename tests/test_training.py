"""Training database: matching researched channel names to real YouTube channels."""
from ytanalytics.training import name_matches, resolve


def test_name_matches_title_or_handle():
    assert name_matches("Village Cooking Channel", "Village Cooking Channel", "@villagecookingchannel")
    assert name_matches("Mic Set", "Micset", "@micsetofficial")
    assert name_matches("Madan Gowri", "Madan Gowri", None)
    assert not name_matches("Madras Samayal", "Madras Central", "@madrascentral")
    assert not name_matches("Trading Tamil", "Tamil Songs HD", None)
    assert not name_matches("Tamil Today Tech", "Tamil Tech - MrTT", "@tamiltechofficial")  # 'today' missing


class FakeYT:
    def __init__(self):
        self.searches = 0

    def resolve_channel(self, q):
        known = {"@parithabangal": {"id": "UCp", "snippet": {"title": "Parithabangal", "customUrl": "@parithabangal"}, "statistics": {"subscriberCount": "9000000"}},
                 "UCWKAAgM5L7bExQJkPZIbiaw": {"id": "UCWKAAgM5L7bExQJkPZIbiaw", "snippet": {"title": "Tamil Trekker"}, "statistics": {}}}
        return known.get(q if q.startswith("UC") else q.lower())

    def search_channel(self, name):
        self.searches += 1
        return [{"id": "UCwrong", "snippet": {"title": "Something Else"}, "statistics": {"subscriberCount": "5"}},
                {"id": "UCmic", "snippet": {"title": "Mic Set", "customUrl": "@micset"}, "statistics": {"subscriberCount": "8240000"}}]


def test_resolve_prefers_cheap_exact_lookups():
    yt = FakeYT()
    item, how = resolve(yt, "UCWKAAgM5L7bExQJkPZIbiaw")
    assert item["id"] == "UCWKAAgM5L7bExQJkPZIbiaw" and how == "exact"
    item, how = resolve(yt, "Parithabangal")
    assert item["id"] == "UCp" and how == "handle" and yt.searches == 0
    item, how = resolve(yt, "Mic Set")
    assert item["id"] == "UCmic" and how == "search" and yt.searches == 1
    item, how = resolve(yt, "Totally Unknown Name")
    assert item is None


def test_young_tracks_new_uploads_hourly(monkeypatch):
    from datetime import timedelta

    from sqlalchemy import select

    from ytanalytics import training
    from ytanalytics.config import Settings
    from ytanalytics.db import Channel, Video, VideoSnapshot, init_db, make_engine, make_session_factory, utcnow

    eng = make_engine("sqlite://")
    init_db(eng)
    monkeypatch.setattr(training, "training_engine", lambda main: eng)
    now = utcnow()
    Session = make_session_factory(eng)
    with Session() as s:
        s.add(Channel(id="UCt", title="T", active=True, role="training"))
        s.commit()
        s.add(Video(id="old0000000a", channel_id="UCt", title="old", published_at=now - timedelta(days=10)))
        s.add(Video(id="young00000a", channel_id="UCt", title="y", published_at=now - timedelta(hours=5),
                    stats_updated_at=now - timedelta(hours=2)))
        s.commit()

    class YT:
        calls = []

        def get_videos(self, ids):
            self.calls.append(sorted(ids))
            pub = {"young00000a": now - timedelta(hours=5), "brandnew00a": now - timedelta(hours=1), "resurfaced": now - timedelta(days=40)}
            return [{"id": i, "snippet": {"channelId": "UCt", "title": i, "publishedAt": pub[i].strftime("%Y-%m-%dT%H:%M:%SZ")},
                     "statistics": {"viewCount": "100"}} for i in ids if i in pub]

    feed = "<yt:videoId>brandnew00a</yt:videoId><yt:videoId>young00000a</yt:videoId><yt:videoId>resurfaced</yt:videoId>"
    with Session() as main:
        out = training.young(main, Settings.from_env(), yt=YT(), fetch=lambda url: feed)
    assert out == {"checked": 3, "new": 1} or out["new"] >= 1
    with Session() as s:
        ids = set(s.scalars(select(Video.id)).all())
        assert "brandnew00a" in ids and "resurfaced" not in ids
        assert s.query(VideoSnapshot).count() == 2  # the two young videos, not the old one
    with Session() as main:  # an hour hasn't passed: nothing is re-read
        assert training.young(main, Settings.from_env(), yt=YT(), fetch=lambda url: feed)["checked"] == 0


def test_accuracy_check_flags_missed_uploads_stale_views_and_missing_comments():
    from datetime import timedelta

    from ytanalytics.accuracy import check
    from ytanalytics.db import Channel, Comment, Video, init_db, make_engine, make_session_factory, utcnow

    eng = make_engine("sqlite://")
    init_db(eng)
    now = utcnow()
    with make_session_factory(eng)() as s:
        s.add(Channel(id="UCme", title="Me", active=True, subscriber_count=1000))
        s.add(Channel(id="UCriv", title="Rival", active=True, role="competitor"))
        s.commit()
        s.add(Video(id="vidA0000001", channel_id="UCme", title="A", published_at=now - timedelta(days=2), view_count=100,
                    stats_updated_at=now - timedelta(hours=10)))
        s.commit()
        for i in range(5):
            s.add(Comment(id=f"c{i}", video_id="vidA0000001", channel_id="UCme", text="x", published_at=now))
        s.commit()

        class YT:
            def get_channels(self, ids):
                return [{"id": "UCme", "statistics": {"subscriberCount": "1100", "videoCount": "2"}}]

            def get_videos(self, ids):
                live = {"vidA0000001": ("2026-11-20T00:00:00Z", "1000", "40"), "vidB0000001": ("2026-11-20T00:00:00Z", "5", "0")}
                return [{"id": i, "snippet": {"publishedAt": live[i][0]}, "statistics": {"viewCount": live[i][1], "commentCount": live[i][2]}}
                        for i in ids if i in live]

        rep = check(s, YT(), fetch=lambda url: "<yt:videoId>vidA0000001</yt:videoId><yt:videoId>vidB0000001</yt:videoId>")
    assert [c["id"] for c in rep["channels"]] == ["UCme"]  # rivals aren't checked
    text = " ".join(rep["problems"])
    assert "subscribers off by +9.1%" in text and "1 upload(s)" in text and "views 100 vs live 1000" in text and "5 of 40 comments" in text
