"use client";

import { useEffect, useState } from "react";

/** Sticky jump chips for long pages; the chip of the section on screen lights up and slides into view. */
export function SectionNav({ items }: { items: { id: string; label: string }[] }) {
  const [active, setActive] = useState(items[0]?.id);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => {
      const seen = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (seen) setActive(seen.target.id);
    }, { rootMargin: "-30% 0px -60% 0px" });
    items.forEach((i) => { const el = document.getElementById(i.id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, [items]);
  useEffect(() => { document.getElementById(`sn-${active}`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }); }, [active]);
  return (
    <nav aria-label="On this page" className="sticky top-[76px] z-10 -mx-1 mb-4 flex gap-1.5 overflow-x-auto rounded-2xl border border-line bg-[#05070d]/75 p-1.5 backdrop-blur-xl scrollbar-thin">
      {items.map((i) => (
        <a key={i.id} id={`sn-${i.id}`} href={`#${i.id}`}
          className={`shrink-0 rounded-xl px-3 py-1.5 text-[12.5px] transition ${active === i.id ? "bg-accent/15 text-accent shadow-[0_0_14px_-4px_#22d3ee]" : "text-ink-2 hover:text-ink"}`}>
          {i.label}
        </a>
      ))}
    </nav>
  );
}
