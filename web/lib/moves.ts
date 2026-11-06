/**
 * Next moves: turn what the platform knows about a channel into a short, ranked list of actions.
 * Pure function (no database), so it can be unit-tested. Each move carries its evidence and a link.
 */
export type Move = {
  id: string;
  kind: "audience" | "content" | "packaging" | "timing" | "growth" | "community" | "fix";
  title: string;
  why: string;
  evidence: string[];
  impact: 1 | 2 | 3;   // 3 = high
  effort: 1 | 2 | 3;   // 1 = quick
  href: string;
  cta: string;
};

export type MoveInputs = {
  channelId: string;
  questions: { id: string; text: string; translation: string | null; like_count: number; video_title: string }[];
  ideas: { title?: string; why?: string; requests?: number; likes?: number }[];
  heatmapBest: { day: string; block: string; outlier: number; count: number } | null;
  titleFeatures: { label: string; with: number; without: number; lift: number | null }[];
  lengths: { label: string; count: number; outlier: number | null }[];
  formats: { shorts: { count: number; medianOutlier: number | null }; long: { count: number; medianOutlier: number | null } } | null;
  topVideos: { id: string; title: string; outlier: number | null; ageDays: number }[];
  rising: { label: string; recent: number; before: number; change: number }[];
  healthParts: { key: string; label: string; score: number; detail: string }[];
  superfans: { author_channel_id: string; author_name: string; comments: number }[];
  critics: { author_channel_id: string; author_name: string; comments: number }[];
  predictions: { video_id: string; title: string; age_hours: number; index: number | null }[];
  lastUploadDays: number | null;
  typicalGapDays: number | null;
  platform?: "youtube" | "instagram";
  rivalBreakouts?: { channel: string; id: string; title: string; outlier: number }[];
  /** Private YouTube Analytics for connected channels. */
  owner?: { avgViewPct: number | null; ctr: number | null; videos: { id: string; title: string; views: number; avgViewPct: number }[];
    trafficShare: { source: string; label: string; share: number }[] } | null;
};

const enc = encodeURIComponent;
const short = (s: string, n = 90) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const x = (v: number) => `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}×`;

