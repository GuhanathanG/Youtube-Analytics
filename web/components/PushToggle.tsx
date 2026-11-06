"use client";
import { Bell, BellOff, Send } from "lucide-react";
import { useEffect, useState } from "react";

function keyBytes(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Turn phone/browser notifications for alerts on or off on this device. */
export function PushToggle({ devices }: { devices: number }) {
  const [state, setState] = useState<"loading" | "unsupported" | "off" | "on" | "blocked">("loading");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return setState("unsupported");
      if (Notification.permission === "denied") return setState("blocked");
      const reg = await navigator.serviceWorker.ready;
      setState((await reg.pushManager.getSubscription()) ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function enable() {
    setMsg("");
    try {
      if ((await Notification.requestPermission()) !== "granted") return setState("blocked");
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await (await fetch("/api/push")).json();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      const res = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON() }) });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not save");
      setState("on"); setMsg("Notifications are on for this device.");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Something went wrong"); }
  }
  async function disable() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setState("off"); setMsg("Notifications are off for this device.");
  }
  async function test() {
    const r = await (await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ test: true }) })).json();
    setMsg(r.sent ? `Test sent to ${r.sent} device${r.sent === 1 ? "" : "s"}.` : "No device received it. Turn notifications on first.");
  }

  const btn = "inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-[13.5px]";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {state === "off" && <button onClick={enable} className={`${btn} border-accent/40 bg-accent/10 text-accent`}><Bell size={15} />Turn on notifications on this device</button>}
        {state === "on" && <button onClick={disable} className={`${btn} border-line text-ink-2`}><BellOff size={15} />Turn off on this device</button>}
        {state === "on" && <button onClick={test} className={`${btn} border-line text-ink-2`}><Send size={15} />Send a test</button>}
        <span className="text-[12.5px] text-ink-3">{devices} device{devices === 1 ? "" : "s"} subscribed</span>
      </div>
      {state === "unsupported" && <p className="text-[13px] text-ink-2">This browser can&apos;t receive notifications. On iPhone, first add the site to your Home Screen (Share → Add to Home Screen), then open it from there.</p>}
      {state === "blocked" && <p className="text-[13px] text-ink-2">Notifications are blocked for this site. Allow them in your browser&apos;s site settings, then reload.</p>}
      {msg && <p className="text-[13px] text-ink-2">{msg}</p>}
    </div>
  );
}
