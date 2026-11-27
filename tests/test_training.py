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
