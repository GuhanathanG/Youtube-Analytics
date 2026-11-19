import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-[55vh] place-items-center text-center">
      <div>
        <div className="login-orb err mx-auto" aria-hidden><i /><i /><i /><b /></div>
        <div className="mt-8 font-mono text-[11px] uppercase tracking-[0.14em] text-neg">■ 404</div>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-[38px] font-extrabold">Signal lost</h1>
        <p className="mt-3 text-[15px] text-ink-2">That channel or video isn&apos;t in the database.</p>
        <Link href="/" className="pill pill-solid mt-7"><span className="sq" /> Back to overview</Link>
      </div>
    </div>
  );
}
