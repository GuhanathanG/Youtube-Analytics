// Unit tests for pure logic. Run: node --experimental-strip-types tests/logic.test.ts
import assert from "node:assert/strict";
import { quickLabel } from "../lib/quick-labels.ts";
import { pickGeminiModels } from "../lib/gemini-models.ts";
import { healthScore, normalizeBrand } from "../lib/health-math.ts";
import { buildMoves, type MoveInputs } from "../lib/moves.ts";
import { demandWords, scoreTitle } from "../lib/packaging.ts";
import { THUMB_FEATURES, featureLift, TITLE_FEATURES, durationSeconds, forecastViews, isShort, median, titleWords, weekOf } from "../lib/analytics-math.ts";

// Rule labels (same cases as tests/test_ai.py::test_quick_labels)
assert.equal(quickLabel("first!!")?.sentiment, "neutral");
const semma = quickLabel("Semma anna 🔥🔥");
assert.equal(semma?.sentiment, "positive"); assert.equal(semma?.emotion, "admiration"); assert.equal(semma?.lang, "ta-Latn");
assert.equal(quickLabel("❤️❤️❤️")?.emotion, "love");
assert.equal(quickLabel("😭😭")?.sentiment, "negative");
assert.equal(quickLabel("superrrr bro")?.sentiment, "positive");
assert.equal(quickLabel("bahut accha bhai")?.lang, "hi-Latn");
for (const needsAi of ["mokka padam", "nice?", "super but audio is bad", "😂😭", "check my channel @x", "", "bro",
  "this video is about the new phone and its camera"]) assert.equal(quickLabel(needsAi), null, needsAi);

// Gemini models are discovered, not guessed (same case as the Python test)
const listed = [
  ["gemini-3.5-flash", ["generateContent"]], ["gemini-3.5-flash-lite", ["generateContent"]],
  ["gemini-3.5-flash-image", ["generateContent"]], ["text-embedding-005", ["embedContent"]],
  ["gemini-3.5-pro", ["generateContent"]], ["gemini-3.6-flash-lite-preview", ["generateContent"]],
  ["gemini-3.5-flash-tts", ["generateContent"]],
].map(([n, m]) => ({ name: `models/${n}`, supportedGenerationMethods: m as string[] }));
assert.deepEqual(pickGeminiModels(listed), ["gemini-3.5-flash-lite", "gemini-3.6-flash-lite-preview", "gemini-3.5-flash"]);

// Analytics math
assert.equal(median([5, 1, 3]), 3); assert.equal(median([4, 1, 3, 2]), 2.5); assert.equal(median([]), null);
assert.equal(durationSeconds("PT1H2M3S"), 3723); assert.equal(durationSeconds("PT45S"), 45); assert.equal(durationSeconds("P1DT1M"), 86460);
assert.equal(durationSeconds("bad"), null);
assert.ok(isShort(59) && isShort(180) && !isShort(181) && !isShort(null));
const feat = (key: string, t: string) => TITLE_FEATURES.find((f) => f.key === key)!.test(t);
assert.ok(feat("emoji", "Budget phone 🔥") && !feat("emoji", "Budget phone"));
assert.ok(feat("number", "Top 5 phones") && feat("question", "Worth it?") && feat("caps", "BEST phone") && feat("pipe", "Phone | Review"));
assert.deepEqual(titleWords("The BEST Budget Phone vs iPhone 15 | Review"), ["best", "budget", "phone", "iphone", "review"]);
// Forecast: views = 1000 + 500·ln(hours) -> grows slowly, never below the latest count
const pts = [2, 6, 12, 24].map((h) => ({ hours: h, views: Math.round(1000 + 500 * Math.log(h)) }));
const [d7, d30] = forecastViews(pts, [24 * 8, 24 * 30])!;
assert.ok(Math.abs(d7 - (1000 + 500 * Math.log(192))) < 5 && d30 > d7, `${d7} ${d30}`);
assert.equal(forecastViews(pts.slice(0, 2), [100]), null); // too few points
assert.deepEqual(forecastViews([{ hours: 2, views: 900 }, { hours: 5, views: 800 }, { hours: 10, views: 700 }], [100]), [700]); // never shrinks
assert.equal(weekOf(new Date("2026-11-05T12:00:00Z")), "2026-11-02");

