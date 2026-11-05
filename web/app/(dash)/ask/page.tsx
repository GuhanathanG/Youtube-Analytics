import { AskBox } from "@/components/AskBox";
import { PageHeader } from "@/components/ui";
import { channels as getChannels } from "@/lib/queries";

export const metadata = { title: "Ask AI" };
export const maxDuration = 60;

export default async function AskPage() {
  const chs = await getChannels();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Ask AI" title={<>Ask your <span className="glow-text">comments</span></>}>
        <p className="text-[15px] text-ink-2">Ask a question in plain words. The AI searches every stored comment, in every language, and answers with links to the comments it used.</p>
      </PageHeader>
      <AskBox channels={chs.map((c) => ({ id: c.id, title: c.title }))} />
    </div>
  );
}
