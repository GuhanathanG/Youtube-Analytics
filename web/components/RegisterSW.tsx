"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Registers the service worker (installable app, instant pages, offline page, notifications).
 * Instant pages: the service worker may show the last saved copy of a page at once; here we ask it
 * whether it did, and when the fresh page has arrived we swap in its data (router.refresh()).
 * On the sign-in page every saved copy is deleted, so nothing private stays after signing out.
 */
export function RegisterSW() {
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (path.startsWith("/login")) {
      try { void caches.delete("pulse-pages-v1"); void caches.delete("pulse-pages-v2"); } catch { /* storage blocked */ }
      return;
    }
    const sw = navigator.serviceWorker.controller;
    if (!sw) return;
    const ch = new MessageChannel();
    ch.port1.onmessage = (e: MessageEvent<{ fromCache?: boolean; fresh?: boolean; signedOut?: boolean }>) => {
      if (e.data?.signedOut) window.location.href = "/login";
      else if (e.data?.fromCache && e.data.fresh) router.refresh();
    };
    sw.postMessage({ type: "check", url: window.location.href }, [ch.port2]);
    return () => ch.port1.close();
    // Only for the page the app was opened on; later moves inside the app don't go through the saved copies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