// Health score
const strong = healthScore({ subscriberGrowthPct: 6, likeRate: 0.06, commentRate: 0.01, mood: 0.6, loyalShare: 0.2, weeksWithUploads: 8, weeks: 8, recentOutlier: 2 });
assert.equal(strong.score, 97); assert.equal(strong.grade, "Excellent"); assert.equal(strong.parts.length, 6);
const weak = healthScore({ subscriberGrowthPct: -3, likeRate: 0.01, commentRate: null, mood: -0.4, loyalShare: null, weeksWithUploads: 1, weeks: 8, recentOutlier: 0.5 });
assert.ok(weak.score! < 45 && weak.grade === "Needs attention" && weak.parts.length === 5, JSON.stringify(weak));
assert.equal(healthScore({ subscriberGrowthPct: null, likeRate: null, commentRate: null, mood: null, loyalShare: null, weeksWithUploads: 0, weeks: 0, recentOutlier: null }).score, null);
// Brand names
assert.equal(normalizeBrand("Samsung Galaxy S26 (shown on desk)."), "Samsung Galaxy S26");
assert.equal(normalizeBrand("the host"), null); assert.equal(normalizeBrand("x"), null);

// Thumbnail features vs outlier score: faces do 2x better here
const items = [...Array(4)].map(() => ({ outlier: 2, data: { faces: 1, text_words: 2 } }))
  .concat([...Array(4)].map(() => ({ outlier: 1, data: { faces: 0, text_words: 2 } })));
const face = featureLift(items, THUMB_FEATURES).find((f) => f.label === "Shows a face")!;
assert.equal(face.lift, 2); assert.equal(face.with, 4);
assert.ok(!featureLift(items, THUMB_FEATURES).some((f) => f.label === "Has text")); // no "without" group -> not shown


// Next moves: evidence-backed actions, ranked by impact and effort
const base: MoveInputs = { channelId: "UCx", questions: [], ideas: [], heatmapBest: null, titleFeatures: [], lengths: [], formats: null, topVideos: [],
  rising: [], healthParts: [], superfans: [], critics: [], predictions: [], lastUploadDays: null, typicalGapDays: null };
assert.deepEqual(buildMoves(base), []);
const moves = buildMoves({ ...base,
  questions: [{ id: "q1", text: "Which mic do you use?", translation: null, like_count: 40, video_title: "V" }],
  ideas: [{ title: "Budget phone guide", why: "Many ask", requests: 20, likes: 80 }],
  heatmapBest: { day: "Saturday", block: "6–9 pm", outlier: 1.6, count: 5 },
  titleFeatures: [{ label: "a number", with: 6, without: 9, lift: 1.8 }, { label: "a question", with: 1, without: 9, lift: 3 }],
  predictions: [{ video_id: "v9", title: "New video", age_hours: 20, index: 2.1 }],
  healthParts: [{ key: "consistency", label: "Consistency", score: 30, detail: "uploads in 2 of 8 weeks" }],
  lastUploadDays: 30, typicalGapDays: 7 });
const ids = moves.map((m) => m.id);
assert.ok(ids.includes("answer-questions") && ids.includes("make-requested") && ids.includes("push-v9") && ids.includes("timing"));
assert.ok(ids.includes("title-a number") && !ids.includes("title-a question"), "needs 3+ videos with the pattern");
assert.ok(ids.includes("cadence") && ids.includes("health-consistency"));
assert.equal(moves[0].impact, 3, "highest impact first");
assert.ok(moves.every((m) => m.evidence.length > 0 && m.href.startsWith("/")));
assert.ok(moves.find((m) => m.id === "answer-questions")!.evidence[0].includes("40 likes"));
assert.equal(buildMoves({ ...base, questions: moves.length ? [{ id: "q", text: "?", translation: null, like_count: 1, video_title: "" }] : [] }, 8)[0].impact, 2);

