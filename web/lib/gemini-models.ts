/** Pick usable Gemini text models from Google's model list: Flash-Lite first (most free requests),
 *  then Flash; newest first; previews last. */
const SKIP = ["image", "tts", "audio", "live", "embedding", "vision", "thinking", "robotics", "computer-use", "omni"];

export function pickGeminiModels(models: { name?: string; supportedGenerationMethods?: string[] }[]): string[] {
  const names = models.map((m) => String(m.name ?? "").replace(/^models\//, ""))
    .filter((n, i) => (models[i].supportedGenerationMethods ?? []).includes("generateContent")
      && n.startsWith("gemini-") && n.includes("flash") && !SKIP.some((w) => n.includes(w)));
  const rank = (n: string): [number, number, number, string] => {
    const v = /gemini-(\d+(?:\.\d+)?)/.exec(n);
    return [n.includes("lite") ? 0 : 1, /preview|exp/.test(n) ? 1 : 0, v ? -Number(v[1]) : 0, n];
  };
  return [...new Set(names)].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    for (let i = 0; i < 4; i++) if (ra[i] !== rb[i]) return ra[i] < rb[i] ? -1 : 1;
    return 0;
  }).slice(0, 5);
}

