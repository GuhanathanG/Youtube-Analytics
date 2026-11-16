import "server-only";
import { refreshStored, sizedAge } from "./stored";
import { MOVES_AGE, nextMoves } from "./recommendations";
import { computeRadar } from "./radar";
import { computeChannelVisual } from "./channel-visual";
import { computeQuestions } from "./creator-insights";

/**
 * The engine keeps every per-channel section fresh, not only the ones on the channel page: Next moves (Overview
 * and the Next moves page share it), Radar, the channel timeline and the questions board. Without this they were
 * only refreshed when someone opened them, so a section nobody had opened for a day showed day-old results.
 */
export async function warmExtras(channelId: string, timeLeft: () => boolean, ownChannel: boolean): Promise<number> {
  const jobs: [string, number, () => Promise<unknown>][] = [
    [`chvis:${channelId}`, Number(process.env.CHANNEL_VISUAL_SECONDS ?? 1800) * 1000, () => computeChannelVisual(channelId)],
    [`questions:${channelId}:40`, await sizedAge(channelId, 30 * 60_000), () => computeQuestions(channelId, 40)],
  ];
  if (ownChannel) {
    jobs.push([`moves:${channelId}`, MOVES_AGE(), () => nextMoves(channelId)]);
    jobs.push([`radar:${channelId}`, Number(process.env.RADAR_CACHE_SECONDS ?? 1800) * 1000, () => computeRadar(channelId)]);
  }
  let n = 0;
  for (const [key, age, fn] of jobs) {
    if (!timeLeft()) break;
    if (await refreshStored(key, age, fn).catch((e) => { console.log("[warm]", key, e instanceof Error ? e.message : e); return false; })) n++;
  }
  return n;
}
