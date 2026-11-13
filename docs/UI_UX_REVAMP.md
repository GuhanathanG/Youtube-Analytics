# Creator Pulse: UI/UX audit and revamp plan

*Audit date: 13 Nov 2026. Method: every page captured on desktop (1440 px, full length) and iPhone 13, using
the test data set, then reviewed against the goal the creator gave: "the user can get everything through visuals."*

---

## 1. Verdict in one paragraph

The product is rich in insight but reads as a **report, not an instrument panel**. Most answers are delivered as
sentences, small numbers and long tables; the visuals that do exist (bar charts, rings) are scattered and the
same size as everything else, so nothing tells the eye where to look first. The navigation has grown to 16
equal items, pages are extremely long (channel page: 7,600 px on desktop, 10,100 px on a phone), and the strong
dark "mission control" style is applied evenly instead of being used to stage a hierarchy. The revamp should
turn each page into **one hero visual that answers its main question in two seconds, a ring of supporting
visuals, and details on demand**, with motion that explains change (growth, comparison, flow) instead of decoration.

---

## 2. Findings (evidence from the screenshots)

### A. Information architecture
| # | Finding | Evidence | Severity |
|---|---|---|---|
| A1 | 16 top-level nav items with equal weight; no grouping | Sidebar: Command … Glance | High |
| A2 | **Bug:** with 16 items, the sidebar's "Watching" channel list collapses to zero height on 900 px-tall screens | `d_home`, `d_command`: "WATCHING" heading, no channels | High |
| A3 | Overlapping pages: Overview vs Command (both "what's happening"), Radar vs Compare vs Outliers (all competitor views), Analytics vs Predict vs Growth (all performance) | Page purposes | Medium |
| A4 | Two channel selectors (top-bar focus vs page pickers on YT-vs-IG/Compare) behave differently | Top bar vs `/platforms` form | Medium |

### B. Visual hierarchy
| # | Finding | Evidence | Severity |
|---|---|---|---|
| B1 | Every panel has the same weight, border and padding, so no page has a focal point | Home: KPI tiles, jobs, channels, chart, feed all equal | High |
| B2 | Key answers are text, not visuals ("too early to tell", "well below usual (0.1×)") | Home "New videos: early performance" | High |
| B3 | KPI tiles are plain numbers with no trend: no sparkline, no delta, no comparison | Home top row, channel top row | High |
| B4 | Long tables dominate: the channel page's video table is ~60% of its height | `d_channels` | High |
| B5 | Empty states are dashed grey boxes of text that take up as much room as content | Channel "Praise vs criticism", "Topic trends" | Medium |
| B6 | Thumbnails are small (≈ 48 px) in tables; the most visual asset a creator has is underused | Video table | Medium |

### C. Data visualisation
| # | Finding | Severity |
|---|---|---|
| C1 | Charts are generic Recharts bars with default sizing; no annotation of the events that explain them (uploads, breakouts, title changes) | High |
| C2 | Sentiment is shown three different ways (bar, chip, percentage), with no single recognisable "mood" glyph | Medium |
| C3 | No time-scrubbing: ranges are tabs and the whole page reloads | Medium |
| C4 | Comparison views (Compare, Radar) are tables; side-by-side mirrored visuals (as on the new YT-vs-IG page) work better | Medium |

### D. Motion
| # | Finding | Severity |
|---|---|---|
| D1 | Motion is limited to a fade-up "Reveal" and count-up numbers; it doesn't encode meaning | Medium |
| D2 | No live sense of "the engine is working" beyond a small pill; new data arrives silently, or via a toast | Medium |
| D3 | Already right: motion respects reduced-motion settings in the newer components; keep that rule everywhere | – |

### E. Mobile
| # | Finding | Severity |
|---|---|---|
| E1 | Home on iPhone shows 4 KPI tiles at a time and nothing else above the fold; the bottom bar covers content | High |
| E2 | Pages are 3–10× the screen height; no in-page section jump | High |
| E3 | Wide tables scroll sideways on phones | Medium |

### F. Content and copy
| # | Finding | Severity |
|---|---|---|
| F1 | Panel subtitles are long explanations; better as a one-line label plus an (i) tooltip | Low |
| F2 | Technical words leak into the UI ("history complete", "deep-read", "estimate based on typical YouTube curve") | Low |

