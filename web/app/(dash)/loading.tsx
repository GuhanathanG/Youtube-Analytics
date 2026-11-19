export default function Loading() {
  return (
    <div className="space-y-6 pt-2" aria-busy="true" aria-label="Loading">
      <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-accent"><span className="live" />Loading</div>
      <div className="skel h-12 w-80 max-w-full" />
      <div className="skel h-4 w-[34rem] max-w-full" />
      <div className="grid grid-cols-2 border-l border-t border-line lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-32 border-b border-r border-line p-5"><div className="skel h-3 w-24" /><div className="skel mt-6 h-8 w-28" /></div>)}
      </div>
      <div className="skel h-72" />
    </div>
  );
}