// Packaging Lab: titles are scored against this channel's own winners
const tctx = { features: [{ label: "Has a number", with: 6, without: 8, lift: 1.8 }, { label: "Has an emoji", with: 5, without: 9, lift: 0.6 }],
  words: [{ word: "budget", count: 4, outlier: 2.4 }, { word: "vlog", count: 5, outlier: 0.5 }], demand: ["camera", "battery"] };
const pkStrong = scoreTitle("5 budget phones with the best camera in 2026", tctx);
const pkWeak = scoreTitle("my vlog 😀", tctx);
assert.ok(pkStrong.score > pkWeak.score + 20, `${pkStrong.score} vs ${pkWeak.score}`);
assert.ok(pkStrong.good.some((g) => g.includes("budget")) && pkStrong.good.some((g) => g.includes("camera")));
assert.ok(pkWeak.fix.some((f) => f.includes("vlog")) && pkWeak.fix.some((f) => f.includes("emoji")));
assert.ok(scoreTitle("THIS IS ALL CAPS SHOUTING TITLE", tctx).fix.some((f) => f.includes("capitals")));
assert.equal(scoreTitle("", tctx).score, 0);
assert.deepEqual(demandWords(["please make camera test", "camera test video please", "battery life?", "battery backup"]).slice(0, 3).sort(),
  ["battery", "camera", "test"]);

// Competitor breakouts become a move; Instagram wording
const rivalMoves = buildMoves({ ...base, rivalBreakouts: [{ channel: "Rival", id: "rv1", title: "Phone camera shootout", outlier: 3.2 }] });
assert.ok(rivalMoves.some((m) => m.id === "rival-rv1" && m.href.startsWith("/studio?topic=")));
const igMoves = buildMoves({ ...base, platform: "instagram", lastUploadDays: 20, typicalGapDays: 4,
  formats: { shorts: { count: 5, medianOutlier: 3 }, long: { count: 5, medianOutlier: 1 } } });
assert.ok(igMoves.some((m) => m.title === "Time for the next post") && !igMoves.some((m) => m.id === "format"));

// Private analytics (connected channel) become moves
const ownMoves = buildMoves({ ...base, owner: { avgViewPct: 45, ctr: 2.8,
  videos: [{ id: "v1", title: "Leaky video", views: 5000, avgViewPct: 22 }, { id: "v2", title: "Fine video", views: 4000, avgViewPct: 50 }],
  trafficShare: [{ source: "SUBSCRIBER", label: "Subscriptions feed", share: 0.6 }] } });
assert.ok(ownMoves.some((m) => m.id === "retention-v1") && !ownMoves.some((m) => m.id === "retention-v2"));
assert.ok(ownMoves.some((m) => m.id === "ctr" && m.impact === 3) && ownMoves.some((m) => m.id === "reach"));

// Prediction engine what-if (mirror of ytanalytics/model.py features)
{
  const { draftFeatures, estimateDraft } = await import("../lib/whatif.ts");
  const f = draftFeatures({ title: "Top 10 BEST phones?! 🔥 (2026) | Review", short: false, minutes: 12, day: 5, hour: 18 });
  for (const k of ["has_number", "has_question", "has_exclaim", "has_emoji", "has_brackets", "has_caps_word", "has_pipe", "is_weekend"]) assert.equal(f[k], 1, k);
  assert.equal(draftFeatures({ title: "a calm vlog", short: true, minutes: 1, day: 1, hour: 9 }).has_number, 0);
  const m = { features: ["has_number", "is_short"], mean: [0.5, 0.5], scale: [0.5, 0.5], coef: [0.35, 0], intercept: 0, baseline: 10000 };
  const withNum = estimateDraft(m, { title: "5 tips", short: false, minutes: 10, day: 1, hour: 18 });
  const without = estimateDraft(m, { title: "tips", short: false, minutes: 10, day: 1, hour: 18 });
  assert.ok(withNum.multiple > 1 && without.multiple < 1 && withNum.views! > without.views!);
  assert.ok(Math.abs(withNum.multiple / without.multiple - Math.exp(0.7)) < 1e-9);
}
console.log("logic unit tests: all passed");
