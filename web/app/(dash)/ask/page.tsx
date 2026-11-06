import { ChatView } from "@/components/ChatView";
import { PageHeader } from "@/components/ui";
import { getThread, listThreads } from "@/lib/chat";
import { channels as getChannels } from "@/lib/queries";
import { focusChannel } from "@/lib/focus";

export const metadata = { title: "Ask AI" };
export const maxDuration = 60;

export default async function AskPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const [chs, threads, current] = await Promise.all([getChannels(), listThreads(), t ? getThread(t) : Promise.resolve(null)]);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Ask AI" title={<>Ask your <span className="glow-text">comments</span></>}>
        <p className="text-[15px] text-ink-2">Have a conversation about the audience. The AI searches every stored comment in every language, uses its long-term memory of each creator, remembers what you asked earlier, and saves your chats.</p>
      </PageHeader>
      <ChatView key={current?.thread.id ?? "new"} threads={threads} threadId={current?.thread.id ?? null}
        messages={current?.messages ?? []} channels={chs.map((c) => ({ id: c.id, title: c.title }))}
        threadChannel={current ? current.thread.channel_id ?? null : await focusChannel(chs.filter((c) => c.active).map((c) => c.id))} />
    </div>
  );
}
