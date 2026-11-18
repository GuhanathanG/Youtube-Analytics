# Creator Pulse — UI & UX Rebuild ("Instrument" design)

Goal: every page becomes a set of animated infographics and dashboards with a cinematic, futuristic look,
inspired by the line-art / particle / bloom aesthetic of the reference site (12bitcreatives.com) — but
**no scroll-driven story**. Pages stay normal dashboards; the drama comes from the instruments themselves
and how they assemble, react and stay live.

We take the *language* of the reference (near-black, hairline line art, particles with glow, wide display
type, mono labels, numbered sections, hairline cell grids, tickers), not its content, code, colours or sounds.

---

## 1. What we took from the reference (studied page by page)

| Pattern in the reference | How we use it |
|---|---|
| A glowing dot with bloom | The **Pulse Orb**: the live heartbeat of a channel (beats faster with comments/hour) |
| Thin white line drawings that draw themselves | Every chart is **line art that draws in** on load (stroke draw) |
| Particle fields and bursts | **Comments as particles**; uploads as a **starburst** |
| Waveforms (the "colour" and "edit" scenes) | Conversation volume as a **mirrored waveform**; video moments as an **edit timeline** |
| Wireframe objects (box, board, camera) | Engine pipeline, storage, video "viewfinder" |
| Hairline cell grids with binary indices (`0101`) | KPI grids and lists: every cell numbered in mono |
| Big wide numbers with tiny mono captions (`12 · BITS OF COLOUR`) | Every headline stat |
| `01 / 10 · LABEL` section labels | Every panel header: `03 / 07 · MOOD` |
| Dots down the right edge | A **section index rail** to jump between panels (click, not scroll story) |
| Marquee ticker | Live comment ticker, keyword ticker |
| Grey → accent card ramp | Ranked lists: weakest grey, strongest lit in accent |
| Giant wordmark footer | Big "CreatorPulse" wordmark at the bottom of every page |
| "Sound on" toggle | Optional UI sound, **off by default** |

## 2. Design system

- **Background** `#07070A`, hairlines `rgba(255,255,255,.08)`, text off-white `#EDEDEA`, secondary `#8A8A93`.
- **Accents (proposed, ours):** electric cyan `#22E1FF` (live / positive / primary) and hot magenta `#FF3D7F`
  (alerts / negative / breakout). Mood keeps a 3-colour scale: cyan (positive), grey (neutral), magenta (negative).
  Per-hub tint kept subtle.
- **Type:** wide display face for headlines and big numbers (Syne or Unbounded), Inter Tight for body,
  DM Mono / JetBrains Mono for labels, indices and all small numbers. Tabular numbers everywhere.
- **Layout:** 12-column hairline grid; panels are bordered cells (no soft cards, no heavy gradients);
  generous empty space; one hero instrument per page.
- **Navigation:** slim top bar (logo · 5 hubs · channel switcher · ⌘K · live dot · sound toggle).
  Hub tabs under it. Section index rail on the right (`01 Mood · 02 Topics …`). Channel list moves into ⌘K and
  the channel switcher (sidebar removed: more room for instruments).
- **Panel header:** `03 / 07 · MOOD` in mono + short title in display type + one-line explanation.

## 3. Motion system

- **Assemble on load (≤ 900 ms total):** hairlines draw → labels type in → numbers decode (scramble) then
  count to value → charts draw → particles settle. Staggered by panel, top-left to bottom-right.
- **Live:** new data animates in place (new comment = a particle flies into the field + ticker entry;
  KPI digits roll). Nothing reloads visibly.
- **Hover:** crosshair with mono read-out on every chart; magnetic buttons; cells lift with a hairline glow.
- **Page transitions:** View Transitions API — the panel you clicked expands into the next page.
- **Respect:** `prefers-reduced-motion` → instant, static; low-power phones → canvas instead of WebGL,
  fewer particles, no bloom; animations pause off-screen and in background tabs.
- **Sound (opt-in):** soft tick on hover, tone on a new comment, chime on an alert. Off by default.

## 4. The instrument kit (shared animated components)

