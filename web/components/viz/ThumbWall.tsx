import Link from "next/link";
import type { WallItem } from "@/lib/channel-visual";
import { ago, compact } from "@/lib/format";
import { MultChip } from "./index";

/** Recent uploads as a wall: the three most-viewed get big tiles, glow follows the "× normal" score. */
export function ThumbWall({ items }: { items: WallItem[] }) {
  if (!items.length) return null;
  const big = new Set([...items].sort((a, b) => b.views - a.views).slice(0, 3).map((v) => v.id));
  return (
    <div className="grid auto-rows-[110px] grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-6 [grid-auto-flow:dense]">
      {items.map((v, i) => {
        const glow = v.score !== null && v.score >= 2 ? (v.score >= 10 ? "#fab219" : v.score >= 5 ? "#8b7cf6" : "#22d3ee") : null;
        return (
          <Link key={v.id} href={`/videos/${v.id}`} title={v.title}
            className={`reveal tilt group relative overflow-hidden rounded-2xl border border-line bg-black ${big.has(v.id) ? "col-span-2 row-span-2" : ""}`}
            style={{ animationDelay: `${i * 40}ms`, boxShadow: glow ? `0 0 26px -8px ${glow}` : undefined, borderColor: glow ? `${glow}66` : undefined }}>
            {v.thumb
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={v.thumb} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-full w-full object-cover opacity-85 transition duration-500 group-hover:scale-105 group-hover:opacity-100" />
              : <div className="h-full w-full bg-gradient-to-br from-accent/10 to-accent-2/10" />}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />
            {v.score !== null && <span className="absolute right-2 top-2"><MultChip value={v.score} suffix="" /></span>}
            <div className="absolute inset-x-2 bottom-2">
              {big.has(v.id) && <div className="mb-1 line-clamp-2 text-[13px] font-medium text-ink">{v.title}</div>}
              <div className="flex items-center justify-between text-[11px] text-ink-2"><span className="tabular">{compact(v.views)} views</span><span className="text-ink-3">{ago(v.published_at)}</span></div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
