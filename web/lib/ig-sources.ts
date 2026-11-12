/**
 * Instagram data from several providers, tried in order: the free/cheap ones first, Apify last.
 *
 * Every provider answers in its own format; here each answer is turned into one common shape (the
 * same field names Apify uses), so the rest of the app stores posts and comments the same way
 * whichever provider delivered them.
 *
 *   graph          Meta's official Instagram Graph API ("Business Discovery"). Free. Profile and recent posts
 *                  of Business/Creator accounts (no comment text). Needs IG_GRAPH_TOKEN + IG_GRAPH_USER_ID.
 *   scrapecreators ScrapeCreators (x-api-key). Profile + recent posts, comments.     SCRAPECREATORS_API_KEY
 *   sociavault     SociaVault (X-API-Key). Same data as ScrapeCreators.              SOCIAVAULT_API_KEY
 *   hikerapi       HikerAPI (x-access-key). Profile, posts, comments.                HIKERAPI_KEY
 *   brightdata     Bright Data Scraper API (Bearer). Profile + posts, comments.      BRIGHTDATA_API_KEY
 *   (apify)        handled in instagram.ts: runs in the background, used only when all of these fail.
 *
 * Keys can be comma-separated lists (several free accounts); each is tried in turn.
 * IG_SOURCES reorders or limits them, e.g. "graph,hikerapi,scrapecreators".
 * No imports from the app, so it can be tested on its own (tests/ig-sources.test.ts).
 */

export type IgPost = {
  id?: string; shortCode?: string; url?: string; type?: string; caption?: string; displayUrl?: string; timestamp?: string;
  likesCount?: number; commentsCount?: number; videoViewCount?: number; videoPlayCount?: number; videoDuration?: number;
  productType?: string; isCommentsDisabled?: boolean; hashtags?: string[]; ownerUsername?: string; error?: string; videoUrl?: string;
};
export type IgComment = {
  id?: string; postUrl?: string; text?: string; ownerUsername?: string; owner?: { id?: string; username?: string };
  ownerId?: string; likesCount?: number; repliesCount?: number; timestamp?: string; replies?: IgComment[]; error?: string;
};
export type IgProfile = {
  id?: string; username?: string; fullName?: string; biography?: string; followersCount?: number; followsCount?: number;
  postsCount?: number; profilePicUrl?: string; profilePicUrlHD?: string; latestPosts?: IgPost[]; private?: boolean;
  error?: string; errorDescription?: string;
};

export type SourceName = "graph" | "scrapecreators" | "sociavault" | "hikerapi" | "brightdata";
export const ALL_SOURCES: SourceName[] = ["graph", "scrapecreators", "sociavault", "hikerapi", "brightdata"];
/** Which of the five can read comment text (the official API can't, for other people's posts). */
export const COMMENT_SOURCES: SourceName[] = ["scrapecreators", "sociavault", "hikerapi", "brightdata"];

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

/** A provider said no for a reason that won't pass in minutes (no credits, bad key, rate limit). */
export class SourceError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) { super(message); this.status = status; }
  /** Out of credits / key refused / rate limited: rest this provider for a while. */
  get exhausted() { return [401, 402, 403, 429].includes(this.status); }
}

export const splitKeys = (v?: string) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** Keys per source (empty = not set up). */
export function sourceKeys(env: Env, s: SourceName): string[] {
  switch (s) {
    case "graph": {
      const tokens = splitKeys(env.IG_GRAPH_TOKEN), ids = splitKeys(env.IG_GRAPH_USER_ID);
      return tokens.map((t, i) => `${ids[i] ?? ids[0] ?? ""}|${t}`).filter((k) => !k.startsWith("|"));
    }
    case "scrapecreators": return splitKeys(env.SCRAPECREATORS_API_KEY);
    case "sociavault": return splitKeys(env.SOCIAVAULT_API_KEY);
    case "hikerapi": return splitKeys(env.HIKERAPI_KEY);
    case "brightdata": return splitKeys(env.BRIGHTDATA_API_KEY);
  }
}

/** Sources that are set up, in the order to try them. */
export function sourceOrder(env: Env, need: "profile" | "comments" = "profile"): SourceName[] {
  const wanted = splitKeys(env.IG_SOURCES).filter((s): s is SourceName => (ALL_SOURCES as string[]).includes(s));
  const order = wanted.length ? wanted : ALL_SOURCES;
  return order.filter((s) => sourceKeys(env, s).length && (need === "profile" || COMMENT_SOURCES.includes(s)));
}

