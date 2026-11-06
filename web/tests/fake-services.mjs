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
    if (p.endsWith("/channels")) return send({ items: (u.searchParams.get("forHandle") === "@livecreator" || u.searchParams.get("id") === CH) ? [channel] : [] });
    if (p.endsWith("/playlistItems")) return send(page(state.videos.map((v) => ({ contentDetails: { videoId: v.id } })), u.searchParams.get("pageToken"), 50));
    if (p.endsWith("/videos")) { const ids = u.searchParams.get("id").split(","); return send({ items: state.videos.filter((v) => ids.includes(v.id)) }); }
    if (p.endsWith("/commentThreads")) return send(page(state.threads[u.searchParams.get("videoId")] || [], u.searchParams.get("pageToken"), 100));
    if (p === "/_add") { const v = state.videos[0].id; ["vera level bro 🔥", "worst editing ever", "when is part 3?"].forEach((t) => addComment(v, t)); return send({ ok: true }); }
    if (p === "/_upload") { const v = addVideo(99, 0); addComment(v, "first!"); return send({ ok: true }); }
    if (p.startsWith("/bot") && p.endsWith("/sendMessage")) {
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", () => { sent.telegram.push(JSON.parse(body)); send({ ok: true }); });
      return;
    }
    if (p.includes("/actions/workflows/sync.yml/runs")) {
      return send({ workflow_runs: [{ status: "completed", conclusion: "success", created_at: new Date().toISOString(), html_url: "https://github.com/x/runs/1", event: "schedule" }] });
    }
    if (p.startsWith("/thumbs/")) { // tiny JPEG-like bytes for thumbnail analysis
      res.writeHead(200, { "Content-Type": "image/jpeg" }); return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    }
    if (p.startsWith("/votes")) return send({ id: u.searchParams.get("videoId"), likes: 50, dislikes: 42, viewCount: 1000 });
    if (p.includes(":generateContent")) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        const img = parsed.contents?.[0]?.parts?.[0]?.inline_data;
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
        if (system.includes("Answer the user's question")) {
          return send({ choices: [{ message: { content: JSON.stringify({ answer: "Viewers complain about the **audio** [1].", used: [1] }) } }], usage: { total_tokens: 200 } });
        }
        if (system.includes("Group them into distinct content ideas")) {
          return send({ choices: [{ message: { content: JSON.stringify({ ideas: [{ title: "Budget phone buying guide", why: "Many ask for it", requests: 25, likes: 80, examples: ["please make part 2"] }] }) } }], usage: { total_tokens: 300 } });
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
