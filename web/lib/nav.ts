/**
 * The site's navigation: 5 hubs, each answering one question, with its pages as tabs (docs/UI_UX_REVAMP.md §4).
 * Page URLs stay the same as before, so old links and bookmarks keep working.
 * No React/Next imports: icons are named here and resolved in the Shell, so this can be tested on its own.
 */
export type NavPage = { href: string; label: string; icon: string };
export type Hub = { key: string; label: string; question: string; icon: string; color: string; pages: NavPage[] };

export const HUBS: Hub[] = [
  { key: "pulse", label: "Pulse", question: "What's happening and what should I do?", icon: "Activity", color: "#22d3ee", pages: [
    { href: "/", label: "Overview", icon: "LayoutDashboard" },
    { href: "/command", label: "Next moves", icon: "Rocket" },
    { href: "/glance", label: "Glance", icon: "Gauge" },
  ] },
  { key: "audience", label: "Audience", question: "Who are they and what do they say?", icon: "Users", color: "#3987e5", pages: [
    { href: "/comments", label: "Comments", icon: "MessageSquareText" },
    { href: "/ask", label: "Ask AI", icon: "Sparkles" },
  ] },
  { key: "performance", label: "Performance", question: "How are my videos doing and why?", icon: "TrendingUp", color: "#0ca30c", pages: [
    { href: "/analytics", label: "Analytics", icon: "ChartNoAxesCombined" },
    { href: "/predict", label: "Predict", icon: "BrainCircuit" },
    { href: "/growth", label: "Growth & goals", icon: "Target" },
  ] },
  { key: "market", label: "Market", question: "What's working around me?", icon: "Globe", color: "#8b7cf6", pages: [
    { href: "/outliers", label: "Outliers", icon: "Flame" },
    { href: "/keywords", label: "Keywords", icon: "Search" },
    { href: "/platforms", label: "YT vs IG", icon: "Columns2" },
    { href: "/radar", label: "Radar", icon: "Radar" },
    { href: "/compare", label: "Compare", icon: "GitCompareArrows" },
  ] },
  { key: "create", label: "Create", question: "What should I make next?", icon: "Clapperboard", color: "#fab219", pages: [
    { href: "/studio", label: "Studio", icon: "Clapperboard" },
    { href: "/ideas", label: "Ideas", icon: "Lightbulb" },
  ] },
];

/** Pages reached from the account menu, not a hub. */
export const ACCOUNT_PAGES: NavPage[] = [{ href: "/manage", label: "Manage & settings", icon: "Settings2" }];

export const pageMatches = (href: string, path: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

/** The hub a page belongs to (null for channel/video/people pages and settings). */
export function hubOf(path: string): Hub | null {
  return HUBS.find((h) => h.pages.some((p) => pageMatches(p.href, path))) ?? null;
}
