"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Keeps Glance current: refresh every minute, and straight away when the app comes back to the front. */
export function GlanceRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, seconds * 1000);
    const onShow = () => { if (document.visibilityState === "visible") router.refresh(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onShow); };
  }, [router, seconds]);
  return null;
}
