import type { MetadataRoute } from "next";

/** 9. Installable app: "Add to Home screen" on phones gives a full-screen Creator Pulse with its own icon. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Creator Pulse", short_name: "Pulse",
    description: "Audience intelligence for the creators you watch.",
    start_url: "/", scope: "/", display: "standalone", orientation: "portrait",
    background_color: "#0c0c0d", theme_color: "#0c0c0d",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
