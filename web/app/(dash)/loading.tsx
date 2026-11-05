export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-10 w-72 animate-pulse rounded-xl bg-white/[0.05]" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-white/[0.04]" />)}
      </div>
      <div className="h-80 animate-pulse rounded-2xl bg-white/[0.04]" />
    </div>
  );
}
