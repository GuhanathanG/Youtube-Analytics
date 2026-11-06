/** Node-only part of instrumentation.ts (see there). */
const g = globalThis as { __pulseGuard?: boolean };
if (!g.__pulseGuard) {
  g.__pulseGuard = true;
  process.on("unhandledRejection", (reason) => {
    console.warn("[unhandled]", reason instanceof Error ? reason.message : reason);
  });
}
export {};
