import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { RegisterSW } from "@/components/RegisterSW";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif-face", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-face", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Creator Pulse", template: "%s · Creator Pulse" },
  description: "Audience intelligence for the creators you watch: every comment, every language, read by AI.",
  robots: { index: false, follow: false },
  icons: { apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Pulse", statusBarStyle: "black-translucent" },
};

// viewportFit "cover": on iPhones the app fills the screen behind the notch and home bar; the
// safe-* classes (globals.css) keep the top bar and bottom menu clear of them.
export const viewport: Viewport = { themeColor: "#0c0c0d", colorScheme: "dark", viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${serif.variable} ${mono.variable}`}>
      <body>
        <div className="backdrop" aria-hidden>
          <div className="blob" style={{ left: "-15%", top: "-25%", background: "#c8a97e" }} />
          <div className="blob" style={{ right: "-20%", top: "10%", background: "#9c8467", animationDelay: "-9s" }} />
        </div>
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
