/** Instagram accounts, posts and commenters have ids starting "ig_"; everything else is YouTube. */
export const isInstagram = (id?: string | null) => !!id && id.startsWith("ig_");

export function channelUrl(id: string, handle?: string | null): string {
  if (isInstagram(id)) return `https://www.instagram.com/${(handle ?? id.slice(3)).replace(/^@/, "")}/`;
  return `https://www.youtube.com/channel/${id}`;
}

export function postUrl(id: string): string {
  return isInstagram(id) ? `https://www.instagram.com/p/${id.slice(3)}/` : `https://www.youtube.com/watch?v=${id}`;
}

/** Commenter profile; on Instagram the link goes by username (we store the account id). */
export function personUrl(id: string, name?: string | null): string | null {
  if (!isInstagram(id)) return `https://www.youtube.com/channel/${id}`;
  return name ? `https://www.instagram.com/${name.replace(/^@/, "")}/` : null;
}
