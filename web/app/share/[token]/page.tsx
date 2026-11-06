import { notFound } from "next/navigation";
import { ChannelReport } from "@/components/ChannelReport";
import { PrintButton } from "@/components/PrintButton";
import { Logo } from "@/components/Logo";
import { resolveShareLink } from "@/lib/share";

export const metadata = { title: "Shared report", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Read-only report opened from a share link (no password needed; the link can be revoked). */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const channelId = await resolveShareLink(token);
  if (!channelId) notFound();
  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <div className="no-print mb-5 flex items-center justify-between gap-3"><Logo /><PrintButton /></div>
      <ChannelReport channelId={channelId} mode="share"
        footer={<p className="pt-2 text-center text-[12px] text-ink-3">Read-only view shared from Creator Pulse. The owner can turn this link off at any time.</p>} />
    </main>
  );
}
