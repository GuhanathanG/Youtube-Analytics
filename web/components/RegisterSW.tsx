"use client";
import { useEffect } from "react";

/** Registers the service worker (installable app, offline page, notifications). */
export function RegisterSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
