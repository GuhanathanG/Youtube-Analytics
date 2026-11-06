// Unit tests for pure logic. Run: node --experimental-strip-types tests/logic.test.ts
import assert from "node:assert/strict";
import { quickLabel } from "../lib/quick-labels.ts";
import { pickGeminiModels } from "../lib/gemini-models.ts";
import { TITLE_FEATURES, durationSeconds, forecastViews, isShort, median, titleWords, weekOf } from "../lib/analytics-math.ts";

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

console.log("logic unit tests: all passed");
