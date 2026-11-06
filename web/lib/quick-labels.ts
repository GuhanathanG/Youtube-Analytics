/**
 * Label comments that don't need an AI model: short reactions such as "first!", "❤️❤️",
 * "semma bro" or "super anna 🔥". Same rules as ytanalytics/quick_labels.py (keep both in sync).
 * Anything with a word outside these lists (e.g. "mokka" = boring) still goes to the AI.
 */
type Label = [sentiment: "positive" | "neutral" | "negative", emotion: string];

const WORDS = new Map<string, Label>();
for (const [words, label] of [
  ["nice super superb awesome amazing great good cool wow wonderful excellent beautiful fantastic best " +
   "brilliant perfect lovely mass massive fire lit legend legendary goat top class osm awsm gud " +
   "semma sema vera level velai thalaivar thalaiva thala mass-u kalakkal kalakal arumai arputham " +
   "nalla nallaruku sooper zabardast mast badhiya bahut accha acha shandaar kamaal kadak jhakaas " +
   "keka adurs adiripoli kidu sakkath bombat", ["positive", "admiration"]],
  ["love loved loving luv lub", ["positive", "love"]],
  ["thanks thank thankyou thx tq ty nandri nanri dhanyavad shukriya dhanyavadalu", ["positive", "gratitude"]],
  ["lol lmao haha hahaha hehe rofl lmfao", ["positive", "humor"]],
  ["first 1st early second 2nd third 3rd", ["neutral", "excitement"]],
  ["hi hello hey hii hiii vanakkam namaste namaskaram", ["neutral", "neutral"]],
] as [string, Label][]) for (const w of words.split(" ")) WORDS.set(w, label);

const LANG = new Map<string, string>();
for (const [lang, words] of [
  ["ta-Latn", "semma sema vera velai thalaivar thalaiva thala kalakkal kalakal arumai arputham nalla nallaruku " +
              "sooper nandri nanri vanakkam anna akka thambi dei machan machi macha iruku irukku"],
  ["hi-Latn", "zabardast mast badhiya bahut accha acha shandaar kamaal kadak jhakaas dhanyavad shukriya " +
              "namaste bhai bhaiya didi yaar hai"],
  ["te-Latn", "keka adurs dhanyavadalu namaskaram"],
  ["ml-Latn", "adiripoli kidu"],
  ["kn-Latn", "sakkath bombat"],
]) for (const w of words.split(" ")) LANG.set(w, lang);

const FILLER = new Set(`bro bruh brother sis sister anna akka thambi da di dei machan machi macha bhai bhaiya
  didi ji sir madam mam guys man dude yaar re ra ga very so too really much the a an is it this
  video vid content and u you your ur all of da ah iruku irukku hai h ho ga ta pa`.split(/\s+/));

const EMOJI = new Map<string, Label>();
for (const [chars, label] of [
  ["❤♥💖💗💓💞💕😍🥰😘💘💝🫶", ["positive", "love"]],
  ["😂🤣😆😹😄😁", ["positive", "humor"]],
  ["🔥👏💯🙌👌👍💪⚡🏆🥇⭐🌟✨🤩😎", ["positive", "admiration"]],
  ["🙏", ["positive", "gratitude"]],
  ["😊🙂☺😀😃🥳🎉", ["positive", "joy"]],
  ["😮😲😱🤯", ["neutral", "surprise"]],
  ["😢😭😞😔💔🥲🥺", ["negative", "sadness"]],
  ["😡😠🤬👎", ["negative", "anger"]],
  ["🤮🤢", ["negative", "disgust"]],
] as [string, Label][]) for (const ch of Array.from(chars)) EMOJI.set(ch, label);

const SCORES = { positive: 0.7, neutral: 0, negative: -0.7 } as const;

export type QuickLabel = { sentiment: "positive" | "neutral" | "negative"; score: number; emotion: string; lang: string | null };

/** Labels for a trivial comment, or null when it needs a real AI model. */
export function quickLabel(text: string | null | undefined): QuickLabel | null {
  const t = (text ?? "").trim().toLowerCase();
  if (!t || Array.from(t).length > 60 || t.includes("?") || t.includes("http") || t.includes("@")) return null;
  const words = t.match(/\p{L}+|\d+(?:st|nd|rd|th)?/gu) ?? [];
  const meaningful = words.filter((w) => !FILLER.has(w));
  if (meaningful.length > 3) return null;
  const langs = new Set(words.filter((w) => LANG.has(w)).map((w) => LANG.get(w)!));
  const labels: Label[] = [];
  for (let w of meaningful) {
    if (w.endsWith("u") && WORDS.has(w.replace(/u+$/, ""))) w = w.replace(/u+$/, "");
    w = w.replace(/(.)\1{2,}/gu, "$1$1"); // "superrrr" -> "superr"
    const label = WORDS.get(w) ?? WORDS.get(w.replace(/(.)\1+/gu, "$1"));
    if (!label) return null; // an unknown word: let the AI read it
    labels.push(label);
  }
  for (const ch of Array.from(t)) { const l = EMOJI.get(ch); if (l) labels.push(l); }
  if (!labels.length) return null;
  const sentiments = new Set(labels.map(([s]) => s));
  if (sentiments.has("positive") && sentiments.has("negative")) return null; // mixed signals: needs judgement
  const sentiment = sentiments.has("negative") ? "negative" : sentiments.has("positive") ? "positive" : "neutral";
  const emotions = labels.map(([, e]) => e).filter((e) => e !== "neutral");
  const counts = new Map<string, number>();
  for (const e of emotions) counts.set(e, (counts.get(e) ?? 0) + 1);
  const emotion = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "neutral";
  return { sentiment, score: SCORES[sentiment], emotion, lang: langs.size === 1 ? [...langs][0] : null };
}
