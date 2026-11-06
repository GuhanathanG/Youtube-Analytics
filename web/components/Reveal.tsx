import type { ReactNode } from "react";

/** Fades content up into place (pure CSS: no animation library to download or run on phones).
 *  Children with `delay` create a gentle stagger. People who prefer reduced motion see no animation. */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <div className={`reveal ${className ?? ""}`} style={delay ? { animationDelay: `${Math.min(delay, 0.3)}s` } : undefined}>
      {children}
    </div>
  );
}
