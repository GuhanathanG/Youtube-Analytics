import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ChannelReport } from "@/components/ChannelReport";
import { PrintButton } from "@/components/PrintButton";

export const metadata = { title: "Weekly report" };
export const dynamic = "force-dynamic";

/** Printable weekly report for one channel ("Save as PDF" in the browser's print dialog). */
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <div className="no-print mb-5 flex items-center justify-between gap-3">
        <Link href={`/channels/${id}`} className="inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-accent"><ChevronLeft size={15} />Back to channel</Link>
        <PrintButton />
      </div>
      <ChannelReport channelId={id} mode="report" />
    </main>
  );
}
