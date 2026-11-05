import { Shell } from "@/components/Shell";
import { ago } from "@/lib/format";
import { channels as getChannels, kpis, lastSyncAt } from "@/lib/queries";
import { utc } from "@/lib/db-time";

export const dynamic = "force-dynamic";

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const [chs, k, last] = await Promise.all([getChannels(), kpis(), lastSyncAt()]);
  const lastDate = utc(last);
  const healthy = !!lastDate && Date.now() - lastDate.getTime() < 5 * 3600 * 1000;
  return (
    <Shell
      channels={chs.map((c) => ({ id: c.id, title: c.title, thumb: c.thumbnail_url, active: c.active }))}
      status={{ lastSync: ago(last), quota: k.quota_used_today, healthy }}
    >
      {children}
    </Shell>
  );
}
