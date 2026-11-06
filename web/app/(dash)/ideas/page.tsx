import { Heart, Lightbulb } from "lucide-react";
import Link from "next/link";
import { Reveal } from "@/components/Reveal";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { ago } from "@/lib/format";
import { channels as getChannels, latestInsight } from "@/lib/queries";
import { QuestionsList } from "@/components/CreatorPanels";
import { unansweredQuestions } from "@/lib/creator-insights";

export const metadata = { title: "Content ideas" };

type Idea = { title?: string; why?: string; requests?: number; likes?: number; examples?: string[] };

export default async function IdeasPage() {
  const chs = (await getChannels()).filter((c) => c.active);
  const ideas = await Promise.all(chs.map(async (c) => ({ c, ins: await latestInsight("ideas", c.id),
    questions: await unansweredQuestions(c.id).catch(() => []) })));
  return (
    <>
      <PageHeader eyebrow="Content ideas" title={<>What viewers are <span className="glow-text">asking for</span></>}>
        <p className="max-w-2xl text-[15px] text-ink-2">Every week the AI groups request and suggestion comments from the last 90 days into concrete video ideas, ranked by how many viewers ask and how much they're liked.</p>
      </PageHeader>
      {ideas.length === 0 ? <Empty>No channels yet.</Empty> : (
        <div className="space-y-4">
          {ideas.map(({ c, ins, questions }, ci) => {
            const list = ((ins?.data.ideas as Idea[] | undefined) ?? []).slice(0, 10);
            return (
              <Reveal key={c.id} delay={ci * 0.05}>
                <Panel title={<Link href={`/channels/${c.id}`} className="hover:text-accent">{c.title}</Link>}
                  subtitle={ins ? `Updated ${ago(ins.created_at)} from ${ins.comment_count.toLocaleString("en")} request comments` : undefined}>
                  {!list.length ? <Empty>Ideas appear once the AI has found at least 10 request comments for this channel (checked about every 10 minutes, refreshed weekly).</Empty> : (
                    <ol className="grid gap-3 md:grid-cols-2">
                      {list.map((idea, i) => (
                        <li key={i} className="rounded-xl border border-line bg-white/[0.02] p-4">
                          <div className="flex items-start gap-3">
                            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/15 text-[13px] font-semibold text-accent">{i + 1}</span>
                            <div className="min-w-0">
                              <div className="font-medium text-ink">{idea.title}</div>
                              {idea.why && <p className="mt-1 text-[13px] text-ink-2">{idea.why}</p>}
                              <div className="mt-2 flex gap-3 text-[12px] text-ink-3 tabular">
                                <span className="flex items-center gap-1"><Lightbulb size={12} />{idea.requests ?? "?"} asking</span>
                                <span className="flex items-center gap-1"><Heart size={12} />{(idea.likes ?? 0).toLocaleString("en")} likes</span>
                              </div>
                              {(idea.examples ?? []).slice(0, 2).map((ex, j) => (
                                <p key={j} className="mt-2 border-l border-accent/40 pl-2 text-[12.5px] italic text-ink-3">“{ex}”</p>
                              ))}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                  <div className="mt-6 border-t border-line pt-5">
                    <h3 className="mb-1 text-[14px] font-semibold text-ink">Unanswered questions</h3>
                    <p className="mb-3 text-[12.5px] text-ink-3">Most-liked viewer questions from the last 6 months with no reply from the creator, by topic. Ready-made video ideas.</p>
                    <QuestionsList questions={questions} />
                  </div>
                </Panel>
              </Reveal>
            );
          })}
        </div>
      )}
    </>
  );
}
