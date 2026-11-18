/** Colour tokens shared by every viz component (own module so components can import it without a cycle through index). */
export const C = {
  accent: "#22e1ff", ai: "#8b7cf6", gold: "#fab219", good: "#0ca30c", bad: "#ff3d7f",
  pos: "#22e1ff", neu: "#8a8a93", neg: "#ff3d7f", yt: "#ff3b4a", ig: "#e1306c", ig2: "#f77737",
};

/** "× normal" colour: cyan under 5×, violet 5-10×, gold 10×+, red when below normal. */
export function multColor(x: number) { return x >= 10 ? C.gold : x >= 5 ? C.ai : x >= 1 ? C.accent : C.bad; }
