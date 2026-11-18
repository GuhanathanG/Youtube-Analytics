import { preconnect } from "react-dom";
import type { Metadata, Viewport } from "next";
import { DM_Mono, Inter_Tight, Syne } from "next/font/google";
import "./globals.css";
import { RegisterSW } from "@/components/RegisterSW";

// Signal type system: Syne (wide display), Inter Tight (body), DM Mono (labels and small numbers).
const display = Syne({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--f-display", display: "swap" });
const body = Inter_Tight({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--f-body", display: "swap" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--f-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Creator Pulse", template: "%s · Creator Pulse" },
  description: "Audience intelligence for the creators you watch: every comment, every language, read by AI.",
  robots: { index: false, follow: false },
  icons: { apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Pulse", statusBarStyle: "black-translucent" },
};

// viewportFit "cover": on iPhones the app fills the screen behind the notch and home bar; the
// safe-* classes (globals.css) keep the top bar and bottom menu clear of them.
export const viewport: Viewport = { themeColor: "#07070a", colorScheme: "dark", viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Start connecting to the thumbnail servers while the page is still loading, so images arrive sooner.
  preconnect("https://i.ytimg.com");
  preconnect("https://yt3.ggpht.com");
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <div className="backdrop" aria-hidden />
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
