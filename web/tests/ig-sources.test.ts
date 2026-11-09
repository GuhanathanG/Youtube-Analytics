// Instagram providers: order, fallback and each provider's answer format (shapes from their API docs).
// Run: node --experimental-strip-types tests/ig-sources.test.ts
import assert from "node:assert/strict";
import { fetchComments, fetchProfile, sourceOrder, type Attempt } from "../lib/ig-sources.ts";

type Reply = { status?: number; body: unknown };
/** A fake network: the first route whose text appears in the URL answers. Records every URL asked. */
function fakeFetch(routes: [string, Reply | ((url: string, init?: RequestInit) => Reply)][]) {
  const asked: { url: string; headers: Record<string, string> }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    asked.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const hit = routes.find(([k]) => url.includes(k));
    if (!hit) return new Response("no route", { status: 500 });
    const r = typeof hit[1] === "function" ? hit[1](url, init) : hit[1];
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { f, asked };
}

// Instagram's web format, as ScrapeCreators (data.user) and SociaVault (data.data.user) return it.
const webUser = {
  id: "2700692569", username: "creator", full_name: "Creator Name", biography: "bio", is_private: false,
  profile_pic_url_hd: "https://x/pic.jpg", edge_followed_by: { count: 5000 }, edge_follow: { count: 10 },
  edge_owner_to_timeline_media: { count: 31, edges: [
    { node: { __typename: "GraphVideo", id: "354", shortcode: "DEiyb48AeB9", display_url: "https://x/t.jpg", is_video: true,
      video_url: "https://x/v.mp4", video_view_count: 1318, video_play_count: 2000, product_type: "clips", comments_disabled: false,
      taken_at_timestamp: 1736294201, edge_media_to_caption: { edges: [{ node: { text: "New reel #launch" } }] },
      edge_media_to_comment: { count: 12 }, edge_liked_by: { count: 99 } } },
    { node: { __typename: "GraphImage", id: "355", shortcode: "DEold00001", display_url: "https://x/t2.jpg", is_video: false,
      taken_at_timestamp: 1736200000, edge_media_to_caption: { edges: [] }, edge_media_to_comment: { count: 0 }, edge_media_preview_like: { count: 5 } } },
  ] },
};
const webComments = [
  { id: "18051843701642870", text: "love it", created_at: "2025-09-16T17:03:04.000Z", comment_like_count: 3, child_comment_count: 1,
    replies: [{ id: "18051843701642999", text: "same", created_at: "2025-09-16T18:00:00.000Z", user: { id: "9", username: "b" } }],
    user: { id: "46773599357", pk: "46773599357", username: "catherina" } },
];

// 1. Order: only providers with keys, in the default order; comments skip the official API (it can't read them).
const env = { SCRAPECREATORS_API_KEY: "sc1", HIKERAPI_KEY: "hk1", IG_GRAPH_TOKEN: "tok", IG_GRAPH_USER_ID: "178" };
assert.deepEqual(sourceOrder(env), ["graph", "scrapecreators", "hikerapi"]);
assert.deepEqual(sourceOrder(env, "comments"), ["scrapecreators", "hikerapi"]);
assert.deepEqual(sourceOrder({ ...env, IG_SOURCES: "hikerapi,scrapecreators" }), ["hikerapi", "scrapecreators"]);
assert.deepEqual(sourceOrder({ APIFY_TOKEN: "x" }), []); // Apify isn't one of these: it's the separate last resort

