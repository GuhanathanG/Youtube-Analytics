// Stand-in for the YouTube Data API and an OpenAI-compatible AI endpoint (tests only).
import http from "node:http";

const CH = "UC" + "z".repeat(18) + "live";
const state = { videos: [], threads: {} };
const iso = (d) => d.toISOString().replace(/\.\d+Z$/, "Z");
let n = 0;

function addVideo(i, daysAgo) {
  const id = ("livevid" + String(i).padStart(4, "0")).slice(0, 11);
  state.videos.unshift({ id, snippet: { title: `Live Creator video ${i}`, publishedAt: iso(new Date(Date.now() - daysAgo * 864e5)), channelId: CH, thumbnails: {},
      tags: ["phones", "review"], categoryId: "28", defaultAudioLanguage: "ta" },
    statistics: { viewCount: "1000", likeCount: "50", commentCount: "0" }, contentDetails: { duration: "PT4M2S", definition: "hd", caption: "false" },
    topicDetails: { topicCategories: ["https://en.wikipedia.org/wiki/Technology"] } });
  state.threads[id] = [];
  return id;
}
function addComment(vid, text, when = new Date()) {
  const id = `${vid}-c${n++}`;
  state.threads[vid].unshift({ id, snippet: { totalReplyCount: 0, topLevelComment: { id, snippet: {
    textOriginal: text, authorDisplayName: "Viewer" + n, likeCount: n % 7, publishedAt: iso(when), updatedAt: iso(when) } } } });
  const v = state.videos.find((x) => x.id === vid);
  v.statistics.commentCount = String(state.threads[vid].length);
}

// An old video with 250 past comments (needs history download), then 3 recent videos with 5 each.
const old = addVideo(0, 90);
for (let j = 0; j < 250; j++) addComment(old, j % 10 === 0 ? `old comment ${j}: please make part ${j} about budget phones` : `old comment ${j}`, new Date(Date.now() - (90 - j / 10) * 864e5));
for (let i = 1; i <= 3; i++) {
  const v = addVideo(i, 4 - i);
  ["semma video bro", "audio is bad", "make part 2?", "super explanation", "mokka da"].forEach((t) => addComment(v, t));
  if (i === 1) ["1:05 best part 😂", "1:12 thalaivar mass", "3:40 audio drops here"].forEach((t) => addComment(v, t));
}
const channel = { id: CH, snippet: { title: "Live Creator", customUrl: "@livecreator", thumbnails: {} },
  statistics: { subscriberCount: "12345", viewCount: "999999", videoCount: "4" }, contentDetails: { relatedPlaylists: { uploads: "UU" + CH.slice(2) } } };

function page(list, token, size) {
  const start = Number(token || 0);
  return { items: list.slice(start, start + size), nextPageToken: start + size < list.length ? String(start + size) : undefined };
}

export const sent = { telegram: [], aiPrompts: [] };

