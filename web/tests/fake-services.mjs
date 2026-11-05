// Stand-in for the YouTube Data API and an OpenAI-compatible AI endpoint (tests only).
import http from "node:http";

const CH = "UC" + "z".repeat(18) + "live";
const state = { videos: [], threads: {} };
const iso = (d) => d.toISOString().replace(/\.\d+Z$/, "Z");
let n = 0;

function addVideo(i, daysAgo) {
  const id = ("livevid" + String(i).padStart(4, "0")).slice(0, 11);
  state.videos.unshift({ id, snippet: { title: `Live Creator video ${i}`, publishedAt: iso(new Date(Date.now() - daysAgo * 864e5)), channelId: CH, thumbnails: {} },
    statistics: { viewCount: "1000", likeCount: "50", commentCount: "0" }, contentDetails: { duration: "PT4M2S" } });
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
for (let j = 0; j < 250; j++) addComment(old, `old comment ${j}`, new Date(Date.now() - (90 - j / 10) * 864e5));
for (let i = 1; i <= 3; i++) {
  const v = addVideo(i, 4 - i);
  ["semma video bro", "audio is bad", "make part 2?", "super explanation", "mokka da"].forEach((t) => addComment(v, t));
}
const channel = { id: CH, snippet: { title: "Live Creator", customUrl: "@livecreator", thumbnails: {} },
  statistics: { subscriberCount: "12345", viewCount: "999999", videoCount: "4" }, contentDetails: { relatedPlaylists: { uploads: "UU" + CH.slice(2) } } };

function page(list, token, size) {
  const start = Number(token || 0);
  return { items: list.slice(start, start + size), nextPageToken: start + size < list.length ? String(start + size) : undefined };
}

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
    if (p.endsWith("/chat/completions")) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        const parsed = JSON.parse(body);
        if (parsed.model === "slow-model") await new Promise((r) => setTimeout(r, 15000)); // never answers in time
        const system = parsed.messages[0].content;
        if (system.includes("audience-research analyst")) {
          return send({ choices: [{ message: { content: JSON.stringify({ summary: "Viewers love the Tanglish banter.", liked: ["host"], complaints: ["audio"], requests: ["part 3"], topics: [{ name: "praise", share_pct: 60, sentiment: "positive" }] }) } }], usage: { total_tokens: 900 } });
        }
        const msg = parsed.messages[1].content;
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