const base = (env: Env, s: SourceName) => ({
  graph: env.IG_GRAPH_API_BASE ?? "https://graph.facebook.com/v25.0",
  scrapecreators: env.SCRAPECREATORS_API_BASE ?? "https://api.scrapecreators.com",
  sociavault: env.SOCIAVAULT_API_BASE ?? "https://api.sociavault.com",
  hikerapi: env.HIKERAPI_API_BASE ?? "https://api.hikerapi.com",
  brightdata: env.BRIGHTDATA_API_BASE ?? "https://api.brightdata.com",
})[s];

async function getJson(f: Fetch, url: string, init: RequestInit, label: string, timeoutMs = 35_000): Promise<unknown> {
  const res = await f(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) throw new SourceError(`${label} ${res.status}: ${text.slice(0, 160)}`, res.status);
  if (res.status === 202) throw new SourceError(`${label}: still working (took too long)`, 202);
  try { return JSON.parse(text); } catch { throw new SourceError(`${label}: not JSON`, res.status); }
}

/* ------------------------------------------------------------------ small helpers */
const n = (v: unknown): number | undefined => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? undefined : Number(v));
const iso = (v: unknown): string | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number" || /^\d+$/.test(String(v))) { const s = Number(v); return new Date((s > 1e12 ? s : s * 1000)).toISOString(); }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};
export const codeFromUrl = (url?: string) => url?.match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/)?.[1];
const postUrl = (code: string) => `https://www.instagram.com/p/${code}/`;
const hashtags = (caption?: string) => [...new Set((caption ?? "").match(/#[\p{L}\p{N}_]+/gu)?.map((h) => h.slice(1)) ?? [])];
/** Some providers send lists as {"0": …, "1": …}. */
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []) as T[];

/* ------------------------------------------------------------------ Instagram's own web format (ScrapeCreators, SociaVault) */
type GNode = {
  id?: string; shortcode?: string; __typename?: string; is_video?: boolean; product_type?: string; display_url?: string;
  thumbnail_src?: string; video_url?: string; video_view_count?: number; video_play_count?: number; video_duration?: number;
  taken_at_timestamp?: number; comments_disabled?: boolean;
  edge_media_to_caption?: { edges?: { node?: { text?: string } }[] }; edge_media_to_comment?: { count?: number };
  edge_liked_by?: { count?: number }; edge_media_preview_like?: { count?: number };
};
type GUser = {
  id?: string; username?: string; full_name?: string; biography?: string; is_private?: boolean;
  profile_pic_url?: string; profile_pic_url_hd?: string; edge_followed_by?: { count?: number }; edge_follow?: { count?: number };
  edge_owner_to_timeline_media?: { count?: number; edges?: { node?: GNode }[] };
};

export function fromWebNode(p: GNode, owner?: string): IgPost | null {
  if (!p.shortcode) return null;
  const caption = p.edge_media_to_caption?.edges?.[0]?.node?.text ?? "";
  return {
    id: p.id, shortCode: p.shortcode, url: postUrl(p.shortcode), caption,
    type: p.__typename === "GraphSidecar" ? "Sidecar" : p.is_video ? "Video" : "Image", productType: p.product_type,
    displayUrl: p.display_url ?? p.thumbnail_src, timestamp: iso(p.taken_at_timestamp),
    likesCount: n(p.edge_liked_by?.count ?? p.edge_media_preview_like?.count), commentsCount: n(p.edge_media_to_comment?.count),
    videoPlayCount: n(p.video_play_count), videoViewCount: n(p.video_view_count), videoDuration: n(p.video_duration),
    videoUrl: p.video_url, isCommentsDisabled: !!p.comments_disabled, hashtags: hashtags(caption), ownerUsername: owner,
  };
}

export function fromWebUser(u: GUser): IgProfile {
  return {
    id: u.id, username: u.username, fullName: u.full_name, biography: u.biography, private: !!u.is_private,
    followersCount: n(u.edge_followed_by?.count), followsCount: n(u.edge_follow?.count),
    postsCount: n(u.edge_owner_to_timeline_media?.count), profilePicUrl: u.profile_pic_url, profilePicUrlHD: u.profile_pic_url_hd,
    latestPosts: (u.edge_owner_to_timeline_media?.edges ?? []).map((e) => e.node && fromWebNode(e.node, u.username)).filter((p): p is IgPost => !!p),
  };
}

type WebComment = { id?: string; pk?: string; text?: string; created_at?: string | number; created_at_utc?: number;
  comment_like_count?: number; like_count?: number; child_comment_count?: number;
  user?: { id?: string; pk?: string | number; username?: string }; replies?: WebComment[] };

export function fromWebComment(c: WebComment, code: string): IgComment | null {
  const id = String(c.id ?? c.pk ?? "");
  if (!id) return null;
  const uid = c.user?.id ?? (c.user?.pk !== undefined ? String(c.user.pk) : undefined);
  return {
    id, postUrl: postUrl(code), text: c.text ?? "", ownerUsername: c.user?.username, owner: { id: uid, username: c.user?.username },
    likesCount: n(c.comment_like_count ?? c.like_count), repliesCount: n(c.child_comment_count),
    timestamp: iso(c.created_at ?? c.created_at_utc),
    replies: list<WebComment>(c.replies).map((r) => fromWebComment(r, code)).filter((r): r is IgComment => !!r),
  };
}

/* ------------------------------------------------------------------ HikerAPI (instagrapi format) */
type HMedia = { pk?: string | number; id?: string; code?: string; taken_at?: string | number; media_type?: number; product_type?: string;
  thumbnail_url?: string; comment_count?: number; comments_disabled?: boolean; like_count?: number; play_count?: number; view_count?: number;
  caption_text?: string; video_url?: string; video_duration?: number;
  // the same Instagram format as ScrapeCreators' posts feed returns it:
  caption?: { text?: string } | null; display_uri?: string; image_versions2?: { candidates?: { url?: string }[] };
  video_versions?: { url?: string }[] };
type HUser = { pk?: string | number; username?: string; full_name?: string; is_private?: boolean; profile_pic_url?: string;
  profile_pic_url_hd?: string; media_count?: number; follower_count?: number; following_count?: number; biography?: string };

export function fromHikerMedia(m: HMedia, owner?: string): IgPost | null {
  if (!m.code) return null;
  const caption = m.caption_text ?? m.caption?.text ?? "";
  return {
    id: m.pk !== undefined ? String(m.pk) : m.id, shortCode: m.code, url: postUrl(m.code), caption,
    type: m.media_type === 8 ? "Sidecar" : m.media_type === 2 ? "Video" : "Image", productType: m.product_type,
    displayUrl: m.thumbnail_url ?? m.display_uri ?? m.image_versions2?.candidates?.[0]?.url, timestamp: iso(m.taken_at),
    likesCount: n(m.like_count), commentsCount: n(m.comment_count),
    videoPlayCount: n(m.play_count), videoViewCount: n(m.view_count), videoDuration: n(m.video_duration),
    videoUrl: m.video_url ?? m.video_versions?.[0]?.url,
    isCommentsDisabled: !!m.comments_disabled, hashtags: hashtags(caption), ownerUsername: owner,
  };
}

/**
 * An account's older posts (its back catalogue), newest first, up to `max`: ScrapeCreators' posts feed or
 * HikerAPI's media pages (about 12 posts, one credit, per page). Used once per account so there's enough
 * history to compare posts and train the Instagram prediction model.
 */
export async function fetchPostHistory(username: string, max: number, env: Env,
  opts: { resting?: Set<SourceName>; fetch?: Fetch; attempts?: Attempt[]; pages?: number } = {}) {
  const attempts = opts.attempts ?? [];
  const f = opts.fetch ?? fetch;
  const pages = opts.pages ?? Math.ceil(max / 12) + 2;
  const order = sourceOrder(env, "comments").filter((s) => s === "scrapecreators" || s === "hikerapi");
  const r = await tryAll(order, env, opts.resting ?? new Set(), attempts, async (s, key) => {
    const b = base(env, s);
    const out: IgPost[] = [];
    let cursor: string | undefined;
    if (s === "scrapecreators") {
      for (let i = 0; i < pages && out.length < max; i++) {
        const q = new URLSearchParams({ handle: username });
        if (cursor) q.set("next_max_id", cursor);
        const d = (await getJson(f, `${b}/v2/instagram/user/posts?${q}`, { headers: { "x-api-key": key } }, s)) as
          { items?: HMedia[]; next_max_id?: string; more_available?: boolean };
        out.push(...list<HMedia>(d.items).map((m) => fromHikerMedia(m, username)).filter((p): p is IgPost => !!p));
        cursor = d.next_max_id ?? undefined;
        if (!cursor || d.more_available === false || !d.items?.length) break;
      }
    } else {
      const h = { "x-access-key": key, accept: "application/json" };
      const u = (await getJson(f, `${b}/v1/user/by/username?username=${encodeURIComponent(username)}`, { headers: h }, "HikerAPI")) as HUser;
      if (u?.pk === undefined) throw new SourceError("HikerAPI: profile not found", 404);
      for (let i = 0; i < pages && out.length < max; i++) {
        const q = new URLSearchParams({ user_id: String(u.pk) });
        if (cursor) q.set("end_cursor", cursor);
        const d = await getJson(f, `${b}/v1/user/medias/chunk?${q}`, { headers: h }, "HikerAPI");
        const [items, next] = Array.isArray(d) ? [list<HMedia>(d[0]), d[1] as string | null] : [[], null];
        out.push(...items.map((m) => fromHikerMedia(m, username)).filter((p): p is IgPost => !!p));
        cursor = next ?? undefined;
        if (!cursor || !items.length) break;
      }
    }
    if (!out.length) throw new SourceError(`${s}: no posts returned`);
    return out.slice(0, max);
  });
  return r ? { source: r.source, posts: r.value, attempts } : { source: null, posts: null, attempts };
}

/* ------------------------------------------------------------------ Bright Data */
type BPost = { url?: string; shortcode?: string; post_id?: string; id?: string; caption?: string; description?: string; datetime?: string;
  date_posted?: string; likes?: number; comments?: number; num_comments?: number; image_url?: string; thumbnail?: string;
  content_type?: string; product_type?: string; video_view_count?: number; video_play_count?: number; video_url?: string };
type BProfile = { account?: string; id?: string; full_name?: string; profile_name?: string; biography?: string; followers?: number;
  following?: number; posts_count?: number; profile_image_link?: string; is_private?: boolean; posts?: BPost[];
  error?: string; error_code?: string };
type BComment = { comment_id?: string; comment?: string; comment_user?: string; comment_date?: string; likes_number?: number;
  replies_number?: number; post_url?: string; url?: string; error?: string };

export function fromBrightPost(p: BPost, owner?: string): IgPost | null {
  const code = p.shortcode ?? codeFromUrl(p.url);
  if (!code) return null;
  const caption = p.caption ?? p.description ?? "";
  const video = /video|reel|clip/i.test(`${p.content_type ?? ""} ${p.product_type ?? ""}`);
  return {
    id: p.post_id ?? p.id, shortCode: code, url: postUrl(code), caption, type: video ? "Video" : "Image",
    productType: p.product_type ?? (/reel|clip/i.test(p.content_type ?? "") ? "clips" : undefined),
    displayUrl: p.thumbnail ?? p.image_url, timestamp: iso(p.date_posted ?? p.datetime), likesCount: n(p.likes),
    commentsCount: n(p.num_comments ?? p.comments), videoPlayCount: n(p.video_play_count), videoViewCount: n(p.video_view_count),
    videoUrl: p.video_url, hashtags: hashtags(caption), ownerUsername: owner,
  };
}

/* ------------------------------------------------------------------ the providers */
export type ProfileResult = { source: SourceName; profile: IgProfile };
export type CommentsResult = { source: SourceName; comments: IgComment[] };

async function profileFrom(s: SourceName, key: string, username: string, env: Env, f: Fetch): Promise<IgProfile> {
  const b = base(env, s);
  if (s === "graph") {
    const [userId, token] = key.split("|");
    const media = "media.limit(12){id,caption,like_count,comments_count,timestamp,media_type,media_product_type,permalink,media_url,thumbnail_url}";
    const fields = `business_discovery.username(${username}){username,name,biography,followers_count,follows_count,media_count,profile_picture_url,${media}}`;
    const d = (await getJson(f, `${b}/${userId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`, {}, "Instagram API")) as {
      business_discovery?: { id?: string; username?: string; name?: string; biography?: string; followers_count?: number; follows_count?: number;
        media_count?: number; profile_picture_url?: string; media?: { data?: { id?: string; caption?: string; like_count?: number;
          comments_count?: number; timestamp?: string; media_type?: string; media_product_type?: string; permalink?: string;
          media_url?: string; thumbnail_url?: string }[] } } };
    const u = d.business_discovery;
    // Personal accounts aren't visible to the official API: not "not found", so the next provider tries.
    if (!u?.username) throw new SourceError("Instagram API: not a business/creator account", 400);
    return {
      id: u.id, username: u.username, fullName: u.name, biography: u.biography, followersCount: n(u.followers_count),
      followsCount: n(u.follows_count), postsCount: n(u.media_count), profilePicUrl: u.profile_picture_url,
      latestPosts: (u.media?.data ?? []).map((m): IgPost | null => {
        const code = codeFromUrl(m.permalink);
        if (!code) return null;
        const video = m.media_type === "VIDEO";
        return { id: m.id, shortCode: code, url: postUrl(code), caption: m.caption ?? "", timestamp: iso(m.timestamp),
          type: m.media_type === "CAROUSEL_ALBUM" ? "Sidecar" : video ? "Video" : "Image",
          productType: m.media_product_type === "REELS" ? "clips" : undefined, likesCount: n(m.like_count), commentsCount: n(m.comments_count),
          displayUrl: video ? m.thumbnail_url : m.media_url, videoUrl: video ? m.media_url : undefined, hashtags: hashtags(m.caption),
          ownerUsername: u.username };
      }).filter((p): p is IgPost => !!p),
    };
  }
  if (s === "scrapecreators" || s === "sociavault") {
    const url = s === "scrapecreators"
      ? `${b}/v1/instagram/profile?handle=${encodeURIComponent(username)}`
      : `${b}/v1/scrape/instagram/profile?handle=${encodeURIComponent(username)}`;
    const header: Record<string, string> = s === "scrapecreators" ? { "x-api-key": key } : { "X-API-Key": key };
    const d = (await getJson(f, url, { headers: header }, s)) as { data?: { user?: GUser; data?: { user?: GUser } }; success?: boolean; error?: string; message?: string };
    const u = d.data?.user ?? d.data?.data?.user;
    if (!u?.username) throw new SourceError(`${s}: ${d.message ?? d.error ?? "profile not found"}`, 404);
    return fromWebUser(u);
  }
  if (s === "hikerapi") {
    const h = { "x-access-key": key, accept: "application/json" };
    const u = (await getJson(f, `${b}/v1/user/by/username?username=${encodeURIComponent(username)}`, { headers: h }, "HikerAPI")) as HUser;
    if (!u?.username) throw new SourceError("HikerAPI: profile not found", 404);
    let medias: HMedia[] = [];
    if (!u.is_private && u.pk !== undefined) {
      const r = await getJson(f, `${b}/v1/user/medias/chunk?user_id=${u.pk}`, { headers: h }, "HikerAPI").catch(() => null);
      medias = Array.isArray(r) ? list<HMedia>(r[0]) : [];
    }
    return {
      id: u.pk !== undefined ? String(u.pk) : undefined, username: u.username, fullName: u.full_name, biography: u.biography,
      private: !!u.is_private, followersCount: n(u.follower_count), followsCount: n(u.following_count), postsCount: n(u.media_count),
      profilePicUrl: u.profile_pic_url, profilePicUrlHD: u.profile_pic_url_hd,
      latestPosts: medias.slice(0, 12).map((m) => fromHikerMedia(m, u.username)).filter((p): p is IgPost => !!p),
    };
  }
  // brightdata: synchronous scrape of the profile page (one record, includes recent posts)
  const d = (await getJson(f, `${b}/datasets/v3/scrape?dataset_id=gd_l1vikfch901nx3by4&format=json&include_errors=true&notify=false`, {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input: [{ url: `https://www.instagram.com/${username}/` }] }),
  }, "Bright Data", 65_000)) as BProfile[] | BProfile;
  const p = list<BProfile>(Array.isArray(d) ? d : [d])[0];
  if (!p || p.error || !p.account) throw new SourceError(`Bright Data: ${p?.error ?? "profile not found"}`, 404);
  return {
    id: p.id, username: p.account, fullName: p.full_name ?? p.profile_name, biography: p.biography, private: !!p.is_private,
    followersCount: n(p.followers), followsCount: n(p.following), postsCount: n(p.posts_count), profilePicUrl: p.profile_image_link,
    latestPosts: list<BPost>(p.posts).map((x) => fromBrightPost(x, p.account)).filter((x): x is IgPost => !!x),
  };
}

