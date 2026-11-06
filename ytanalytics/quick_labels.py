"""Label comments that don't need an AI model.

Very short reactions such as "first!", "❤️❤️", "semma bro" or "super anna 🔥" make up a large
share of YouTube comments. Sending them to a free AI model wastes its small daily allowance,
so they're labelled here with simple, transparent rules instead (ai_model = "rules").

Anything with a word outside the known lists (e.g. "mokka" = boring) still goes to the AI.
The website has the same rules in web/lib/quick-labels.ts; keep both in sync.
"""
from __future__ import annotations

import re

# word -> (sentiment, emotion). Romanized Tamil, Hindi, Telugu, Malayalam, Kannada, plus English.
WORDS: dict[str, tuple[str, str]] = {}
for words, label in [
    ("nice super superb awesome amazing great good cool wow wonderful excellent beautiful fantastic best "
     "brilliant perfect lovely mass massive fire lit legend legendary goat top class osm awsm gud "
     "semma sema vera level velai thalaivar thalaiva thala mass-u kalakkal kalakal arumai arputham "
     "nalla nallaruku sooper zabardast mast badhiya bahut accha acha shandaar kamaal kadak jhakaas "
     "keka adurs adiripoli kidu sakkath bombat", ("positive", "admiration")),
    ("love loved loving luv lub", ("positive", "love")),
    ("thanks thank thankyou thx tq ty nandri nanri dhanyavad shukriya dhanyavadalu", ("positive", "gratitude")),
    ("lol lmao haha hahaha hehe rofl lmfao 😂", ("positive", "humor")),
    ("first 1st early second 2nd third 3rd", ("neutral", "excitement")),
    ("hi hello hey hii hiii vanakkam namaste namaskaram", ("neutral", "neutral")),
]:
    for w in words.split():
        WORDS[w] = label

# Words that reveal the (romanized) language, so "semma bro" is stored as Tamil, not English.
LANG: dict[str, str] = {}
for lang, words in [
    ("ta-Latn", "semma sema vera velai thalaivar thalaiva thala kalakkal kalakal arumai arputham nalla nallaruku "
                "sooper nandri nanri vanakkam anna akka thambi dei machan machi macha iruku irukku"),
    ("hi-Latn", "zabardast mast badhiya bahut accha acha shandaar kamaal kadak jhakaas dhanyavad shukriya "
                "namaste bhai bhaiya didi yaar hai"),
    ("te-Latn", "keka adurs dhanyavadalu namaskaram"),
    ("ml-Latn", "adiripoli kidu"),
    ("kn-Latn", "sakkath bombat"),
]:
    for w in words.split():
        LANG[w] = lang

# Filler words that don't change the meaning ("super bro", "semma anna").
FILLER = set("""bro bruh brother sis sister anna akka thambi da di dei machan machi macha bhai bhaiya
    didi ji sir madam mam guys man dude yaar re ra ga very so too really much the a an is it this
    video vid content and u you your ur all of da ah iruku irukku hai h ho ga ta pa""".split())

EMOJI: dict[str, tuple[str, str]] = {}
for chars, label in [
    ("❤♥💖💗💓💞💕😍🥰😘💘💝🫶", ("positive", "love")),
    ("😂🤣😆😹😄😁", ("positive", "humor")),
    ("🔥👏💯🙌👌👍💪⚡🏆🥇⭐🌟✨🤩😎", ("positive", "admiration")),
    ("🙏", ("positive", "gratitude")),
    ("😊🙂☺😀😃🥳🎉", ("positive", "joy")),
    ("😮😲😱🤯", ("neutral", "surprise")),
    ("😢😭😞😔💔🥲🥺", ("negative", "sadness")),
    ("😡😠🤬👎", ("negative", "anger")),
    ("🤮🤢", ("negative", "disgust")),
]:
    for ch in chars:
        EMOJI[ch] = label

_WORD = re.compile(r"[^\W\d_]+|\d+(?:st|nd|rd|th)?", re.UNICODE)
_SCORES = {"positive": 0.7, "neutral": 0.0, "negative": -0.7}


def quick_label(text: str | None) -> dict | None:
    """Return labels for a trivial comment, or None when it needs a real AI model."""
    t = (text or "").strip().lower()
    if not t or len(t) > 60 or "?" in t or "http" in t or "@" in t:
        return None
    words = _WORD.findall(t)
    meaningful = [w for w in words if w not in FILLER]
    if len(meaningful) > 3:
        return None
    labels = []
    langs = {LANG[w] for w in words if w in LANG}
    for w in meaningful:
        w = w.rstrip("u") if w.endswith("u") and w.rstrip("u") in WORDS else w
        w = re.sub(r"(.)\1{2,}", r"\1\1", w)  # "superrrr" -> "superr"
        label = WORDS.get(w) or WORDS.get(re.sub(r"(.)\1+", r"\1", w))
        if label is None:
            return None  # an unknown word: let the AI read it
        labels.append(label)
    labels += [EMOJI[ch] for ch in t if ch in EMOJI]
    if not labels:
        return None  # only fillers / unknown symbols
    sentiments = {s for s, _ in labels}
    if "positive" in sentiments and "negative" in sentiments:
        return None  # mixed signals ("😂😭"): needs judgement
    sentiment = "negative" if "negative" in sentiments else "positive" if "positive" in sentiments else "neutral"
    emotions = [e for _, e in labels if e != "neutral"] or ["neutral"]
    emotion = max(set(emotions), key=emotions.count)
    return {"sentiment": sentiment, "score": _SCORES[sentiment], "emotion": emotion,
            "lang": langs.pop() if len(langs) == 1 else None}
