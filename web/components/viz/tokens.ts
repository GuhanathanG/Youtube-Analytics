/** Colour tokens shared by every viz component (own module so components can import it without a cycle through index). */
export const C = {
  accent: "#22e1ff", ai: "#b4b4bb", gold: "#fab219", good: "#22e1ff", bad: "#ff3d7f",
  pos: "#22e1ff", neu: "#8a8a93", neg: "#ff3d7f", yt: "#ff3b4a", ig: "#e1306c", ig2: "#f77737",
};

/** "× normal" colour (Signal): magenta for breakouts (3×+), cyan at or above normal, grey below. */
export function multColor(x: number) { return x >= 3 ? "#ff3d7f" : x >= 1 ? C.accent : "#8a8a93"; }