---

## 3. Design principles for the revamp

1. **One question, one hero.** Each page opens with a single large visual that answers its main question (e.g.
   Overview: "Is my audience happier and growing this week?" → a living pulse ring). Everything else is supporting.
2. **Glance → scan → dig.** Hero (2 s), a ring of 3–6 visual cards (10 s), then detail drawers/tables only on demand.
3. **Every number has a shape.** No bare KPI: each gets a sparkline, a delta arrow, or a gauge, plus "vs your normal".
4. **Motion explains change.** Animate *from the previous value to the new one*, draw lines in time order, pulse
   what just changed, flow arrows for "carry across". Never loop decoration behind data.
5. **The same thing always looks the same.** One mood glyph, one "vs normal" multiplier chip, one platform colour
   each (YouTube red, Instagram magenta-orange, rival violet), everywhere.
6. **Fast stays non-negotiable.** Heavy look, light weight: CSS/SVG animation (GPU transforms only), lazy-loaded
   charts, no WebGL by default; a page still has to render under 1 s on the server.
7. **Accessible.** Reduced-motion fallbacks, colour-blind-safe pairs (blue/red sentiment plus icons), contrast
   AA, keyboard focus rings, and every visual carries a text equivalent (aria-label / tooltip).

---

## 4. New information architecture (16 items → 5 hubs)