// 2. Official API (Business Discovery) answers first; its posts are read from the permalinks.
{
  const { f, asked } = fakeFetch([["graph.facebook.com", { body: { business_discovery: {
    id: "1", username: "creator", name: "Creator Name", followers_count: 5000, media_count: 31, profile_picture_url: "https://x/p.jpg",
    media: { data: [{ id: "m1", caption: "Hello #tag", like_count: 7, comments_count: 2, timestamp: "2026-11-09T10:00:00+0000",
      media_type: "VIDEO", media_product_type: "REELS", permalink: "https://www.instagram.com/reel/ABCdef123/", media_url: "https://x/v.mp4",
      thumbnail_url: "https://x/th.jpg" }] } } } }]]);
  const r = await fetchProfile("creator", env, { fetch: f });
  assert.equal(r.source, "graph");
  assert.equal(r.profile?.followersCount, 5000);
  const p = r.profile!.latestPosts![0];
  assert.deepEqual([p.shortCode, p.likesCount, p.commentsCount, p.productType, p.videoUrl, p.displayUrl, p.timestamp],
    ["ABCdef123", 7, 2, "clips", "https://x/v.mp4", "https://x/th.jpg", "2026-11-09T10:00:00.000Z"]);
  assert.ok(asked[0].url.includes("/178?fields=") && asked[0].url.includes("business_discovery.username(creator)"));
  assert.equal(asked.length, 1, "the next providers aren't asked once one answered");
}

// 3. Personal account (official API can't see it) → ScrapeCreators answers; its format is read correctly.
{
  const { f, asked } = fakeFetch([
    ["graph.facebook.com", { status: 400, body: { error: { message: "Invalid user id" } } }],
    ["api.scrapecreators.com/v1/instagram/profile", { body: { success: true, data: { user: webUser } } }],
  ]);
  const attempts: Attempt[] = [];
  const r = await fetchProfile("creator", env, { fetch: f, attempts });
  assert.equal(r.source, "scrapecreators");
  assert.deepEqual(attempts.map((a) => [a.source, a.ok]), [["graph", false], ["scrapecreators", true]]);
  assert.equal(asked[1].headers["x-api-key"], "sc1");
  const [reel, photo] = r.profile!.latestPosts!;
  assert.deepEqual([reel.shortCode, reel.likesCount, reel.commentsCount, reel.videoPlayCount, reel.caption, reel.productType, reel.timestamp],
    ["DEiyb48AeB9", 99, 12, 2000, "New reel #launch", "clips", "2025-01-07T23:56:41.000Z"]);
  assert.deepEqual(reel.hashtags, ["launch"]);
  assert.deepEqual([photo.shortCode, photo.likesCount, photo.type], ["DEold00001", 5, "Image"]);
  assert.deepEqual([r.profile!.followersCount, r.profile!.postsCount, r.profile!.fullName], [5000, 31, "Creator Name"]);
}

// 4. Out of credits (402) → marked "exhausted" and the next provider (HikerAPI, instagrapi format) answers.
{
  const { f, asked } = fakeFetch([
    ["graph.facebook.com", { status: 400, body: {} }],
    ["scrapecreators", { status: 402, body: { message: "out of credits" } }],
    ["/v1/user/by/username", { body: { pk: 42, username: "creator", full_name: "C", follower_count: 777, following_count: 3, media_count: 9 } }],
    ["/v1/user/medias/chunk", { body: [[{ pk: 1, code: "HKcode1", taken_at: "2026-11-09T08:00:00Z", media_type: 2, product_type: "clips",
      comment_count: 4, like_count: 50, play_count: 900, caption_text: "hi", thumbnail_url: "https://x/h.jpg", video_url: "https://x/h.mp4" }], null] }],
  ]);
  const attempts: Attempt[] = [];
  const r = await fetchProfile("creator", env, { fetch: f, attempts });
  assert.equal(r.source, "hikerapi");
  assert.deepEqual(attempts.map((a) => [a.source, a.ok, !!a.exhausted]), [["graph", false, false], ["scrapecreators", false, true], ["hikerapi", true, false]]);
  assert.equal(asked.find((a) => a.url.includes("hikerapi"))?.headers["x-access-key"], "hk1");
  assert.deepEqual([r.profile!.followersCount, r.profile!.latestPosts![0].shortCode, r.profile!.latestPosts![0].videoPlayCount], [777, "HKcode1", 900]);
}

// 5. A resting provider is skipped; several keys are tried in turn.
{
  const { f, asked } = fakeFetch([
    ["scrapecreators", (_u, init) => ((init?.headers as Record<string, string>)["x-api-key"] === "bad"
      ? { status: 401, body: {} } : { body: { data: { user: webUser } } })],
  ]);
  const r = await fetchProfile("creator", { SCRAPECREATORS_API_KEY: "bad, good", HIKERAPI_KEY: "hk" }, { fetch: f, resting: new Set(["hikerapi"]) });
  assert.equal(r.source, "scrapecreators");
  assert.equal(asked.length, 2);
  const none = await fetchProfile("creator", { HIKERAPI_KEY: "hk" }, { fetch: f, resting: new Set(["hikerapi"]) });
  assert.equal(none.profile, null, "everything resting → nothing (the caller falls back to Apify)");
}