async function commentsFrom(s: SourceName, key: string, code: string, limit: number, env: Env, f: Fetch): Promise<IgComment[]> {
  const b = base(env, s);
  const out: IgComment[] = [];
  if (s === "scrapecreators" || s === "sociavault") {
    const header: Record<string, string> = s === "scrapecreators" ? { "x-api-key": key } : { "X-API-Key": key };
    const path = s === "scrapecreators" ? "/v2/instagram/post/comments" : "/v1/scrape/instagram/comments";
    let cursor: string | undefined;
    for (let page = 0; page < 10 && out.length < limit; page++) {
      const q = new URLSearchParams({ url: `https://www.instagram.com/p/${code}/` });
      if (cursor) q.set("cursor", cursor);
      const d = (await getJson(f, `${b}${path}?${q}`, { headers: header }, s)) as
        { comments?: unknown; cursor?: string; data?: { comments?: unknown; cursor?: string } };
      const items = list<WebComment>(d.comments ?? d.data?.comments);
      out.push(...items.map((c) => fromWebComment(c, code)).filter((c): c is IgComment => !!c));
      cursor = d.cursor ?? d.data?.cursor ?? undefined;
      if (!items.length || !cursor) break;
    }
    return out.slice(0, limit);
  }
  if (s === "hikerapi") {
    const h = { "x-access-key": key, accept: "application/json" };
    const m = (await getJson(f, `${b}/v1/media/by/code?code=${encodeURIComponent(code)}`, { headers: h }, "HikerAPI")) as HMedia;
    if (m?.pk === undefined && !m?.id) throw new SourceError("HikerAPI: post not found", 404);
    const id = String(m.pk ?? m.id);
    const items = (await getJson(f, `${b}/v1/media/comments?id=${encodeURIComponent(id)}&amount=${limit}`, { headers: h }, "HikerAPI")) as WebComment[];
    return list<WebComment>(items).map((c) => fromWebComment({ ...c, created_at: c.created_at ?? c.created_at_utc }, code))
      .filter((c): c is IgComment => !!c).slice(0, limit);
  }
  if (s === "brightdata") {
    const d = (await getJson(f, `${b}/datasets/v3/scrape?dataset_id=gd_ltppn085pokosxh13&format=json&include_errors=true&notify=false`, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: [{ url: `https://www.instagram.com/p/${code}/` }] }),
    }, "Bright Data", 65_000)) as BComment[];
    for (const c of list<BComment>(d)) {
      if (c.error || !c.comment_id) continue;
      out.push({ id: c.comment_id, postUrl: postUrl(code), text: c.comment ?? "", ownerUsername: c.comment_user,
        owner: { username: c.comment_user }, likesCount: n(c.likes_number), repliesCount: n(c.replies_number), timestamp: iso(c.comment_date) });
    }
    return out.slice(0, limit);
  }
  throw new SourceError(`${s} can't read comments`, 400);
}