export function startFake(port = 4100) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const send = (o, s = 200) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    const p = u.pathname;
    if (p.endsWith("/channels") && u.searchParams.get("mine") === "true") { // "Connect your channel": who signed in
      return send(req.headers.authorization === "Bearer at-1" ? { items: [{ id: CH, snippet: { title: "Live Creator" } }] } : { error: { message: "bad token" } }, req.headers.authorization === "Bearer at-1" ? 200 : 401);
    }
    if (p === "/token" && req.method === "POST") { // Google OAuth token endpoint
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", () => {
        const f = Object.fromEntries(new URLSearchParams(body));
        if (f.client_secret !== "test-secret") return send({ error: "invalid_client" }, 401);
        if (f.grant_type === "authorization_code" && f.code === "goodcode") return send({ access_token: "at-1", refresh_token: "rt-secret-123", expires_in: 3600 });
        if (f.grant_type === "refresh_token" && f.refresh_token === "rt-secret-123") return send({ access_token: "at-1", expires_in: 3600 });
        return send({ error: "invalid_grant", error_description: "Bad code" }, 400);
      });
      return;
    }
    if (p === "/yta/v2/reports") { // YouTube Analytics API
      if (req.headers.authorization !== "Bearer at-1") return send({ error: { message: "unauthorized" } }, 401);
      const dim = u.searchParams.get("dimensions"), metrics = u.searchParams.get("metrics");
      const h = (names) => names.map((name) => ({ name }));
      if (metrics.includes("videoThumbnailImpressions")) return send({ columnHeaders: h(["day", "videoThumbnailImpressions", "videoThumbnailImpressionsClickRate"]),
        rows: [["2026-01-01", 40000, 2.5], ["2026-01-02", 60000, 2.9]] });
      if (dim === "video") return send({ columnHeaders: h(["video", "views", "estimatedMinutesWatched", "averageViewDuration", "averageViewPercentage", "subscribersGained"]),
        rows: [["livevid0001", 5000, 9000, 70, 18.5, 40], ["livevid0002", 3000, 8000, 150, 52, 30]] });
      if (dim === "day") return send({ columnHeaders: h(["day", "views", "estimatedMinutesWatched", "subscribersGained"]), rows: [["2026-01-01", 4000, 9000, 50], ["2026-01-02", 4000, 8000, 60]] });
      if (dim === "insightTrafficSourceType") return send({ columnHeaders: h(["insightTrafficSourceType", "views"]), rows: [["SUBSCRIBER", 6000], ["YT_SEARCH", 2000]] });
      return send({ columnHeaders: h(["views", "estimatedMinutesWatched", "averageViewDuration", "averageViewPercentage", "subscribersGained", "subscribersLost"]),
        rows: [[8000, 17000, 128, 41.2, 120, 10]] });
    }
    if (p.endsWith("/channels")) return send({ items: (u.searchParams.get("forHandle") === "@livecreator" || u.searchParams.get("id") === CH) ? [channel] : [] });
    if (p === "/feeds/videos.xml") { // free RSS feed of a channel's newest uploads
      if (state.rssDown) { res.writeHead(500); return res.end(); }
      const cid = u.searchParams.get("channel_id");
      const entries = cid === CH ? state.videos.slice(0, 15).map((v) => `<entry><yt:videoId>${v.id}</yt:videoId><yt:channelId>${CH}</yt:channelId></entry>`).join("") : "";
      res.writeHead(200, { "content-type": "application/atom+xml" });
      return res.end(`<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">${entries}</feed>`);
    }
    if (p === "/subscribe" && req.method === "POST") { // WebSub hub
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", () => { sent.hubSubs = [...(sent.hubSubs ?? []), Object.fromEntries(new URLSearchParams(body))]; res.writeHead(202); res.end(); });
      return;
    }
    if (p === "/_pushvid") { addVideo(77, 0); return send({ ok: true, id: state.videos[0].id }); }
    if (p === "/_rssvid") { const v = addVideo(66, 0); addComment(v, "found by rss"); return send({ ok: true, id: v }); }
    if (p.endsWith("/playlistItems")) sent.playlistCalls = (sent.playlistCalls ?? 0) + 1;
    if (p.endsWith("/playlistItems")) return send(page(state.videos.map((v) => ({ contentDetails: { videoId: v.id } })), u.searchParams.get("pageToken"), 50));
    if (p.endsWith("/videos")) { const ids = u.searchParams.get("id").split(","); sent.ytVideoIds = [...(sent.ytVideoIds ?? []), ...ids]; return send({ items: state.videos.filter((v) => ids.includes(v.id)) }); }
    if (p.endsWith("/commentThreads")) sent.ytThreadIds = [...(sent.ytThreadIds ?? []), u.searchParams.get("videoId")];
    if (p.endsWith("/commentThreads")) return send(page(state.threads[u.searchParams.get("videoId")] || [], u.searchParams.get("pageToken"), 100));
    if (p === "/_add") { const v = state.videos[0].id; ["vera level bro 🔥", "worst editing ever", "when is part 3?"].forEach((t) => addComment(v, t)); return send({ ok: true }); }
    if (p === "/_upload") { const v = addVideo(99, 0); addComment(v, "first!"); return send({ ok: true }); }
    if (p.startsWith("/bot") && p.endsWith("/sendMessage")) {
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", () => { sent.telegram.push(JSON.parse(body)); send({ ok: true }); });
      return;
    }
    if (p.endsWith("/actions/workflows/sync.yml/dispatches") && req.method === "POST") {
      sent.dispatches = (sent.dispatches ?? 0) + 1; res.writeHead(204); return res.end();
    }
    if (p.includes("/actions/workflows/sync.yml/runs")) {
      return send({ workflow_runs: [{ status: "completed", conclusion: "success", created_at: new Date().toISOString(), html_url: "https://github.com/x/runs/1", event: "schedule" }] });
    }
    if (p.startsWith("/push/")) { // stand-in push service (like Google's/Apple's)
      req.on("data", () => {}); req.on("end", () => {
        if (p === "/push/gone") { res.writeHead(410); return res.end(); }
        sent.push = (sent.push ?? 0) + 1; res.writeHead(201); res.end();
      });
      return;
    }
    if (p === "/_golive") { // livevid0003 becomes a live stream with 35 chat messages
      const v = state.videos.find((x) => x.id === "livevid0003");
      v.snippet.liveBroadcastContent = "live";
      v.liveStreamingDetails = { actualStartTime: iso(new Date(Date.now() - 3600e3)), activeLiveChatId: "chat-live-1", concurrentViewers: "1234" };
      state.chatEnded = false;
      return send({ ok: true });
    }
    if (p === "/_endlive") { state.chatEnded = true; return send({ ok: true }); }
    if (p.endsWith("/liveChat/messages")) {
      sent.chatReads = (sent.chatReads ?? 0) + 1;
      if (u.searchParams.get("pageToken") === "chat-page-2") {
        return send({ items: [], nextPageToken: "chat-page-2", pollingIntervalMillis: 5000, ...(state.chatEnded ? { offlineAt: iso(new Date()) } : {}) });
      }
      const texts = ["semma stream anna 🔥", "eppo next video?", "hello from Chennai", "worst audio today 😡", "❤️❤️"];
      const items = Array.from({ length: 35 }, (_, i) => ({ id: `chatmsg${i}`,
        snippet: { type: i === 0 ? "superChatEvent" : "textMessageEvent", publishedAt: iso(new Date(Date.now() - (35 - i) * 60e3)),
          displayMessage: texts[i % texts.length], ...(i === 0 ? { superChatDetails: { amountMicros: "500000000", currency: "INR", userComment: "semma stream anna 🔥" } } : {}) },
        authorDetails: { channelId: `UCchat${i % 7}`, displayName: `Chatter${i % 7}`, isChatSponsor: i % 10 === 0 } }));
      return send({ items, nextPageToken: "chat-page-2", pollingIntervalMillis: 5000 });
    }
    // Apify (Instagram scraper): runs finish at once; results depend on the requested kind.
    if (p.startsWith("/v2/acts/") && p.endsWith("/runs") && req.method === "POST") {
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", () => {
        const input = JSON.parse(body);
        const id = `run${(sent.igRuns = (sent.igRuns ?? 0) + 1)}`;
        state.igRuns = { ...(state.igRuns ?? {}), [id]: input };
        sent.igCaps = [...(sent.igCaps ?? []), { maxItems: u.searchParams.get("maxItems"), maxTotalChargeUsd: u.searchParams.get("maxTotalChargeUsd") }];
        send({ data: { id, status: "RUNNING", defaultDatasetId: `ds-${id}` } }, 201);
      });
      return;
    }
    if (p.startsWith("/v2/actor-runs/")) {
      const id = p.split("/").pop();
      return send({ data: { id, status: "SUCCEEDED", defaultDatasetId: `ds-${id}`, usageTotalUsd: 0.004 } });
    }
    if (p.startsWith("/v2/datasets/ds-")) {
      const input = state.igRuns?.[p.split("/")[3].slice(3)] ?? {};
      const at = (h) => new Date(Date.now() - h * 3600e3).toISOString();
      const post = (code, h, comments, caption) => ({ id: `9${code}`, shortCode: code, type: "Image", caption, displayUrl: `http://localhost:4100/thumbs/${code}.jpg`,
        timestamp: at(h), likesCount: 120, commentsCount: comments, ownerUsername: "pulsecreator", hashtags: ["phones"] });
      const posts = [{ ...post("IGPOST0001", 5, 3, "New phone unboxing 📱\nmore soon"), type: "Video", productType: "clips", videoDuration: 42,
          videoPlayCount: 9000, videoUrl: "http://localhost:4100/media/IGPOST0001.mp4" }, post("IGPOST0002", 30, 0, "Weekend vlog"), post("IGPOST0003", 400, 2, "Old review")];
      if (input.resultsType === "details") {
        if (String(input.directUrls?.[0]).includes("nobody_here")) return send([{ error: "not_found", errorDescription: "Profile does not exist" }]);
        return send([{ id: "777", username: "pulsecreator", fullName: "Pulse Creator", biography: "Tech in Tamil", followersCount: 5000,
          followsCount: 10, postsCount: 3, profilePicUrl: "http://localhost:4100/thumbs/pic.jpg", latestPosts: posts.slice(0, 2) }]);
      }
      if (input.resultsType === "posts") return send(String(input.directUrls?.[0]).includes("nobody_here") ? [{ error: "not_found" }] : posts);
      if (input.resultsType === "comments") {
        const out = [];
        for (const url of input.directUrls ?? []) {
          const code = url.match(/\/p\/([^/]+)/)[1];
          const texts = code === "IGPOST0001" ? ["semma phone anna 🔥", "price enna?", "worst camera"] : ["nice review", "battery?"];
          texts.forEach((t, i) => out.push({ id: `${code}c${i}`, postUrl: url, text: t, ownerUsername: `fan${i}`, owner: { id: `55${i}`, username: `fan${i}` },
            likesCount: i, repliesCount: i === 0 ? 1 : 0, timestamp: at(2),
            replies: i === 0 ? [{ id: `${code}r0`, text: "thanks da!", ownerUsername: "pulsecreator", owner: { id: "777" }, timestamp: at(1) }] : [] }));
        }
        return send(out);
      }
      return send([]);
    }
    if (p.startsWith("/thumbs/")) { // tiny JPEG-like bytes for thumbnail analysis
      res.writeHead(200, { "Content-Type": "image/jpeg" }); return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    }
    if (p.startsWith("/media/")) { // a reel's video file (a few bytes are enough for the stand-in AI)
      sent.reelDownloads = (sent.reelDownloads ?? 0) + 1;
      res.writeHead(200, { "Content-Type": "video/mp4" }); return res.end(Buffer.from("fake-mp4-bytes"));
    }
    if (p.startsWith("/votes")) return send({ id: u.searchParams.get("videoId"), likes: 50, dislikes: 42, viewCount: 1000 });
    if (p.includes(":generateContent")) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        const img = parsed.contents?.[0]?.parts?.[0]?.inline_data;
        if (img && String(img.mime_type).startsWith("video/")) { // a reel handed over as a file
          sent.reels = (sent.reels ?? 0) + 1;
          const reel = { summary: "A quick reel unboxing a new phone with a punchy reveal.", format: "reel", languages: ["Tamil"], tone: "playful",
            hook: { first_30s: "Phone flips into frame in the first second", strength: "strong", why: "Instant visual payoff" },
            chapters: [{ start: "0:00", title: "Reveal", summary: "Phone appears" }], key_moments: [{ time: "0:12", what: "Camera zoom test", why: "Wow moment" }],
            topics: ["phone unboxing"], people_brands_products: ["PhoneX"], sponsor_segments: [], calls_to_action: ["comment PRICE for the link"],
            production: { editing: "fast", audio: "trending sound", visuals: "bright" }, title_thumbnail_promise: "Delivers",
            strengths: ["fast hook"], weaknesses: ["no captions"], audience_fit: "phone fans" };
          return send({ candidates: [{ content: { parts: [{ text: JSON.stringify(reel) }] } }], usageMetadata: { totalTokenCount: 4000 } });
        }
        if (img) { // thumbnail analysis
          sent.thumbnails = (sent.thumbnails ?? 0) + 1;
          const thumb = { faces: 1, face_emotion: "surprised", text: "BEST PHONE?", text_words: 2, main_colors: ["yellow", "black"],
            brightness: "bright", contrast: "high", subject: "man holding a phone", elements: ["arrow"], style: "reaction with big text",
            readability: "good", clickbait: 6 };
          return send({ candidates: [{ content: { parts: [{ text: JSON.stringify(thumb) }] } }], usageMetadata: { totalTokenCount: 300 } });
        }
        const uri = parsed.contents?.[0]?.parts?.[0]?.file_data?.file_uri ?? "";
        if (!uri.includes("youtube.com/watch")) return send({ error: { message: "no video" } }, 400);
        const analysis = { summary: "A hands-on review of a budget phone, comparing camera and battery.", format: "review", languages: ["Tamil", "English"],
          tone: "energetic", hook: { first_30s: "Unboxing with a joke", strength: "strong", why: "Gets to the point fast" },
          chapters: [{ start: "0:00", title: "Unboxing", summary: "Opens the box" }, { start: "1:00", title: "Camera test", summary: "Day and night photos" }],
          key_moments: [{ time: "1:05", what: "Night photo reveal", why: "Big surprise" }], topics: ["budget phones"], people_brands_products: ["PhoneX"],
          sponsor_segments: [], calls_to_action: ["subscribe at 0:45"], production: { editing: "fast cuts", audio: "dips at 3:40", visuals: "bright" },
          title_thumbnail_promise: "Delivers", strengths: ["clear comparisons"], weaknesses: ["audio dip"], audience_fit: "budget buyers" };
        send({ candidates: [{ content: { parts: [{ text: JSON.stringify(analysis) }] } }], usageMetadata: { totalTokenCount: 25000 } });
      });
      return;
    }
    if (p.endsWith("/chat/completions")) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        const parsed = JSON.parse(body);
        if (parsed.model === "slow-model") await new Promise((r) => setTimeout(r, 15000)); // never answers in time
        const system = parsed.messages[0].content;
        if (system.includes("database search terms")) {
          return send({ choices: [{ message: { content: JSON.stringify({ terms: ["audio", "sound"] }) } }], usage: { total_tokens: 50 } });
        }
        if (system.includes("monthly memory")) {
          return send({ choices: [{ message: { content: JSON.stringify({ summary: "Viewers loved the budget phone review month.", mood: "upbeat",
            liked: ["honest reviews"], complaints: ["audio"], requests: ["part 3"], themes: ["phones"], notable_videos: [], changes: "first month on record" }) } }], usage: { total_tokens: 700 } });
        }
        if (system.includes("long-term profile")) {
          return send({ choices: [{ message: { content: JSON.stringify({ one_line: "A Tamil tech reviewer with a loyal budget-phone audience.",
            creator: "Honest phone reviews", audience: "Tamil-speaking students", strengths: ["honesty"], weaknesses: ["audio"],
            recurring_requests: ["part 3"], recurring_complaints: ["audio"], evolution: "Steady growth since launch", key_moments: [], opportunities: ["fix audio"] }) } }], usage: { total_tokens: 900 } });
        }
        if (system.includes("strategist and scriptwriter")) {
          sent.studioPrompts = [...(sent.studioPrompts ?? []), parsed.messages[1].content];
          return send({ choices: [{ message: { content: JSON.stringify({ angles: [{ name: "Night test", pitch: "Shoot every phone at night" }, { name: "Budget king", pitch: "Best value wins" }, { name: "Real life", pitch: "A week of daily use" }],
            titles: ["5 budget phones tested at night: which camera wins?", "my vlog", "Best camera phone under 20K (real test)"],
            thumbnail: { concept: "Three phones held up against city lights", text: "WHICH WINS?", emotion: "surprised", colors: ["cyan", "black"] },
            hook: "I spent a week shooting with five cheap phones, and one of them embarrassed a flagship.",
            outline: [{ part: "Hook", notes: "The surprise result" }, { part: "Day tests", notes: "Daylight photos" }, { part: "Night tests", notes: "The big difference" }],
            tags: ["budget phone", "camera test"], cta: "Watch the battery test next", why: "Viewers keep asking for camera tests." }) } }], usage: { total_tokens: 900 } });
        }
        if (system.includes("You improve YouTube titles")) {
          return send({ choices: [{ message: { content: JSON.stringify({ titles: ["I tested 5 budget phones at night", "Budget camera phones: night test"] }) } }], usage: { total_tokens: 100 } });
        }
        if (system.includes("growth strategist")) {
          return send({ choices: [{ message: { content: JSON.stringify({ headline: "Answer the mic question today", brief: "Viewers keep asking about your mic. Reply, then make the budget phone guide.", focus: "audience" }) } }], usage: { total_tokens: 200 } });
        }
        if (system.includes("Answer the user's question")) {
          sent.askPrompts = [...(sent.askPrompts ?? []), parsed.messages[1].content];
          return send({ choices: [{ message: { content: JSON.stringify({ answer: "Viewers complain about the **audio** [1].", used: [1] }) } }], usage: { total_tokens: 200 } });
        }
        if (system.includes("Group them into distinct content ideas")) {
          return send({ choices: [{ message: { content: JSON.stringify({ ideas: [{ title: "Budget phone buying guide", why: "Many ask for it", requests: 25, likes: 80, examples: ["please make part 2"] }] }) } }], usage: { total_tokens: 300 } });
        }
        if (system.includes("live stream's chat")) {
          return send({ choices: [{ message: { content: JSON.stringify({ summary: "Chat loved the stream but complained about audio.", highlights: ["Super Chat from a fan"], requests: ["next video date"], mood: "mixed" }) } }], usage: { total_tokens: 400 } });
        }
        if (system.includes("audience-research analyst")) {
          return send({ choices: [{ message: { content: JSON.stringify({ summary: "Viewers love the Tanglish banter.", liked: ["host"], complaints: ["audio"], requests: ["part 3"], topics: [{ name: "praise", share_pct: 60, sentiment: "positive" }] }) } }], usage: { total_tokens: 900 } });
        }
        const msg = parsed.messages[1].content;
        sent.aiPrompts.push(msg);
        const results = msg.split("\n").filter((l) => /^\d+\. \[V/.test(l)).map((l) => {
          const i = Number(l.split(".")[0]); const t = l.toLowerCase(); const neg = /bad|worst|mokka/.test(t);
          return { i, sentiment: neg ? "negative" : "positive", score: neg ? -0.8 : 0.85, emotion: neg ? "disappointment" : "excitement",
            question: t.includes("?"), suggestion: t.includes("part"), spam: false, toxic: false,
            aspects: t.includes("audio") ? [{ a: "audio", s: "neg" }] : [], lang: /semma|mokka|vera/.test(t) ? "ta-Latn" : "en",
            en: /semma|mokka|vera/.test(t) ? "(translated)" : "" };
        });
        send({ choices: [{ message: { content: JSON.stringify({ results }) } }], usage: { total_tokens: 500 } });
      });
      return;
    }
    send({ error: { message: "not found", errors: [{ reason: "notFound" }] } }, 404);
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}
