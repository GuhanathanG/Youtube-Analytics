import { DM_Mono, Inter_Tight, Syne } from "next/font/google";
import "./signal.css";

const display = Syne({ subsets: ["latin"], weight: ["700", "800"], variable: "--f-display", display: "swap" });
const body = Inter_Tight({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--f-body", display: "swap" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--f-mono", display: "swap" });

export const metadata = { title: "Signal · concept" };

/** UI rebuild R0: the "Signal" concept, on live data, beside the current site. */
export default function ConceptLayout({ children }: { children: React.ReactNode }) {
  return <div className={`sig ${display.variable} ${body.variable} ${mono.variable}`}>{children}</div>;
}
