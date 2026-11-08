import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "yt3.ggpht.com" },
      { protocol: "https", hostname: "i.ytimg.com" },
    ],
  },
  poweredByHeader: false,
  experimental: {
    // Pages you've just seen are reused when you go back to them (no wait), and pages fetched ahead of
    // time stay usable for 3 minutes. Live mode refreshes the page you're on every minute anyway.
    staleTimes: { dynamic: 30, static: 180 },
  },
  async headers() {
    // Content Security Policy: only this site's scripts, YouTube's player in an iframe, and
    // YouTube's thumbnail hosts for images. 'unsafe-inline' is needed by Next.js's inline bootstrap.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://yt3.ggpht.com https://yt3.googleusercontent.com https://i.ytimg.com https://*.cdninstagram.com https://*.fbcdn.net",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-src https://www.youtube-nocookie.com https://www.youtube.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ");
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      ],
    }];
  },
};

export default nextConfig;
