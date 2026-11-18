
export const metadata = { title: "Signal · concept" };

/** UI rebuild R0: the "Signal" concept, on live data, beside the current site. */
export default function ConceptLayout({ children }: { children: React.ReactNode }) {
  return <div className="sig sig-page">{children}</div>;
}