export function buildMoves(i: MoveInputs, limit = 8): Move[] {
  const m: Move[] = [];
  const c = enc(i.channelId);
  const ig = i.platform === "instagram";
  const item = ig ? "post" : "video", items = ig ? "posts" : "videos", titles = ig ? "Captions" : "Titles";

  // Audience asks — the most direct signal of what to do next.
  if (i.questions.length) {
    const top = i.questions[0];
    const liked = i.questions.filter((q) => q.like_count >= 10).length;
    m.push({ id: "answer-questions", kind: "audience", title: `Answer ${i.questions.length} open question${i.questions.length === 1 ? "" : "s"}`,
      why: "Questions nobody answered are easy wins: a reply (or a pinned answer) builds loyalty, and repeated ones are ready-made video topics.",
      evidence: [`Most liked: “${short(top.translation || top.text)}” · ${top.like_count} likes`, `${liked} with 10+ likes`],
      impact: top.like_count >= 25 || i.questions.length >= 10 ? 3 : 2, effort: 1, href: "/ideas", cta: "Open questions" });
  }
  const idea = i.ideas[0];
  if (idea?.title) {
    m.push({ id: "make-requested", kind: "content", title: `Make: ${short(idea.title, 70)}`,
      why: idea.why ? short(idea.why, 160) : "Your viewers keep asking for this.",
      evidence: [`${idea.requests ?? "?"} viewers asked`, ...(idea.likes ? [`${idea.likes} likes on those requests`] : [])],
      impact: (idea.requests ?? 0) >= 15 ? 3 : 2, effort: 3, href: "/ideas", cta: "See all ideas" });
  }

  // Momentum on recent videos.
  const hot = i.predictions.filter((p) => p.index !== null && p.index >= 1.5 && p.age_hours <= 72).sort((a, b) => (b.index ?? 0) - (a.index ?? 0))[0];
  if (hot) m.push({ id: `push-${hot.video_id}`, kind: "growth", title: `Push “${short(hot.title, 50)}” now`,
    why: ig ? "It's beating its usual reach. Share it to your story and reply to its comments while it's rising."
      : "It's beating its expected views. Share it while it's rising: community post, a Shorts clip, a pinned comment.",
    evidence: [`${x(hot.index!)} the usual pace at ${Math.round(hot.age_hours)} h`], impact: 3, effort: 1, href: `/videos/${enc(hot.video_id)}`, cta: "Open video" });
  const cold = i.predictions.filter((p) => p.index !== null && p.index <= 0.6 && p.age_hours >= 12 && p.age_hours <= 96).sort((a, b) => (a.index ?? 0) - (b.index ?? 0))[0];
  if (cold) m.push({ id: `rescue-${cold.video_id}`, kind: "packaging", title: `Rescue “${short(cold.title, 50)}”`,
    why: ig ? "It's well below its usual reach. Share it to your story or pin a comment that invites replies."
      : "It's well below its expected views. A clearer title or a new thumbnail in the first days often turns it around.",
    evidence: [`${x(cold.index!)} the usual pace at ${Math.round(cold.age_hours)} h`], impact: 2, effort: 1, href: `/videos/${enc(cold.video_id)}`, cta: "Open video" });

  // Packaging and format patterns.
  const lift = i.titleFeatures.filter((f) => f.lift !== null && f.lift >= 1.25 && f.with >= 3 && f.without >= 3).sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0))[0];
  if (lift) m.push({ id: `title-${lift.label}`, kind: "packaging", title: `${titles}: use “${lift.label}”`,
    why: `On this account, ${titles.toLowerCase()} with this pattern clearly out-perform the rest.`,
    evidence: [`${x(lift.lift!)} views vs ${titles.toLowerCase()} without it`, `${lift.with} videos with it`], impact: 2, effort: 1, href: `/analytics?c=${c}`, cta: "Title analysis" });
  const breakout = i.topVideos.find((v) => (v.outlier ?? 0) >= 2.5 && v.ageDays <= 120);
  if (breakout) m.push({ id: `repeat-${breakout.id}`, kind: "content", title: `Follow up “${short(breakout.title, 50)}”`,
    why: "A breakout shows demand. A sequel, part 2 or a related angle usually rides the same interest.",
    evidence: [`${x(breakout.outlier!)} the channel's usual views`], impact: 3, effort: 3, href: `/videos/${enc(breakout.id)}`, cta: "See what worked" });
  if (!ig && i.formats && i.formats.shorts.count >= 3 && i.formats.long.count >= 3 && i.formats.shorts.medianOutlier && i.formats.long.medianOutlier) {
    const s = i.formats.shorts.medianOutlier, l = i.formats.long.medianOutlier;
    if (s / l >= 1.4 || l / s >= 1.4) {
      const better = s > l ? "Shorts" : "long videos";
      m.push({ id: "format", kind: "content", title: `Lean into ${better}`,
        why: `${better[0].toUpperCase() + better.slice(1)} do noticeably better against this channel's own baseline.`,
        evidence: [`Shorts ${x(s)} vs long ${x(l)} typical views`], impact: 2, effort: 2, href: `/analytics?c=${c}`, cta: "Compare formats" });
    }
  }
  const len = i.lengths.filter((l) => l.count >= 3 && l.outlier !== null).sort((a, b) => (b.outlier ?? 0) - (a.outlier ?? 0))[0];
  if (len && (len.outlier ?? 0) >= 1.3) m.push({ id: "length", kind: "content", title: `Sweet spot: ${len.label}`,
    why: `${ig ? "Reels" : "Videos"} of this length do best for this audience.`, evidence: [`${x(len.outlier!)} typical views across ${len.count} ${items}`],
    impact: 1, effort: 2, href: `/analytics?c=${c}`, cta: "Length analysis" });

  // Timing.
  if (i.heatmapBest && i.heatmapBest.outlier >= 1.15 && i.heatmapBest.count >= 3) {
    m.push({ id: "timing", kind: "timing", title: `Publish ${i.heatmapBest.day}, ${i.heatmapBest.block}`,
      why: "Uploads in this slot get more views than the channel's usual.",
      evidence: [`${x(i.heatmapBest.outlier)} views across ${i.heatmapBest.count} uploads`], impact: 2, effort: 1, href: `/analytics?c=${c}`, cta: "Upload heatmap" });
  }
  if (i.lastUploadDays !== null && i.typicalGapDays !== null && i.typicalGapDays > 0 && i.lastUploadDays > Math.max(3, i.typicalGapDays * 1.6)) {
    m.push({ id: "cadence", kind: "fix", title: `Time for the next ${item}`,
      why: `It's been longer than usual since the last ${item}; posting regularly keeps the audience coming back.`,
      evidence: [`${Math.round(i.lastUploadDays)} days since the last ${item}`, `usual gap: ${Math.round(i.typicalGapDays)} days`], impact: 2, effort: 3, href: `/channels/${c}`, cta: "Channel" });
  }

  // Conversation trends.
  const rise = i.rising.find((r) => r.change >= 50 && r.recent >= 10);
  if (rise) m.push({ id: `rising-${rise.label}`, kind: "audience", title: `Rising topic: ${rise.label}`,
    why: "Viewers are talking about this a lot more lately: address it in a video, a pinned comment or a community post.",
    evidence: [`+${Math.round(rise.change)}% mentions (${rise.recent} vs ${rise.before})`], impact: 2, effort: 2, href: `/channels/${c}`, cta: "Topic trends" });

  // Weakest part of channel health.
  const weak = [...i.healthParts].sort((a, b) => a.score - b.score)[0];
  if (weak && weak.score < 45) {
    const tip: Record<string, string> = {
      consistency: "Plan a steady schedule (even one video a week) — gaps cost returning viewers.",
      engagement: "Ask one specific question in each video and pin it as the first comment.",
      mood: "Read the critical comments' themes and address the top complaint directly.",
      momentum: "Recent videos are below the usual: revisit the formats and titles that worked before.",
      loyalty: "Reply to regular commenters and reference them in videos to turn viewers into a community.",
      growth: "Collaborate or cross-post Shorts to reach new viewers.",
    };
    m.push({ id: `health-${weak.key}`, kind: "fix", title: `Improve ${weak.label.toLowerCase()}`,
      why: tip[weak.key] ?? "This is the weakest part of the channel's health score.", evidence: [`${weak.label}: ${Math.round(weak.score)}/100 · ${weak.detail}`],
      impact: 2, effort: 2, href: `/analytics?c=${c}`, cta: "Health score" });
  }

  // Competitors: a breakout on a rival channel shows demand you can meet with your own angle.
  const rival = (i.rivalBreakouts ?? []).find((b) => b.outlier >= 2.5);
  if (rival) m.push({ id: `rival-${rival.id}`, kind: "content", title: `Your take on “${short(rival.title, 48)}”`,
    why: `${rival.channel}'s ${item} took off. A fresh angle on the same topic usually finds the same demand.`,
    evidence: [`${x(rival.outlier)} ${rival.channel}'s usual views`], impact: 2, effort: 3,
    href: `/studio?topic=${enc(rival.title)}`, cta: "Plan it in Studio" });

  // Private analytics (connected channels).
  if (i.owner) {
    const o = i.owner;
    const avg = o.avgViewPct;
    const leaky = avg ? o.videos.filter((v) => v.views >= 100 && v.avgViewPct < avg * 0.75).sort((a, b) => b.views - a.views)[0] : undefined;
    if (leaky && avg) m.push({ id: `retention-${leaky.id}`, kind: "fix", title: `Fix the opening of “${short(leaky.title, 46)}”`,
      why: "Viewers leave this one much sooner than your other videos. Tighten the first 30 seconds and cut slow parts; the same edit helps future videos.",
      evidence: [`${leaky.avgViewPct.toFixed(0)}% watched vs ${avg.toFixed(0)}% channel average`, `${leaky.views.toLocaleString("en")} views in 28 days`],
      impact: 2, effort: 2, href: `/videos/${enc(leaky.id)}`, cta: "Open video" });
    if (o.ctr !== null && o.ctr < 4) m.push({ id: "ctr", kind: "packaging", title: `Lift click-through (${o.ctr.toFixed(1)}%)`,
      why: "Fewer people click than usual for YouTube. Clearer thumbnails (one subject, 3–4 words, strong emotion) and sharper titles move this fastest.",
      evidence: [`${o.ctr.toFixed(1)}% of impressions became views (last 28 days)`], impact: 3, effort: 1, href: "/studio?tab=lab", cta: "Packaging Lab" });
    const subs = o.trafficShare.find((t) => t.source === "SUBSCRIBER");
    if (subs && subs.share >= 0.45) m.push({ id: "reach", kind: "growth", title: "Reach beyond your subscribers",
      why: "Most views come from people who already subscribe. Topics with search demand and packaging made for Home and Suggested bring new viewers.",
      evidence: [`${Math.round(subs.share * 100)}% of views from the subscriptions feed`], impact: 2, effort: 2, href: "/radar", cta: "See topic gaps" });
  }

  // Community.
  if (i.superfans.length >= 3) m.push({ id: "superfans", kind: "community", title: `Thank your top ${Math.min(5, i.superfans.length)} superfans`,
    why: "A reply or shout-out to the most loyal commenters strengthens the core community.",
    evidence: [`${i.superfans[0].author_name}: ${i.superfans[0].comments} warm comments`], impact: 1, effort: 1,
    href: `/people/${enc(i.superfans[0].author_channel_id)}?c=${c}`, cta: "See superfans" });
  const critic = i.critics.find((p) => p.comments >= 3);
  if (critic) m.push({ id: "critics", kind: "community", title: "Win back a regular critic",
    why: "Repeat critics are engaged viewers; their point often reflects what quieter viewers think.",
    evidence: [`${critic.author_name}: ${critic.comments} critical comments`], impact: 1, effort: 1,
    href: `/people/${enc(critic.author_channel_id)}?c=${c}`, cta: "Read their comments" });

  const score = (mv: Move) => mv.impact * 3 - mv.effort + (mv.kind === "growth" ? 1 : 0);
  return m.sort((a, b) => score(b) - score(a)).slice(0, limit);
}
