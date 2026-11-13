/** Colour tokens shared by every viz component (own module so components can import it without a cycle through index). */
export const C = {
  accent: "#22d3ee", ai: "#8b7cf6", gold: "#fab219", good: "#0ca30c", bad: "#e66767",
  pos: "#3987e5", neu: "#8a8f9c", neg: "#e66767", yt: "#ff3b4a", ig: "#e1306c", ig2: "#f77737",
};

/** "× normal" colour: cyan under 5×, violet 5-10×, gold 10×+, red when below normal. */
export function multColor(x: number) { return x >= 10 ? C.gold : x >= 5 ? C.ai : x >= 1 ? C.accent : C.bad; }
