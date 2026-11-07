import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-[50vh] place-items-center text-center">
      <div>
        <div className="label">404</div>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold">Signal lost</h1>
        <p className="mt-2 text-ink-3">That channel or video isn&apos;t in the database.</p>
        <Link href="/" className="mt-5 inline-block rounded-xl border border-line px-4 py-2 text-[14px] hover:border-accent/50">Back to overview</Link>
      </div>
    </div>
  );
}
