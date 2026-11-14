/**
 * Engine freshness rules (pure, unit-tested): each engine "should have run within" a limit.
 * Amber once past the limit, red past twice the limit (or when work is clearly stuck).
 */
export type EngineKey = "live" | "job" | "yt_comments" | "yt_stats" | "ig_profiles" | "ig_comments" | "ai" | "forecasts" | "video_ai" | "transcripts";
export type EngineState = "ok" | "warn" | "bad" | "idle";
export type EngineCheck = { key: EngineKey; label: string; what: string; ageMin: number | null; limitMin: number; stuck?: number; state: EngineState; note: string };

export const RULES: Record<EngineKey, { label: string; what: string; limitMin: number }> = {
  live: { label: "Live engine", what: "the 2-minute timer that checks for new comments", limitMin: 15 },
  job: { label: "Background job", what: "history download, bulk AI and archive (GitHub)", limitMin: 120 },
  yt_comments: { label: "YouTube comments", what: "newest comment saved", limitMin: 60 },
  yt_stats: { label: "YouTube stats", what: "subscribers and views snapshot", limitMin: 180 },
  ig_profiles: { label: "Instagram profiles", what: "followers and newest posts", limitMin: 240 },
  ig_comments: { label: "Instagram comments", what: "comments on posts from the last 3 days", limitMin: 360 },
  ai: { label: "AI reading", what: "oldest comment still waiting for the AI", limitMin: 120 },
  forecasts: { label: "Prediction engine", what: "nightly training and forecasts", limitMin: 26 * 60 },
  video_ai: { label: "Video analysis", what: "new uploads waiting for the AI to watch them", limitMin: 12 * 60 },
  transcripts: { label: "Transcripts", what: "spoken words of new uploads", limitMin: 12 * 60 },
};

/**
 * ageMin: minutes since the engine last did its work (null = never / nothing to do).
 * stuck: items waiting longer than the limit (for queue-style engines); any stuck item makes it at least amber.
 */
export function judge(key: EngineKey, ageMin: number | null, stuck = 0, idleNote = "nothing to do yet"): EngineCheck {
  const r = RULES[key];
  let state: EngineState;
  if (ageMin === null && !stuck) state = "idle";
  else if (stuck > 0) state = ageMin !== null && ageMin > r.limitMin * 2 ? "bad" : "warn";
  else if (ageMin === null) state = "idle";
  else state = ageMin <= r.limitMin ? "ok" : ageMin <= r.limitMin * 2 ? "warn" : "bad";
  const note = state === "idle" ? idleNote
    : stuck ? `${stuck} waiting longer than ${fmtMin(r.limitMin)}`
    : `last ${fmtMin(ageMin ?? 0)} ago (should be within ${fmtMin(r.limitMin)})`;
  return { key, label: r.label, what: r.what, ageMin, limitMin: r.limitMin, stuck, state, note };
}

export function fmtMin(m: number): string {
  if (m < 1) return "under a minute";
  if (m < 90) return `${Math.round(m)} min`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} days`;
}

/** Overall: the worst engine wins (idle doesn't count). */
export function overall(checks: EngineCheck[]): EngineState {
  if (checks.some((c) => c.state === "bad")) return "bad";
  if (checks.some((c) => c.state === "warn")) return "warn";
  return "ok";
}
