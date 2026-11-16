/**
 * Social accounts a creator lists in their YouTube description ("Follow us on Instagram: instagram.com/…").
 * Pure (no imports), so it's unit-tested on its own.
 */
export type SocialPlatform = "instagram" | "facebook" | "x" | "tiktok" | "threads";
export type SocialLink = { platform: SocialPlatform; handle: string; url: string; label: string | null };

const NOT_PROFILES = new Set(["p", "reel", "reels", "stories", "explore", "tv", "share", "sharer", "watch", "hashtag",
  "intent", "home", "login", "groups", "events", "pages", "profile.php", "i", "search", "video"]);

const PATTERNS: [SocialPlatform, RegExp][] = [
  ["instagram", /(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|instagr\.am)\/([A-Za-z0-9._]{1,30})/gi],
  ["threads", /(?:https?:\/\/)?(?:www\.)?threads\.(?:net|com)\/@?([A-Za-z0-9._]{1,30})/gi],
  ["tiktok", /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@([A-Za-z0-9._]{1,30})/gi],
  ["x", /(?:https?:\/\/)?(?:www\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]{1,15})(?![A-Za-z0-9_.])/gi],
  ["facebook", /(?:https?:\/\/)?(?:www\.|m\.)?(?:facebook|fb)\.com\/([A-Za-z0-9.]{3,50})/gi],
];

const URL = { instagram: "https://www.instagram.com/", threads: "https://www.threads.net/@", tiktok: "https://www.tiktok.com/@",
  x: "https://x.com/", facebook: "https://www.facebook.com/" } as const;

/** Every profile link in the text, once each, with the words just before it as a label ("Ram's Instagram id"). */
export function findSocialLinks(text: string | null | undefined): SocialLink[] {
  const src = text ?? "";
  const out: SocialLink[] = [];
  const seen = new Set<string>();
  for (const [platform, re] of PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      const handle = m[1].replace(/\.+$/, "").toLowerCase();
      if (!handle || NOT_PROFILES.has(handle)) continue;
      const key = `${platform}:${handle}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // The label: the text on the same line before the link, or the line above when the link stands alone.
      const before = src.slice(0, m.index);
      const lines = before.split("\n");
      let label = lines[lines.length - 1].replace(/[:\-–—|•]+\s*$/, "").trim();
      if (!label && lines.length > 1) label = lines[lines.length - 2].replace(/[:\-–—|•]+\s*$/, "").trim();
      out.push({ platform, handle, url: URL[platform] + handle, label: label ? label.slice(-60) : null });
    }
  }
  return out;
}