| # | Instrument | Looks like | Used for |
|---|---|---|---|
| I1 | **Signal Line** | hairline chart that draws itself, glowing head dot, crosshair read-out | trends, views, subscribers |
| I2 | **Forecast Cone** | Signal Line + dashed future + glowing range cone | Predict, goals, video forecasts |
| I3 | **Particle Field** | thousands of dots (WebGL, canvas fallback) that morph between layouts | comments by mood / language / emotion / topic / time |
| I4 | **Pulse Orb** | glowing dot with bloom, heartbeat = comments/hour, satellites | home hero, Glance, channel hero |
| I5 | **Waveform** | mirrored audio-style bars (positive up, negative down), live scroll | conversation volume, YT vs IG |
| I6 | **Starburst** | radial lines from a centre, length = views multiple | outliers, breakouts, upload spread |
| I7 | **Ring Gauge** | tick ring with sweeping needle and decoded number | health score, opportunity, prediction |
| I8 | **Dot Matrix** | grid of lit cells (LED / 12-bit style) | when uploads do best (day × hour), calendars, job progress |
| I9 | **Cell Grid** | hairline cells with mono index `0101`, big number, mini signal | every KPI row, ranked lists |
| I10 | **Constellation** | nodes + thin links, hover lights a cluster | topics, superfans, shared audience, idea clusters |
| I11 | **Orbit** | concentric ellipses with orbiting bodies | channels around a creator, compare, goals |
| I12 | **Radar Sweep** | rotating sweep, blips that ping | competitor radar |
| I13 | **Duel Axis** | two sides pulling from a centre line | Shorts vs long, YT vs IG, praise vs criticism |
| I14 | **Viewfinder** | camera frame with corner brackets, timecode, rule-of-thirds | video page, thumbnails, Studio |
| I15 | **Edit Timeline** | stacked lanes like an editor (cuts, moments, chat, comments) | video moments, AI watch, hook 0–15 s |
| I16 | **Pipeline** | wireframe nodes with data packets travelling along lines | engine / jobs on Manage |
| I17 | **Ticker** | mono marquee | live comments, keywords, alerts |
| I18 | **Type Cloud** | words in the wide face, weight/size = performance | title words, topic gaps, keywords |

Built with SVG + GSAP (DrawSVG, ScrambleText, SplitText, MotionPath — all free now) for crisp, accessible
instruments; WebGL (three.js / react-three-fiber with mipmap bloom) only for I3 and I4; canvas fallback.

## 5. Page by page

### Pulse hub
**Overview `/`**
- Hero: **Pulse Orb** (I4) in the centre, beating with comments/hour; the 7 watched channels orbit as
  satellites sized by today's activity; headline in the wide face: "975,912 voices."
- KPI **Cell Grid** (I9): comments captured · sentiment · read by AI · videos — digits decode, mini signal lines.
- Conversation volume as a **Waveform** (I5): positive above, negative below, scrub to a day.
- Sentiment mix by channel: stacked hairline bars that fill in sequence.
- Today's #1 move as a "brief" cell with its health **Ring Gauge** (I7).
- Live comment **Ticker** (I17) along the bottom; alerts as blinking cells.

**Next moves `/command`**
- Health score as a large **Ring Gauge** (I7) with tick sweep.
- Moves as numbered mission cells `01 / 08` with impact (Dot Matrix bar) and effort; done moves strike through.
- "Did it work?" column: a mini Signal Line before/after each move (pairs with the Creedom-style feature).

**Glance `/glance`** (phone / home-screen app)
- Full-screen **Pulse Orb**, three decoded numbers, latest comment typing in, alerts as LEDs.

### Audience hub
**Comments `/comments`**
- Hero: **Particle Field** (I3) — every comment a dot (sampled to ~20k). Toggle *Mood · Language · Emotion ·
  Topic · Time* and the dots fly into the new layout. Click a dot → its comment.
- Mood river redrawn as flowing streamlines (I1 variant).
- Comment list as hairline cells with mono metadata; search hits highlighted; filters as pills with live counts.

**Ask AI `/ask`**
- A console: mono prompt with blinking cursor, answer streams in.
- Beside it a small **Constellation** (I10): the comments the answer used light up; click to read them.

**Person `/people/[id]`** (superfan)
- A "dossier": avatar in a **Viewfinder** (I14), activity as a strip of ticks (one per comment),
  channels as an **Orbit**, usual emotions as a radar polygon.

