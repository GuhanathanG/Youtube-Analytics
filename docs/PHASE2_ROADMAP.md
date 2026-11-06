# Phase 2: from comment sentiment to a creator command center

**Goal:** one place that tells a creator *what to do next* and why: not 50 charts, but a short list of
actions with the evidence behind each, plus the depth (analytics, audience, ideas, AI) to dig in.

**Why this wins:** the big tools each cover one slice. vidIQ does keywords and AI ideas, TubeBuddy SEO and
A/B tests, ViewStats outliers and thumbnails, and Spotter Studio ideation. Reviews keep repeating one
complaint: they *show data without telling you what action to take*. Creator Pulse already has what they
lack: multilingual comment understanding (Tanglish/Hinglish), audience questions, superfans/critics,
long-term creator memory and Ask AI. Phase 2 turns those into decisions.

## Pillars

| Pillar | What the creator gets | Status |
|---|---|---|
| **Command Center** | Health ring, AI daily brief, ranked *next moves* (each with evidence, impact/effort, one-tap action) | ✅ v1 shipped |
| **Grow** | Outliers, title/thumbnail patterns, best upload slot, format and length sweet spots, forecasts | ✅ analytics exist; feed the moves |
| **Audience** | Questions to answer, requests, superfans/critics, rising topics, languages, mood | ✅ exist; feed the moves |
| **Content Studio** | Idea → angle → title options → thumbnail brief → script outline, built from requests + memory + outliers | Next |
| **Packaging Lab** | Score a draft title/thumbnail against the channel's own winners before publishing | Next |
| **Competitor radar** | Mark channels as competitors: their outliers, topics, upload rhythm, gaps you can own | Next |
| **Connect your channel** (YouTube Analytics API, OAuth) | Private metrics: impressions, click-through rate, retention curves, watch time, traffic sources, revenue → retention-based editing advice | Planned (needs Google verification) |
| **Instagram parity** | Same moves for Instagram accounts (posts, reels, comments) | Partly (data flows; moves next) |
| **Pulse OS UI** | Futuristic glass/neon design system, Glance home-screen app, phone-first | ✅ v1 shipped |

## Milestones

1. **v1 (now):** Command Center + next-moves engine + AI brief; Pulse OS styles across every page.
2. **v2:** Content Studio and Packaging Lab (AI drafts grounded in this channel's own data).
3. **v3:** Competitor radar; moves that compare against competitors.
4. **v4:** "Connect your channel" (OAuth) for private metrics; retention-aware advice.
5. **Always:** every new signal becomes a *move* with evidence, not just another chart.

## Constraints

- Free tiers: YouTube 10,000 units a day (RSS/push for uploads saves quota), free AI limits (the router
  spreads load; rules handle trivial comments), Supabase 500 MB (Neon archive).
- Public data only until channel owners connect with OAuth (private metrics need their consent).