// 6. "Not found" stops the search (another provider won't find it either).
{
  const { f, asked } = fakeFetch([["scrapecreators", { body: { success: true, error: "not_found", message: "Account doesn't exist" } }]]);
  const r = await fetchProfile("nobody", { SCRAPECREATORS_API_KEY: "a", HIKERAPI_KEY: "b" }, { fetch: f });
  assert.equal(r.profile, null);
  assert.equal(asked.length, 1);
}

// 7. Comments: ScrapeCreators pages with a cursor; replies are kept.
{
  let page = 0;
  const { f, asked } = fakeFetch([["/v2/instagram/post/comments", () => (page++ === 0
    ? { body: { success: true, comments: webComments, cursor: "c2" } }
    : { body: { success: true, comments: [{ id: "2", text: "second page", created_at: "2025-09-17T00:00:00.000Z", user: { id: "5", username: "z" } }], cursor: null } })]]);
  const r = await fetchComments("DEiyb48AeB9", 50, { SCRAPECREATORS_API_KEY: "sc" }, { fetch: f });
  assert.equal(r.source, "scrapecreators");
  assert.equal(r.comments!.length, 2);
  const c = r.comments![0];
  assert.deepEqual([c.id, c.text, c.ownerUsername, c.owner?.id, c.likesCount, c.repliesCount, c.postUrl, c.replies?.[0]?.id],
    ["18051843701642870", "love it", "catherina", "46773599357", 3, 1, "https://www.instagram.com/p/DEiyb48AeB9/", "18051843701642999"]);
  assert.ok(asked[1].url.includes("cursor=c2"));
}

// 8. Comments: SociaVault (comments come as {"0": …} under data), HikerAPI and Bright Data formats.
{
  const { f } = fakeFetch([["/v1/scrape/instagram/comments", { body: { success: true, data: { success: true, comments: { 0: webComments[0] }, cursor: null } } }]]);
  const r = await fetchComments("X1", 50, { SOCIAVAULT_API_KEY: "sv" }, { fetch: f });
  assert.deepEqual([r.source, r.comments?.length, r.comments?.[0].text], ["sociavault", 1, "love it"]);
}
{
  const { f } = fakeFetch([
    ["/v1/media/by/code", { body: { pk: 3540614075954356349n.toString(), code: "X2" } }],
    ["/v1/media/comments", { body: [{ pk: "77", text: "nice", created_at_utc: 1736294201, like_count: 2, user: { pk: 8, username: "h" } }] }],
  ]);
  const r = await fetchComments("X2", 50, { HIKERAPI_KEY: "hk" }, { fetch: f });
  assert.deepEqual([r.source, r.comments?.[0].id, r.comments?.[0].owner?.id, r.comments?.[0].timestamp, r.comments?.[0].likesCount],
    ["hikerapi", "77", "8", "2025-01-07T23:56:41.000Z", 2]);
}
{
  const { f, asked } = fakeFetch([["datasets/v3/scrape", { body: [{ comment_id: "c9", comment: "great", comment_user: "bd", comment_date: "2026-11-01T00:00:00Z",
    likes_number: 4, replies_number: 0, post_url: "https://www.instagram.com/p/X3/" }] }]]);
  const r = await fetchComments("X3", 50, { BRIGHTDATA_API_KEY: "bd" }, { fetch: f });
  assert.deepEqual([r.source, r.comments?.[0].id, r.comments?.[0].ownerUsername, r.comments?.[0].likesCount], ["brightdata", "c9", "bd", 4]);
  assert.ok(asked[0].url.includes("dataset_id=gd_ltppn085pokosxh13"));
  assert.equal(asked[0].headers.Authorization, "Bearer bd");
}

console.log("ig-sources: all checks passed");
