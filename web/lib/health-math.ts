/** Pure scoring for the channel health score (unit-tested). Each part is 0–100; missing data is left out. */

export type HealthInputs = {
  subscriberGrowthPct: number | null; // per 30 days
  likeRate: number | null;            // likes / views (median of recent videos)
  commentRate: number | null;         // comments / views
  mood: number | null;                // average comment sentiment, -1 … +1 (last 30 days)
  loyalShare: number | null;          // commenters who wrote on 3+ videos in 90 days
  weeksWithUploads: number; weeks: number;
  recentOutlier: number | null;       // median outlier score of the last 5 settled videos
};

const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x)));

export function healthScore(i: HealthInputs) {
  const parts: { key: string; label: string; score: number; detail: string }[] = [];
  if (i.subscriberGrowthPct !== null)
    parts.push({ key: "growth", label: "Growth", score: clamp(40 + 12 * i.subscriberGrowthPct), detail: `${i.subscriberGrowthPct >= 0 ? "+" : ""}${i.subscriberGrowthPct.toFixed(1)}% subscribers / 30 days` });
  if (i.likeRate !== null || i.commentRate !== null) {
    const like = i.likeRate !== null ? Math.min(1, i.likeRate / 0.06) : null;      // 6% likes = full marks
    const com = i.commentRate !== null ? Math.min(1, i.commentRate / 0.008) : null; // 0.8% comments = full marks
    const vals = [like, com].filter((x): x is number => x !== null);
    parts.push({ key: "engagement", label: "Engagement", score: clamp((vals.reduce((a, b) => a + b, 0) / vals.length) * 100),
      detail: `${i.likeRate !== null ? (i.likeRate * 100).toFixed(1) + "% likes" : ""}${i.likeRate !== null && i.commentRate !== null ? " · " : ""}${i.commentRate !== null ? (i.commentRate * 100).toFixed(2) + "% comments" : ""}` });
  }
  if (i.mood !== null) parts.push({ key: "mood", label: "Audience mood", score: clamp((i.mood + 1) * 50), detail: `${Math.round(i.mood * 100)} on a −100…+100 scale` });
  if (i.loyalShare !== null) parts.push({ key: "loyalty", label: "Loyalty", score: clamp((i.loyalShare / 0.15) * 100), detail: `${(i.loyalShare * 100).toFixed(0)}% of commenters come back` });
  if (i.weeks > 0) parts.push({ key: "consistency", label: "Consistency", score: clamp((i.weeksWithUploads / i.weeks) * 100), detail: `uploads in ${i.weeksWithUploads} of the last ${i.weeks} weeks` });
  if (i.recentOutlier !== null) parts.push({ key: "momentum", label: "Momentum", score: clamp(50 + 50 * Math.log2(i.recentOutlier)), detail: `latest videos at ${i.recentOutlier.toFixed(1)}× the usual views` });
  const score = parts.length ? clamp(parts.reduce((s, p) => s + p.score, 0) / parts.length) : null;
  const grade = score === null ? "–" : score >= 80 ? "Excellent" : score >= 65 ? "Healthy" : score >= 45 ? "Fair" : "Needs attention";
  return { score, grade, parts };
}

/** Clean up a brand/product name from the AI ("Samsung Galaxy S26 (shown)" -> "Samsung Galaxy S26"). */
export function normalizeBrand(raw: string): string | null {
  const name = raw.replace(/\(.*?\)/g, "").replace(/[.,;:]+\s*$/, "").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 60) return null;
  if (/^(the )?(host|creator|presenter|narrator|viewer|viewers|audience|subscribe|none|n\/a|unknown)$/i.test(name)) return null;
  return name;
}
