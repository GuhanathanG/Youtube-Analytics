"use client";
import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="no-print inline-flex items-center gap-2 rounded-xl border border-line-2 px-3.5 py-2 text-[13.5px] text-ink hover:border-accent/50">
      <Printer size={15} />Save as PDF / print
    </button>
  );
}