/** Who's resting (out of credits / rate limited) until when; kept per server copy, and in ig_runs by the caller. */
export type Attempt = { source: SourceName; ok: boolean; error?: string; exhausted?: boolean };

async function tryAll<T>(order: SourceName[], env: Env, resting: Set<SourceName>, attempts: Attempt[],
  run: (s: SourceName, key: string) => Promise<T>): Promise<{ source: SourceName; value: T } | null> {
  for (const s of order) {
    if (resting.has(s)) continue;
    for (const key of sourceKeys(env, s)) {
      try {
        const value = await run(s, key);
        attempts.push({ source: s, ok: true });
        return { source: s, value };
      } catch (e) {
        const err = e instanceof SourceError ? e : new SourceError(e instanceof Error ? e.message : String(e));
        attempts.push({ source: s, ok: false, error: err.message.slice(0, 200), exhausted: err.exhausted });
        if (err.status === 404) return null; // the account/post isn't there: another provider won't find it either
      }
    }
  }
  return null;
}

/** Profile + recent posts from the first provider that answers, or null (then Apify is the fallback). */
export async function fetchProfile(username: string, env: Env, opts: { resting?: Set<SourceName>; fetch?: Fetch; attempts?: Attempt[] } = {}) {
  const attempts = opts.attempts ?? [];
  const r = await tryAll(sourceOrder(env, "profile"), env, opts.resting ?? new Set(), attempts,
    (s, key) => profileFrom(s, key, username, env, opts.fetch ?? fetch));
  return r ? { source: r.source, profile: r.value, attempts } : { source: null, profile: null, attempts };
}

/** Newest comments of one post (shortcode) from the first provider that answers, or null. */
export async function fetchComments(code: string, limit: number, env: Env, opts: { resting?: Set<SourceName>; fetch?: Fetch; attempts?: Attempt[] } = {}) {
  const attempts = opts.attempts ?? [];
  const r = await tryAll(sourceOrder(env, "comments"), env, opts.resting ?? new Set(), attempts,
    (s, key) => commentsFrom(s, key, code, limit, env, opts.fetch ?? fetch));
  return r ? { source: r.source, comments: r.value, attempts } : { source: null, comments: null, attempts };
}
