/**
 * Safety net: a database query that fails after its page already gave up on it (e.g. stopped by the
 * 25-second database time limit) must not crash the whole server process — that would break every
 * other page being served by the same process at that moment. Log it instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./instrumentation-node");
}