| Hub | Answers | Contains (today's pages) |
|---|---|---|
| **Pulse** (home) | "What's happening right now and what should I do?" | Command + Overview + Glance, merged: AI brief, health ring, next moves, live feed |
| **Audience** | "Who are they and what do they say?" | Comments, Ask AI, people/superfans, sentiment, languages, emotions |
| **Performance** | "How are my videos doing and why?" | Analytics, Predict, Outliers (mine), Growth (goals + changes) |
| **Market** | "What's working around me?" | Radar, Compare, Outliers (niche), Keywords, YT vs IG |
| **Create** | "What should I make next?" | Studio, Ideas, Packaging Lab |

Settings (Manage) moves to the profile menu. Each hub has **tabs** at the top (sub-pages) instead of separate nav
items, so the sidebar fits on any screen and the Watching list always shows (fixes A2). Mobile bottom bar = the 5 hubs.

---

## 5. Visual language

### Colour (dark "mission control", kept and staged)
- Backgrounds in three depths: void `#05070d` → panel → **raised** (hero cards get a lit gradient and glass blur).
- Accent cyan `#22d3ee` is for **"now / live / you"** only; violet `#8b7cf6` for AI; gold `#fab219` for records/10× breakouts.
- Platforms: YouTube `#ff3b4a`; Instagram gradient `#e1306c → #f77737`; rivals violet.
- Sentiment stays blue / grey / red (colour-blind safe), always paired with an icon.

### Type
- Display numbers get bigger (hero numbers 64–96 px), tabular, with a soft glow for the focal value only.
- Labels: one small-caps style; body copy shorter.

### Signature components (new shared library: `components/viz/`)
| Component | Use | Motion |
|---|---|---|
| **PulseRing** | Health / mood / score (0–100) with an inner sparkline | Arc sweeps to value; heartbeat ripple on new data |
| **KpiOrb** | Number + delta + 14-day sparkline + "vs normal" chip | Count-up from previous value; line draws left→right |
| **MultChip** | "3.2× normal" everywhere | Colour by strength (cyan → violet → gold), glow at ≥5× |
| **Duel** | Mirrored A vs B bar (done on YT vs IG) | Bars grow from the centre; winner glows |
| **HeatGrid** | Day × time performance (done on YT vs IG) | Cells fade in diagonally; hover lifts |
| **Timeline** | Views/comments over time with event pins (upload, breakout, title change, viral comment) | Line draws; pins drop in; scrub handle |
| **MoodGlyph** | One sentiment glyph (donut + emoji face) | Morphs between moods |
| **FlowArrows** | "Carry across", funnels (impressions → clicks → views → subs) | Particles flow along the path |
| **ThumbWall** | Large thumbnails tiled by performance (size = views, glow = multiple) | Masonry fade-in; hover zoom + stats |
| **Constellation** | Topic map: bubbles = topics, size = mentions, colour = sentiment, links = co-mentions | Gentle float; click to focus |
| **SectionNav** | Sticky in-page jump chips for long pages | Active chip slides |
| **Drawer** | Details on demand (tables, comment lists) | Slides in; page behind dims |

### Motion system
- Durations: micro 150 ms, standard 400 ms, hero 900 ms; one easing (`cubic-bezier(.2,.8,.2,1)`).
- Choreography: hero first, then the supporting ring staggered 60 ms, then detail.
- Live updates: changed values flash once and count from the old value; a "new" badge slides into lists.
- Ambient: one slow aurora behind the hero only; nothing else loops.
- `prefers-reduced-motion`: all of the above become instant, with no loss of information.

---

## 6. Page-by-page redesign

| Page (new hub) | Hero (answers in 2 s) | Supporting visuals | Moves to drawers |
|---|---|---|---|
| **Pulse** | PulseRing: health score with mood + growth arcs, and today's AI brief beside it | KpiOrbs (subs, views, comments, sentiment) with sparklines; "Next moves" as icon cards; live comment river | Job progress, alerts history |
| **Channel** | Timeline: views + comments with event pins (uploads, breakouts, title changes) | ThumbWall of recent uploads sized by views; MoodGlyph; Constellation of topics; superfans as avatar orbit | Full video table (today ~60% of the page) |
| **Video** | Early-performance gauge ("3.2× normal at 24 h") with the expected curve band and the real line drawn over it | Comment mood over time; moments heatmap on the video timeline; retention curve (owner) | All comments |
| **Audience → Comments** | Mood river (stacked area by sentiment over time) | Language and emotion rings; question/request counters; search | The comment list as cards with infinite scroll |
| **Performance → Predict** | Forecast cone per new upload (expected band, real line) | Driver bars ("+22% long videos"); accuracy gauge | Model details |
| **Performance → Growth** | Goal rings with predicted-date tick on a timeline | Title-change before/after mini-charts | Change log |
| **Market → Outliers** | ThumbWall of breakouts (size = multiple) | Distribution histogram; "what they share" bars | Filters drawer |
| **Market → Keywords** | Big demand gauge + opportunity gauge | Related-search constellation (size = demand) | Niche uploads list |
| **Market → YT vs IG** | (done) Duel hero | (done) heatmaps, mood, carry-across flow | – |
| **Create → Studio** | Title score meter that reacts as you type | Angle cards; thumbnail brief visual | Saved drafts |
| **Glance** (installable widget) | PulseRing only, full screen | 3 KpiOrbs | – |

Mobile: every hub opens with its hero at full width, a SectionNav strip below, and supporting cards in a
horizontal swipe row; drawers become bottom sheets.

---

## 7. Phased roadmap

| Phase | Scope | Size |
|---|---|---|
| **0. Fixes now** | Sidebar Watching-list bug (A2); empty states shrink to one line; bottom-bar overlap on iPhone | ½ day |
| **1. Foundation** | Tokens update (depths, platform colours), motion tokens, `components/viz/` library: KpiOrb, MultChip, PulseRing, SectionNav, Drawer, MoodGlyph | 2 days |
| **2. Navigation** | 5 hubs with tabs, profile menu for Manage, mobile bottom bar = hubs, redirects from old URLs | 1–2 days |
| **3. Pulse + Channel** | The two most-visited pages rebuilt around their heroes (PulseRing, Timeline with event pins, ThumbWall) | 3 days |
| **4. Audience + Performance** | Mood river, forecast cones, goal timeline, video early-performance gauge | 3 days |
| **5. Market + Create** | Constellations, ThumbWall on Outliers, Studio live meter | 2–3 days |
| **6. Polish** | Live-update choreography, reduced-motion pass, accessibility audit, performance budget check on every page | 1–2 days |

Each phase ships on its own and keeps every existing feature working (the 198 automated checks stay green).

## 8. How we'll know it worked
- A creator can answer "how's my channel doing?" from the first screen without reading a sentence (5-second test).
- Home on iPhone shows the hero, the health score and today's #1 move above the fold.
- No page longer than 3 screen heights before details are opened.
- Server render stays under 1 s per page; animations at 60 fps on a mid-range phone; no layout shift.