### Performance hub
**Analytics `/analytics`**
- Shorts vs long: **Duel Axis** (I13).
- Breakouts / underperformers: **Starburst** (I6), breakouts glow magenta.
- When uploads do best: 7 × 24 **Dot Matrix** (I8) lighting up.
- Title words: **Type Cloud** (I18). Video length: histogram of hairlines. Thumbnail styles: tilted gallery.

**Predict `/predict`**
- Forecasts as **Forecast Cones** (I2).
- "Where new uploads will land": a bullseye; each prediction lands as a dot.
- "What moves views": tug-of-war bars from a centre line.
- Draft tester: type a title → scanner line passes → result lands on the bullseye with its range.
- Accuracy: calibration dots along a diagonal.

**Growth & goals `/growth`**
- Goals as **Orbit** progress arcs with milestone ticks and a mono countdown to the ETA.
- Title changes as before/after diffs (old title struck through) with the result delta.

### Market hub
**Outliers `/outliers`** — **Starburst** of every upload in the niche; breakouts bloom; "what breakouts share" as a **Constellation**.
**Keywords `/keywords`** — demand as equaliser bars; opportunity **Ring Gauge**; related searches as a radial tree.
**YT vs IG `/platforms`** — split screen on a central axis; mirrored **Waveforms**; head-to-head **Duel Axis** rows.
**Radar `/radar`** — a real **Radar Sweep** (I12): competitors as blips (distance = similarity, size = momentum); breakouts ping; topic gaps as empty sectors.
**Compare `/compare`** — overlaid **Signal Lines**; shared audience as two particle clouds whose overlap glows.

### Create hub
**Studio `/studio`**
- Storyboard look: the outline as wireframe frames; title lab with a scanning score meter per title;
  thumbnail brief inside a **Viewfinder** with a thirds grid; hook 0–15 s as an **Edit Timeline** (I15).

**Ideas `/ideas`** — questions as cells with demand dot-bars; clusters as a **Constellation**; requests ticker.

### Channel & video
**Channel `/channels/[id]`**
- Hero: name in the wide face, avatar in a **Viewfinder**, **Pulse Orb** mood, linked accounts drawn as lines to their icons.
- KPI **Cell Grid**; Timeline as a **Signal Line** with glowing event pins (breakouts, title changes, shifts);
  thumbnail wall as a tilted 3D plane (hover lifts); topics; superfans **Constellation**; growth **Forecast Cone**.

**Video `/videos/[id]`**
- **Viewfinder** hero with timecode; views **Forecast Cone**; "when people commented" **Waveform**;
  moments + AI watch + live chat as an **Edit Timeline**; thumbnail with attention overlay; prediction **Ring Gauge**.

### Account & public
**Manage `/manage`**
- Engine as a **Pipeline** (I16): YouTube / Instagram → engine → AI → database → site, with packets moving;
  freshness as LED status cells; jobs as **Dot Matrix** fills with countdowns; storage as wireframe cylinders.
- Forms with mono labels and hairline fields.

**Login** — one pulsing dot and a single hairline password field; on success the dot bursts and the dashboard assembles.

**Report / Share** — same instruments rendered static (no motion), print-ready.

## 6. Performance & accessibility budget
- First paint stays server-rendered (no blank page while WebGL loads); instruments hydrate as client islands.
- WebGL only for the particle field and orb, loaded on demand; GPU-tier detection; < 8 MB JS per page.
- Every instrument has a text equivalent (table / aria summary); colour is never the only signal.
- Target: 60 fps desktop, 30+ fps on iPhone 13, Lighthouse performance ≥ 85.

## 7. Phases (each its own PR, merged on green CI)
- **R0 Concept** — a live concept of Overview + Comments particle field on real data, to approve the look.
- **R1 Foundation** — tokens, fonts, top-bar shell, ⌘K, section rail, login, motion engine, kit I1 I7 I8 I9 I17.
- **R2 Pulse + Channel** — Overview, Next moves, Glance, Channel page (I4 I5 I10 I11).
- **R3 Audience** — Comments particle field (I3), Ask console, Person dossier.
- **R4 Performance** — Analytics, Predict, Growth (I2 I6 I13 I18).
- **R5 Market** — Outliers, Keywords, YT vs IG, Radar (I12), Compare.
- **R6 Create, Video, Manage** — Studio, Ideas, Video (I14 I15), Manage pipeline (I16), reports.
- **R7 Polish** — sound, iPhone pass, accessibility, speed audit, full e2e.
