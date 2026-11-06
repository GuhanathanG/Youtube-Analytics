import type { Metadata, Viewport } from "next";

// Pulse Glance is its own home-screen app: Safari → Share → Add to Home Screen *on this page*
// gives a separate icon that opens straight into the glance view.
export const metadata: Metadata = {
  title: "Glance",
  manifest: "/glance.webmanifest",
  appleWebApp: { capable: true, title: "Glance", statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = { themeColor: "#03040a", colorScheme: "dark", viewportFit: "cover" };
export const dynamic = "force-dynamic";

export default function GlanceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
