"use client";

import dynamic from "next/dynamic";

/**
 * Charts load their drawing library (recharts, the biggest piece of the site) only after the page
 * shows, so pages appear sooner. A soft placeholder holds the space meanwhile.
 */
const box = (h: number) => function ChartLoading() {
  return <div className="animate-pulse rounded-xl bg-white/[0.03]" style={{ height: h }} />;
};

export const TrendChart = dynamic(() => import("./TrendChart").then((m) => m.TrendChart), { ssr: false, loading: box(280) });
export const GrowthChart = dynamic(() => import("./GrowthChart").then((m) => m.GrowthChart), { ssr: false, loading: box(200) });
export const AspectChart = dynamic(() => import("./AspectChart").then((m) => m.AspectChart), { ssr: false, loading: box(240) });
export const CompareChart = dynamic(() => import("./CompareChart").then((m) => m.CompareChart), { ssr: false, loading: box(320) });
export const TopicChart = dynamic(() => import("./TopicChart").then((m) => m.TopicChart), { ssr: false, loading: box(260) });
