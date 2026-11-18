import { ChatView } from "@/components/ChatView";
import { InView, Words } from "@/components/signal/InView";
import { getThread, listThreads } from "@/lib/chat";
import { channels as getChannels } from "@/lib/queries";
import { focusChannel } from "@/lib/focus";

export const metadata = { title: "Ask AI" };
export const maxDuration = 60;

export default async function AskPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const [chs, threads, current] = await Promise.all([getChannels(), listThreads(), t ? getThread(t) : Promise.resolve(null)]);
  return (
    <div className="sig mx-auto max-w-6xl">
      <InView as="section" className="sec">
        <div className="mono rise" style={{ color: "var(--cyan)" }}>■ Ask AI</div>
        <h1 className="display mt-5 text-[38px] md:text-[56px]"><Words text="Ask your comments." /></h1>
        <p className="rise lede mt-6" style={{ transitionDelay: "300ms" }}>Have a conversation about the audience. The AI searches every stored comment in every language, uses its long-term memory of each creator, remembers what you asked earlier, and saves your chats.</p>
      </InView>
      <ChatView key={current?.thread.id ?? "new"} threads={threads} threadId={current?.thread.id ?? null}
        messages={current?.messages ?? []} channels={chs.map((c) => ({ id: c.id, title: c.title }))}
        threadChannel={current ? current.thread.channel_id ?? null : await focusChannel(chs.filter((c) => c.active).map((c) => c.id))} />
    </div>
  );
}
