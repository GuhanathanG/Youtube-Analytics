/**
 * What-if estimate for a draft, from the prediction engine's small linear model (worker: ytanalytics/model.py
 * fit_linear). Pure, so it's unit-tested; the features must match the Python ones exactly.
 */
export type LinearModel = { features: string[]; mean: number[]; scale: number[]; coef: number[]; intercept: number; baseline: number | null };
export type Draft = { title: string; short: boolean; minutes: number; day: number; hour: number }; // day 0 = Monday, hour in India time

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

export function draftFeatures(d: Draft): Record<string, number> {
  const t = d.title ?? "";
  const words = t.split(/\s+/).filter(Boolean);
  const hour = d.hour + 0.5;
  return {
    is_short: d.short ? 1 : 0,
    log_minutes: Math.log1p(d.short ? Math.min(d.minutes, 3) : d.minutes),
    title_len: t.length,
    has_number: /\d/.test(t) ? 1 : 0,
    has_question: t.includes("?") ? 1 : 0,
    has_exclaim: t.includes("!") ? 1 : 0,
    has_emoji: EMOJI.test(t) ? 1 : 0,
    has_brackets: /[[({]/.test(t) ? 1 : 0,
    has_caps_word: words.some((w) => w.length >= 3 && /^[A-Za-z]+$/.test(w) && w === w.toUpperCase()) ? 1 : 0,
    has_pipe: /[|–—-]/.test(t) ? 1 : 0,
    hour_sin: Math.sin((2 * Math.PI * hour) / 24),
    hour_cos: Math.cos((2 * Math.PI * hour) / 24),
    is_weekend: d.day >= 5 ? 1 : 0,
    log_age: Math.log1p(30),
  };
}

/** Expected 30-day views as a multiple of the channel's normal, and in views when the normal is known. */
export function estimateDraft(m: LinearModel, d: Draft): { multiple: number; views: number | null } {
  const f = draftFeatures(d);
  let y = m.intercept;
  m.features.forEach((name, i) => { y += m.coef[i] * (((f[name] ?? m.mean[i]) - m.mean[i]) / (m.scale[i] || 1)); });
  const multiple = Math.exp(y);
  return { multiple, views: m.baseline ? Math.round(m.baseline * multiple) : null };
}
