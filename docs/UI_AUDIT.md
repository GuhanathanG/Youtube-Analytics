# UI rebuild audit (Signal design)

Date: 2026-11-19. Scope: every page of the rebuilt site, on desktop (1440×900) and iPhone 13, plus the interactive pieces.

## Result

| Check | Result |
|---|---|
| UI audit (`web/tests/ui-audit.mjs`): 31 pages × 2 devices + 17 interactions | **265 / 265 pass** |
| End-to-end suite (`web/tests/e2e.mjs`) | **213 / 213 pass** |
| Web unit tests (db-url, security, logic, ig-sources) | pass |
| Python worker tests | 78 passed, 6 skipped |
| `tsc --noEmit`, `next build` | clean |

The audit ran against the test database the e2e suite fills (channels, Instagram, a competitor, comments, AI chats,
forecasts, goals, title changes), so every section had data to draw.

### What each page was checked for
- **Loads**: HTTP 200 and no "This page didn't load" error state (the unknown channel shows "Signal lost").
- **No errors**: no JavaScript errors and no console errors.
- **Layout**: nothing wider than the screen (no sideways scrolling) on desktop or phone.
- **Accessibility basics**:
  - every page has a heading;
  - every image has alt text;
  - every button and link has a name;
  - nothing is left invisible by an entrance animation after scrolling through.

### Interactions checked
| | |
|---|---|
| Top bar | hub menu opens on hover and its links work · channel menu switches the whole site's channel and back · ⌘K search finds a channel · account menu (phone: search + sign out) · phone bottom bar moves between hubs |
| Overview | range tabs change the waveform's range |
| Comments | every particle-field lens (mood, language, emotion, channel, time) rearranges without errors · typing in search filters the list |
| Ask AI | a saved conversation shows its answers and the citation constellation |
| Analytics | channel pills switch channel · starburst rays link to the videos |
| Predict | the draft tester returns an estimate |
| Growth | adding a goal shows it; removing it removes it |
| Radar | the sweep draws competitor blips (and breakout pings) |
| Motion | with "reduce motion" on, all content is visible at once |
| Sign-in | wrong password shows the message and the magenta pulse · signing out clears the session and the saved pages |

## Bugs found and fixed during the audit
1. **Signing out left private pages saved on the device.**
   - **What happened:** the app keeps copies of pages so it opens instantly (iPhone home-screen app). Signing out is an in-app move to the sign-in page, and the clean-up only ran on a full page load, so the copies stayed. On a shared or lost phone, the last pages could briefly show before the app sent you to sign in.
   - **Fix:** the copies are now deleted whenever the sign-in page is reached, and the Sign out button also clears them.
2. **The Predict draft tester never ran (older bug, not from the rebuild).**
   - **What happened:** the Minutes field had `min=0.2` with `step=0.5`, so the browser only accepted 0.2, 0.7, 1.2 and so on. The default of 12 was "invalid", and the browser silently refused to submit.
   - **Fix:** the field now accepts any value.

## Accepted / known limitations
- **Unknown channel or video address:** the "Signal lost" page is shown, but the HTTP status is 200 rather than 404. The page starts streaming (loading skeleton) before it knows the channel is missing. The site is private and not indexed, so nothing depends on the status code.
- **Older chart types:** a few still use the original chart library, recoloured to the Signal palette: growth lines, the praise-vs-criticism chart, Compare's weekly lines and the topic chart. They work, and they can be redrawn as Signal instruments later.
- **No signed-in check of the live site yet:** the production password has changed, so these results come from the local build on test data. Every merge still runs the same e2e suite in CI.

## Rebuilt in this pass (R5–R7)
- **Market:**
  - Radar has a turning sweep with competitors as blips: distance = similarity of typical views, size = uploads, magenta ping = breakout.
  - Outliers has a starburst of every upload in the niche.
  - Keywords, YT vs IG and Compare use the Signal header and palette.
- **Create:** Studio and Ideas use the Signal header and panels.
- **Channel and video pages:**
  - viewfinder frames (camera corner brackets, a blinking REC mark on the player);
  - large wide-font titles;
  - stat cells that decode their numbers;
  - the conversation waveform replacing the old line chart.
- **Manage, report and share:** these follow the same system.
- **Site-wide:**
  - Signal page header everywhere;
  - squared corners;
  - the cyan/magenta palette replacing violet, green and amber;
  - Signal loading skeleton, error page and "Signal lost" 404.

Screenshots: `docs/design/r5-remaining-pages-desktop.png`, `docs/design/r5-radar-desktop.png`.
