# Readable charts (Signal)

Every chart now has its numbers on it: labelled axes, dates, a legend with totals, a hover read-out, and (for anything
over time) a timeline slider to pick the period.

## The time-chart engine: `web/components/signal/SigChart.tsx`
Used by every chart over time.

| Part | What it does |
|---|---|
| Value axis | Round tick values printed on the left, with a name (e.g. "Comments / day"); a second axis on the right when two measures share a chart. |
| Date axis | Dates under the chart, spaced to the width (day, week or month). |
| Legend | Each colour's name and its **total for the chosen period** (or average, or latest value and change). Click a key to hide or show it. |
| Hover / tap read-out | The date (or "Week of …"), every value, each mood's share and the total. Event markers for that week are listed too. |
| Chart-type switch | **Bars / Area / Lines** where it makes sense. |
| Timeline slider (`TimeBrush.tsx`) | A mini preview of the whole period with two handles. Drag either end, or drag the window to slide it. Quick buttons for 7 / 30 / 90 days (4 / 12 / 26 weeks, 3 / 6 / 12 months) and All. The chosen dates are printed. Works with keyboard and touch. |

## What changed, chart by chart
| Where | Before | Now |
|---|---|---|
| Overview, channel, video: conversation volume | Waveform (bars above and below a line, no axis) | Stacked columns per day or week by mood. Count axis, dates, totals, slider. |
| Comments: mood over 90 days | Streamgraph ("mood river") | Stacked columns per day by mood, with a slider. |
| Channel timeline (26 weeks) | Bars and a line without an axis | Views columns on the left axis and a comments line on the right axis. Markers above for breakouts (with the multiple), title changes and shifts. Uploads appear in the read-out. Slider. |
| Channel and video growth | Basic area chart | Area chart with the latest value and change for the period, and a slider. |
| Compare: weekly mood | Line chart | Lines on a −100…+100 axis with each channel's average, gaps for missing weeks, and a slider. |
| Topic mentions per month | Line chart | Lines, bars or area, with totals per topic and a slider. |
| Analytics and Outliers: every upload | Starburst (rays in a circle) | **Scatter plot**: across = publish date, up = views vs usual (log scale, fitted to the data), with "usual" and "breakout 2×" lines, dot size = views, a hover card and a slider. |
| Radar | Radar sweep with blips | **Ranked bars** of typical views (log scale with values), you highlighted, a white line at your level, and ★ for breakouts. |
| Predict: new uploads | Bullseye | **Ranked bars** of expected views vs normal, growing left or right from the 1× line. Expected and current views are listed under each title. |
| Analytics: words in titles | Word cloud | **Ranked bars** vs the channel's usual, with the number of videos. |
| Title / thumbnail styles, prediction drivers | Diverging bars | Same, plus a scale underneath ("← worse · better →" with the percentages at each end). |
| Overview number cells | Unlabelled mini lines | First and last dates, low, high and latest values. |
| Health card, analytics topics | Unlabelled sparklines | Small weekly columns with per-week values on hover, plus the first and latest values printed. |

Screenshots: `docs/design/charts/`.

## Tests
- UI audit (`web/tests/ui-audit.mjs`): 266 checks, now including the slider, hover read-out and chart-type switch, scatter dots linking to videos, and the ranked radar.
  - Final run: 265 pass. The one failure was a console message from YouTube's embedded player ("compute-pressure is not allowed"). It is not from the charts, and that page passed in the two previous runs.
- End-to-end suite (`web/tests/e2e.mjs`): 213 / 213.
- `tsc` and `next build` are clean.
