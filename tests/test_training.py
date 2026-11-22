"""Training database: matching researched channel names to real YouTube channels."""
from ytanalytics.training import name_matches, resolve


def test_name_matches_title_or_handle():
    assert name_matches("Village Cooking Channel", "Village Cooking Channel", "@villagecookingchannel")
    assert name_matches("Mic Set", "Micset", "@micsetofficial")
    assert name_matches("Madan Gowri", "Madan Gowri", None)
    assert not name_matches("Madras Samayal", "Madras Central", "@madrascentral")
    assert not name_matches("Trading Tamil", "Tamil Songs HD", None)


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
