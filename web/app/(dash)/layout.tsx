import { LiveProvider } from "@/components/LiveProvider";
import { Shell } from "@/components/Shell";
import { lastTick } from "@/lib/live";
import { channels as getChannels } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const [chs, tick] = await Promise.all([getChannels(), lastTick().catch(() => null)]);
  return (
    <LiveProvider initial={tick}>
      <Shell channels={chs.map((c) => ({ id: c.id, title: c.title, thumb: c.thumbnail_url, active: c.active }))}>
        {children}
      </Shell>
    </LiveProvider>
  );
}
