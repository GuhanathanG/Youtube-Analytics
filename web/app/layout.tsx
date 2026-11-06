import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-grotesk", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-face", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Creator Pulse", template: "%s · Creator Pulse" },
  description: "Audience intelligence for the creators you watch: every comment, every language, read by AI.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#05070d", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${grotesk.variable} ${mono.variable}`}>
      <body>
        <div className="backdrop" aria-hidden>
          <div className="blob" style={{ left: "-15%", top: "-25%", background: "#22d3ee" }} />
          <div className="blob" style={{ right: "-20%", top: "10%", background: "#8b7cf6", animationDelay: "-9s" }} />
        </div>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
