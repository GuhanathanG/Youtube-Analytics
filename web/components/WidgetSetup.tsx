"use client";

import { Copy, RefreshCw, Smartphone } from "lucide-react";
import { useState, useTransition } from "react";
import { rotateWidgetKey } from "@/app/actions";

/** Manage → iPhone widget: copy the ready-made Scriptable script, or replace its key. */
export function WidgetSetup({ script }: { script: string }) {
  const [text, setText] = useState(script);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setMsg("Copied. Paste it into a new Scriptable script."); }
    catch { setMsg("Couldn't copy automatically: select the text below and copy it."); }
  };
  return (
    <div>
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-[13px] text-ink-2">
        <li>Install <b>Scriptable</b> (free) from the App Store.</li>
        <li>Tap <b>Copy widget script</b> below, open Scriptable, tap <b>+</b>, paste, and name it “Pulse”.</li>
        <li>Long-press your home screen → <b>+</b> → <b>Scriptable</b> → pick a size → <b>Add widget</b>. Tap the widget once, set Script to <b>Pulse</b>.</li>
        <li>Optional: in the widget’s <b>Parameter</b>, type a channel id (from its page address) to show just that channel.</li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <button onClick={copy} className="inline-flex items-center gap-2 rounded-xl bg-accent/15 px-4 py-2.5 text-[14px] font-medium text-ink hover:bg-accent/25">
          <Copy size={15} />Copy widget script
        </button>
        <button disabled={pending} onClick={() => start(async () => { setText(await rotateWidgetKey()); setMsg("New key made. Old widgets stop working; copy the script again."); })}
          className="inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-[13px] text-ink-2 hover:text-ink disabled:opacity-50">
          <RefreshCw size={14} className={pending ? "animate-spin" : ""} />Replace key
        </button>
      </div>
      {msg && <p className="mt-2 text-[12.5px] text-accent" aria-live="polite">{msg}</p>}
      <details className="mt-3">
        <summary className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-ink-3"><Smartphone size={13} />Show the script</summary>
        <textarea readOnly value={text} rows={8} className="mt-2 w-full rounded-xl border border-line bg-black/30 p-3 font-mono text-[11px] text-ink-2" />
      </details>
    </div>
  );
}
