import { LiveProvider } from "@/components/LiveProvider";
import { Shell } from "@/components/Shell";
import { lastTick } from "@/lib/live";
import { channels as getChannels } from "@/lib/queries";
import { within } from "@/lib/cache";

export const dynamic = "force-dynamic";

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  // The sidebar must never hold up a page: if the list is slow, show the page without it this time.
  const [chs, tick] = await Promise.all([within(getChannels(), 8000, []), within(lastTick(), 5000, null)]);
  return (
    <LiveProvider initial={tick}>
      <Shell channels={chs.map((c) => ({ id: c.id, title: c.title, thumb: c.thumbnail_url, active: c.active }))}>
        {children}
      </Shell>
    </LiveProvider>
  );
}
