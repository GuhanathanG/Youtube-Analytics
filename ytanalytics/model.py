"""Pulse prediction engine: learns what makes a video do well, from every tracked channel.

How it works (run daily by .github/workflows/model.yml, `python -m ytanalytics train`):

1. Every video at least 7 days old becomes a training example. Its *score* is how it did against its
   own channel's normal: log(views / median views of that channel's previous 15 uploads). Measuring
   against the channel's own normal lets small and big channels (yours and competitors') teach one
   model, so every channel added makes it more accurate.
2. What the model sees: things known *before* publishing (format, length, title style, day/hour, tags,
   captions, upload rhythm) plus the video's age. Likes and comments are kept out of the model on
   purpose: they arrive after the views, so they would make forecasts look accurate without helping a
   creator decide anything. They are used afterwards to judge engagement.
3. Honesty check: the newest 20% of videos are held back, the model learns from the older 80% and
   predicts the newest ones. The result (how often it lands within 2× of the truth, and whether it beats
   "every video does the channel's usual") is saved and shown on the website. Then it relearns on all.
4. Drivers: for each channel, the model re-predicts that channel's recent videos with one thing changed
   (e.g. a number in the title, or Saturday instead of Tuesday). The average change is the measured
   effect, reported only when enough videos on both sides back it.
5. Forecasts for videos under 30 days old blend the model's expectation with the video's real early
   numbers; the real numbers count for more as the video ages.
6. A small linear version of the model (coefficients only) is saved too, so the website can estimate
   a draft before it's published (Packaging Lab / Predict page) without running Python.
"""
from __future__ import annotations

import json
import logging
import math
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

log = logging.getLogger(__name__)

MIN_TRAIN = 40          # fewer usable videos than this: no model yet
BASELINE_WINDOW = 15    # "channel normal" = median views of the previous N uploads
MATURE_DAYS = 7         # only videos at least this old teach the model
TZ_OFFSET_HOURS = 5.5   # publishing hour is read in India time (MODEL_TZ_OFFSET to change)

# Share of 30-day views reached by a given age (hours); typical YouTube curve, refined per channel
# from snapshots when there's enough history.
DEFAULT_CURVE = [(1, 0.04), (6, 0.15), (24, 0.38), (48, 0.52), (168, 0.78), (720, 1.0)]

# Features the website's what-if estimator can work out from a draft (title, format, length, day, hour).
LINEAR_FEATURES = ["is_short", "log_minutes", "title_len", "has_number", "has_question", "has_exclaim",
                   "has_emoji", "has_brackets", "has_caps_word", "has_pipe", "hour_sin", "hour_cos", "is_weekend"]

EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿]")
ISO_DUR = re.compile(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?")


def duration_seconds(iso: str | None) -> float | None:
    if not iso:
        return None
    m = ISO_DUR.fullmatch(iso)
    if not m:
        return None
    d, h, mi, s = (int(x) if x else 0 for x in m.groups())
    return float(d * 86400 + h * 3600 + mi * 60 + s)


def title_features(title: str) -> dict[str, float]:
    t = title or ""
    words = t.split()
    return {
        "title_len": float(len(t)),
        "title_words": float(len(words)),
        "has_number": float(bool(re.search(r"\d", t))),
        "has_question": float("?" in t),
        "has_exclaim": float("!" in t),
        "has_emoji": float(bool(EMOJI.search(t))),
        "has_brackets": float(bool(re.search(r"[\[\(\{]", t))),
        "has_caps_word": float(any(len(w) >= 3 and w.isupper() and w.isalpha() for w in words)),
        "has_pipe": float(bool(re.search(r"[|–—-]", t))),
        "has_year": float(bool(re.search(r"\b20\d\d\b", t))),
        "has_hashtag": float("#" in t),
    }


def video_features(v: dict, prev_published: datetime | None, tz_hours: float = TZ_OFFSET_HOURS) -> dict[str, float]:
    """Everything known before publishing (plus nothing that arrives later)."""
    secs = duration_seconds(v.get("duration"))
    pub: datetime = v["published_at"]
    local = pub + timedelta(hours=tz_hours)
    hour = local.hour + local.minute / 60
    f = title_features(v.get("title") or "")
    tags = [x for x in re.split(r"[|,]", v.get("tags") or "") if x.strip()]
    f.update({
        "is_short": float(secs is not None and 0 < secs <= 180),  # YouTube Shorts are up to 3 minutes
        "log_minutes": math.log1p((secs or 0) / 60),
        "hour_sin": math.sin(2 * math.pi * hour / 24),
        "hour_cos": math.cos(2 * math.pi * hour / 24),
        "hour": float(local.hour),
        "weekday": float(local.weekday()),
        "is_weekend": float(local.weekday() >= 5),
        "n_tags": float(len(tags)),
        "log_desc": math.log1p(len(v.get("description") or "")),
        "has_captions": float(bool(v.get("has_captions"))),
        "is_live": float(bool(v.get("live_status"))),
        "gap_days": min(60.0, (pub - prev_published).total_seconds() / 86400) if prev_published else 14.0,
    })
    return f


def curve_share(points: list[tuple[float, float]], hours: float) -> float:
    if hours <= points[0][0]:
        return points[0][1] * hours / points[0][0]
    for (h0, s0), (h1, s1) in zip(points, points[1:]):
        if hours <= h1:
            r = (math.log(hours) - math.log(h0)) / (math.log(h1) - math.log(h0))
            return s0 + (s1 - s0) * r
    return points[-1][1]


@dataclass
class Example:
    video_id: str
    channel_id: str
    published_at: datetime
    features: dict[str, float]
    baseline: float          # channel normal (views) at publish time
    views: float | None
    likes: float | None
    comments: float | None
    age_days: float

    @property
    def target(self) -> float:
        return math.log1p(self.views or 0) - math.log1p(self.baseline)


def build_examples(videos: list[dict], now: datetime) -> list[Example]:
    """videos: rows with id, channel_id, title, description, duration, tags, has_captions, live_status,
    published_at, view_count, like_count, comment_count. Baseline uses only *earlier* uploads (no peeking)."""
    by_ch: dict[str, list[dict]] = {}
    for v in videos:
        if v.get("published_at") is not None:
            by_ch.setdefault(v["channel_id"], []).append(v)
    out: list[Example] = []
    for ch, rows in by_ch.items():
        rows.sort(key=lambda r: r["published_at"])
        # Shorts and long videos live on different scales, so each is compared with its own kind.
        history: dict[bool, list[float]] = {True: [], False: []}
        prev = None
        for v in rows:
            secs = duration_seconds(v.get("duration"))
            short = secs is not None and 0 < secs <= 180
            hist = history[short] if len(history[short]) >= 5 else history[True] + history[False]
            if len(hist) >= 5:
                window = sorted(hist[-BASELINE_WINDOW:])
                base = window[len(window) // 2]
                recent = sorted(hist[-5:])
                feats = video_features(v, prev)
                # Momentum: is the channel's last handful above or below its usual?
                feats["momentum"] = math.log1p(recent[len(recent) // 2]) - math.log1p(base)
                feats["log_baseline"] = math.log1p(base)
                out.append(Example(v["id"], ch, v["published_at"], feats, float(base),
                                   None if v.get("view_count") is None else float(v["view_count"]),
                                   None if v.get("like_count") is None else float(v["like_count"]),
                                   None if v.get("comment_count") is None else float(v["comment_count"]),
                                   max(0.01, (now - v["published_at"]).total_seconds() / 86400)))
            if v.get("view_count") is not None and (now - v["published_at"]).days >= MATURE_DAYS:
                history[short].append(float(v["view_count"]))
            prev = v["published_at"]
    return out


FEATURES = sorted(set(LINEAR_FEATURES) | {"title_words", "has_year", "has_hashtag", "weekday", "hour", "n_tags",
                                          "log_desc", "has_captions", "is_live", "gap_days", "log_age",
                                          "momentum", "log_baseline"})


def matrix(examples: list[Example], age_days: float | None = None):
    import numpy as np

    rows = []
    for e in examples:
        f = dict(e.features)
        f["log_age"] = math.log1p(age_days if age_days is not None else e.age_days)
        rows.append([f[k] for k in FEATURES])
    return np.array(rows, dtype=float)


def _fit(X, y):
    from sklearn.ensemble import HistGradientBoostingRegressor

    # Absolute error: one viral video shouldn't drag every prediction up. Small trees: little data per channel.
    m = HistGradientBoostingRegressor(max_iter=200, learning_rate=0.05, max_leaf_nodes=8, min_samples_leaf=12,
                                      l2_regularization=2.0, loss="absolute_error", random_state=7)
    m.fit(X, y)
    return m


def backtest(train: list[Example]) -> dict:
    """Learn on the older 80%, predict the newest 20%."""
    import numpy as np

    ordered = sorted(train, key=lambda e: e.published_at)
    cut = int(len(ordered) * 0.8)
    old, new = ordered[:cut], ordered[cut:]
    if len(old) < MIN_TRAIN or len(new) < 8:
        return {"tested": 0}
    m = _fit(matrix(old), np.array([e.target for e in old]))
    pred = m.predict(matrix(new))
    truth = np.array([e.target for e in new])
    err = np.abs(pred - truth)
    base_err = np.abs(truth)  # "every video does the channel's usual"
    from scipy.stats import spearmanr  # noqa: PLC0415 (scipy comes with scikit-learn)

    rank = spearmanr(pred, truth).statistic if len(new) > 3 else None
    return {
        "tested": len(new),
        "within_2x": float(np.mean(err <= math.log(2))),
        "baseline_within_2x": float(np.mean(base_err <= math.log(2))),
        "typical_miss": float(math.exp(np.median(err))),           # e.g. 1.6 = typically off by 1.6×
        "baseline_typical_miss": float(math.exp(np.median(base_err))),
        "rank_corr": None if rank is None or math.isnan(rank) else float(rank),
    }


def _effect(model, X, col: int, value: float) -> float:
    import numpy as np

    Xc = X.copy()
    Xc[:, col] = value
    return float(np.mean(model.predict(Xc)))


def stable_drivers(train: list[Example], channel_examples: list[Example]) -> list[dict]:
    """Drivers that hold in both the older and the newer half of the history (a channel that changed its
    upload time while it grew would otherwise credit the time for the growth). Reports the smaller effect."""
    import numpy as np

    ordered = sorted(train, key=lambda e: e.published_at)
    half = len(ordered) // 2
    if half < MIN_TRAIN:
        return []
    parts = []
    for part in (ordered[:half], ordered[half:]):
        m = _fit(matrix(part), np.array([e.target for e in part]))
        parts.append({d["key"]: d for d in drivers(m, part, channel_examples, keep_all=True)})
    out = []
    for k, d_new in parts[1].items():
        d_old = parts[0].get(k)
        if not d_old or (d_old["effect"] > 0) != (d_new["effect"] > 0):
            continue
        if d_old.get("hour", d_new.get("hour")) != d_new.get("hour") or d_old.get("day", d_new.get("day")) != d_new.get("day"):
            continue  # a different "best" time in each half: not a stable finding
        if d_old.get("minutes") is not None and abs(d_old["minutes"] - d_new["minutes"]) > 6:
            continue
        effect = min(abs(d_old["effect"]), abs(d_new["effect"])) * (1 if d_new["effect"] > 0 else -1)
        if abs(effect) >= 0.08:
            out.append({**d_new, "effect": effect, "support": d_old["support"] + d_new["support"]})
    out.sort(key=lambda d: -abs(d["effect"]))
    return out[:8]


def drivers(model, train: list[Example], channel_examples: list[Example], keep_all: bool = False) -> list[dict]:
    """Measured effects for one channel: re-predict its recent videos with one thing changed."""
    import numpy as np

    recent = sorted(channel_examples, key=lambda e: e.published_at)[-60:]
    if len(recent) < 10:
        return []
    X = matrix(recent, age_days=30)
    allX = matrix(train)
    idx = {k: i for i, k in enumerate(FEATURES)}
    out: list[dict] = []
    labels = {
        "has_number": ("Numbers in the title", "title"), "has_question": ("A question in the title", "title"),
        "has_exclaim": ("An exclamation mark in the title", "title"), "has_emoji": ("Emoji in the title", "title"),
        "has_brackets": ("Brackets in the title, e.g. (Part 2)", "title"), "has_caps_word": ("An ALL-CAPS word in the title", "title"),
        "has_pipe": ("A | or – split in the title", "title"), "has_year": ("The year in the title", "title"),
        "has_hashtag": ("A #hashtag in the title", "title"), "has_captions": ("Captions/subtitles", "packaging"),
        "is_short": ("Shorts (vs long videos)", "format"), "is_weekend": ("Weekend uploads", "timing"),
    }
    for k, (label, kind) in labels.items():
        col = idx[k]
        support_on = int(np.sum(allX[:, col] == 1))
        support_off = int(np.sum(allX[:, col] == 0))
        if min(support_on, support_off) < 20:
            continue
        diff = _effect(model, X, col, 1) - _effect(model, X, col, 0)
        out.append({"key": k, "label": label, "kind": kind, "effect": math.exp(diff) - 1, "support": min(support_on, support_off)})
    # Best publishing time window (3-hour blocks) and day.
    hcol, scol, ccol, wcol, wecol = idx["hour"], idx["hour_sin"], idx["hour_cos"], idx["weekday"], idx["is_weekend"]
    base = float(np.mean(model.predict(X)))
    blocks = []
    for start in range(0, 24, 3):
        h = start + 1.5
        Xc = X.copy()
        Xc[:, hcol] = start + 1
        Xc[:, scol] = math.sin(2 * math.pi * h / 24)
        Xc[:, ccol] = math.cos(2 * math.pi * h / 24)
        blocks.append((float(np.mean(model.predict(Xc))) - base, start))
    hours_seen = {int(h) // 3 * 3 for h in allX[:, hcol]}
    blocks = [b for b in blocks if b[1] in hours_seen]
    if len(blocks) >= 2:
        best = max(blocks)
        worst = min(blocks)
        out.append({"key": "best_hour", "label": f"Publishing {best[1]:02d}:00–{best[1] + 3:02d}:00 (India time)", "kind": "timing",
                    "effect": math.exp(best[0] - worst[0]) - 1, "support": len(train), "hour": best[1], "worst_hour": worst[1]})
    days = []
    names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    seen_days = {int(d) for d in allX[:, wcol]}
    for d in range(7):
        if d not in seen_days:
            continue
        Xc = X.copy()
        Xc[:, wcol] = d
        Xc[:, wecol] = float(d >= 5)
        days.append((float(np.mean(model.predict(Xc))) - base, d))
    if len(days) >= 3:
        best, worst = max(days), min(days)
        out.append({"key": "best_day", "label": f"{names[best[1]]} uploads (vs {names[worst[1]]})", "kind": "timing",
                    "effect": math.exp(best[0] - worst[0]) - 1, "support": len(train), "day": best[1]})
    # Length sweet spot (long videos only).
    lcol = idx["log_minutes"]
    longs = X[X[:, idx["is_short"]] == 0]
    if len(longs) >= 8:
        lens = []
        for minutes in (4, 8, 12, 18, 25, 40):
            Xc = longs.copy()
            Xc[:, lcol] = math.log1p(minutes)
            lens.append((float(np.mean(model.predict(Xc))), minutes))
        seen = allX[allX[:, idx["is_short"]] == 0][:, lcol]
        lo, hi = (math.expm1(float(np.quantile(seen, q))) for q in (0.1, 0.9)) if len(seen) else (0, 0)
        lens = [x for x in lens if lo <= x[1] <= hi * 1.2] or lens
        best, worst = max(lens), min(lens)
        out.append({"key": "best_length", "label": f"Long videos around {best[1]} minutes", "kind": "format",
                    "effect": math.exp(best[0] - worst[0]) - 1, "support": len(longs), "minutes": best[1]})
    if not keep_all:
        out = [d for d in out if abs(d["effect"]) >= 0.08]
    out.sort(key=lambda d: -abs(d["effect"]))
    return out if keep_all else out[:10]


def fit_linear(train: list[Example]) -> dict:
    """Small linear model for the website's what-if estimator (coefficients only)."""
    import numpy as np
    from sklearn.linear_model import Ridge

    rows = [[e.features[k] for k in LINEAR_FEATURES] + [math.log1p(min(e.age_days, 365))] for e in train]
    X = np.array(rows, dtype=float)
    y = np.array([e.target for e in train])
    mean = X.mean(axis=0)
    scale = X.std(axis=0)
    scale[scale < 0.05] = 1  # (almost) never varies: don't let a draft's different value blow up the estimate
    r = Ridge(alpha=3.0).fit((X - mean) / scale, y)
    names = LINEAR_FEATURES + ["log_age"]
    return {"features": names, "mean": mean.round(5).tolist(), "scale": scale.round(5).tolist(),
            "coef": r.coef_.round(5).tolist(), "intercept": round(float(r.intercept_), 5)}


def forecast(model, e: Example, curve: list[tuple[float, float]]) -> dict:
    """30-day views for a young video: model expectation blended with its real numbers so far."""
    import numpy as np

    prior_log = float(model.predict(matrix([e], age_days=30))[0]) + math.log1p(e.baseline)
    hours = max(0.25, e.age_days * 24)
    share = max(0.03, curve_share(curve, min(hours, 720)))
    if e.views is not None and e.views > 0:
        momentum_log = math.log1p(e.views / share)
        w = min(0.9, hours / 72)  # real numbers count more as the video ages
        est_log = (1 - w) * prior_log + w * momentum_log
    else:
        est_log, w = prior_log, 0.0
    spread = 0.9 * (1 - w) + 0.25  # wider when it's mostly the model talking
    est = float(np.expm1(est_log))
    like_rate = (e.likes / e.views) if e.views and e.likes is not None and e.views > 50 else None
    return {"views_30d": round(est), "low": round(float(np.expm1(est_log - spread))), "high": round(float(np.expm1(est_log + spread))),
            "vs_normal": est / max(1.0, e.baseline), "baseline": round(e.baseline), "confidence": round(w, 2),
            "likes_30d": None if like_rate is None else round(est * like_rate)}


def channel_curve(snaps: list[dict]) -> list[tuple[float, float]]:
    """This channel's own curve from snapshots of videos that reached 30 days, if there are enough."""
    import numpy as np

    by_video: dict[str, list[tuple[float, float]]] = {}
    for s in snaps:
        by_video.setdefault(s["video_id"], []).append((s["age_h"], float(s["views"] or 0)))
    finals = {}
    for vid, pts in by_video.items():
        pts.sort()
        if pts[-1][0] >= 700 and pts[-1][1] > 0:
            finals[vid] = pts[-1][1]
    if len(finals) < 8:
        return DEFAULT_CURVE
    out = []
    for h, default in DEFAULT_CURVE[:-1]:
        shares = [min(1.0, v / finals[vid]) for vid, pts in by_video.items() if vid in finals
                  for (a, v) in pts if abs(a - h) <= max(0.5, h * 0.2)]
        out.append((h, float(np.median(shares)) if len(shares) >= 5 else default))
    out.append((720, 1.0))
    # keep it rising
    for i in range(1, len(out)):
        out[i] = (out[i][0], max(out[i][1], out[i - 1][1]))
    return out


# ------------------------------------------------------------------ database side
def _ensure_tables(session) -> None:
    from sqlalchemy import text

    session.execute(text("""create table if not exists engine_model (
        id text primary key, trained_at timestamp not null, n_videos integer not null, n_channels integer not null,
        metrics text, drivers text, linear text, curve text)"""))
    session.execute(text("""create table if not exists video_forecast (
        video_id text primary key, channel_id text not null, updated_at timestamp not null, views_30d double precision,
        low double precision, high double precision, vs_normal double precision, baseline double precision,
        confidence double precision, likes_30d double precision)"""))
    # The first forecast made once a video is a day old is kept, to grade the engine when the video turns 30 days.
    for col in ("first_views_30d double precision", "first_at timestamp", "actual_30d double precision"):
        session.execute(text(f"alter table video_forecast add column if not exists {col}"))
    for t in ("engine_model", "video_forecast"):
        session.execute(text(f"alter table {t} enable row level security"))
    session.commit()


def train(session, now: datetime | None = None) -> dict:
    import numpy as np
    from sqlalchemy import text

    now = now or datetime.now(timezone.utc).replace(tzinfo=None)
    _ensure_tables(session)
    rows = [dict(r._mapping) for r in session.execute(text("""
        select v.id, v.channel_id, v.title, v.description, v.duration, v.tags, v.has_captions, v.live_status, v.published_at,
               v.view_count, v.like_count, v.comment_count, coalesce(c.platform, 'youtube') as platform
        from videos v join channels c on c.id = v.channel_id
        where v.published_at is not null and coalesce(c.platform, 'youtube') = 'youtube'"""))]
    examples = build_examples(rows, now)
    train_set = [e for e in examples if e.age_days >= MATURE_DAYS and e.views is not None]
    channels = sorted({e.channel_id for e in train_set})
    if len(train_set) < MIN_TRAIN:
        log.info("Prediction engine: %d usable videos, need %d", len(train_set), MIN_TRAIN)
        return {"trained": False, "videos": len(train_set)}
    metrics = backtest(train_set)
    graded = session.execute(text("""select first_views_30d f, actual_30d a from video_forecast
        where first_views_30d > 0 and actual_30d > 0""")).all()
    if graded:
        errs = [abs(math.log(r.f) - math.log(r.a)) for r in graded]
        metrics["live_graded"] = len(graded)
        metrics["live_within_2x"] = sum(x <= math.log(2) for x in errs) / len(errs)
    model = _fit(matrix(train_set), np.array([e.target for e in train_set]))
    linear = fit_linear(train_set)
    snaps = [dict(r._mapping) for r in session.execute(text("""
        select s.video_id, v.channel_id, extract(epoch from (s.taken_at - v.published_at)) / 3600 as age_h, s.view_count as views
        from video_snapshots s join videos v on v.id = s.video_id"""))]
    stamp = now.replace(microsecond=0)
    mine = [r[0] for r in session.execute(text("select id from channels where active and coalesce(platform, 'youtube') = 'youtube'"))]
    saved = 0
    for ch in mine:
        ch_examples = [e for e in examples if e.channel_id == ch]
        curve = channel_curve([s for s in snaps if s["channel_id"] == ch])
        drv = stable_drivers(train_set, [e for e in ch_examples if e.age_days >= MATURE_DAYS])
        session.execute(text("""insert into engine_model (id, trained_at, n_videos, n_channels, metrics, drivers, linear, curve)
            values (:id, :t, :n, :c, :m, :d, :l, :cv) on conflict (id) do update set trained_at = excluded.trained_at,
            n_videos = excluded.n_videos, n_channels = excluded.n_channels, metrics = excluded.metrics, drivers = excluded.drivers,
            linear = excluded.linear, curve = excluded.curve"""),
            {"id": ch, "t": stamp, "n": len(train_set), "c": len(channels), "m": json.dumps(metrics), "d": json.dumps(drv),
             "l": json.dumps({**linear, "baseline": _latest_baseline(ch_examples)}), "cv": json.dumps(curve)})
        for e in ch_examples:
            if e.age_days < 30:
                f = forecast(model, e, curve)
                session.execute(text("""insert into video_forecast (video_id, channel_id, updated_at, views_30d, low, high, vs_normal,
                    baseline, confidence, likes_30d, first_views_30d, first_at) values (:v, :c, :t, :views_30d, :low, :high, :vs_normal,
                    :baseline, :confidence, :likes_30d, case when :age_h >= 20 then :views_30d end, case when :age_h >= 20 then :t end)
                    on conflict (video_id) do update set updated_at = excluded.updated_at, views_30d = excluded.views_30d, low = excluded.low,
                    high = excluded.high, vs_normal = excluded.vs_normal, baseline = excluded.baseline, confidence = excluded.confidence,
                    likes_30d = excluded.likes_30d,
                    first_views_30d = coalesce(video_forecast.first_views_30d, case when :age_h >= 20 then excluded.views_30d end),
                    first_at = coalesce(video_forecast.first_at, case when :age_h >= 20 then excluded.updated_at end)"""),
                    {"v": e.video_id, "c": ch, "t": stamp, "age_h": e.age_days * 24, **f})
            elif 30 <= e.age_days < 45 and e.views is not None:
                session.execute(text("update video_forecast set actual_30d = :a where video_id = :v and actual_30d is null"),
                                {"a": e.views, "v": e.video_id})
                saved += 1
    # Graded forecasts stay (they are the engine's track record); ungraded stale ones go.
    session.execute(text("delete from video_forecast where updated_at < :t - interval '60 days' and actual_30d is null"), {"t": stamp})
    session.commit()
    log.info("Prediction engine trained on %d videos from %d channels; backtest %s; %d forecasts",
             len(train_set), len(channels), metrics, saved)
    return {"trained": True, "videos": len(train_set), "channels": len(channels), "metrics": metrics, "forecasts": saved}


def _latest_baseline(examples: list[Example]) -> float | None:
    mature = sorted((e for e in examples if e.age_days >= MATURE_DAYS and e.views is not None), key=lambda e: e.published_at)
    if not mature:
        return None
    window = sorted(e.views for e in mature[-BASELINE_WINDOW:])  # type: ignore[misc]
    return float(window[len(window) // 2])
