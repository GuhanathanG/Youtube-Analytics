import "server-only";

/**
 * Optional: start the full background job (history download + bulk analysis) from the
 * website. Needs a GitHub token with "Actions: Read and write" on this repository,
 * stored in Vercel as GITHUB_TOKEN.
 */
const REPO = process.env.GITHUB_REPO ?? "GuhanathanG/Youtube-Analytics";
const WORKFLOW = "sync.yml";

export const githubConfigured = () => !!process.env.GITHUB_TOKEN;

async function gh(path: string, init?: RequestInit) {
  return fetch(`${process.env.GITHUB_API_BASE ?? "https://api.github.com"}/repos/${REPO}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "creator-pulse",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
}

export async function startFullSync(): Promise<{ ok: boolean; message: string }> {
  if (!githubConfigured()) return { ok: false, message: "Add GITHUB_TOKEN in Vercel to start runs from here." };
  const res = await gh(`/actions/workflows/${WORKFLOW}/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main" }) });
  if (res.status === 204) return { ok: true, message: "Full sync started. It usually takes 3–10 minutes." };
  if (res.status === 401 || res.status === 403) return { ok: false, message: "GitHub refused the token. Check it has Actions: Read and write on this repository." };
  return { ok: false, message: `GitHub said ${res.status}: ${(await res.text()).slice(0, 160)}` };
}

/** Start the background job when GitHub's own scheduler has skipped it (it often delays or drops runs). */
export async function kickBackgroundJob(maxGapMinutes = Number(process.env.JOB_MAX_GAP_MINUTES ?? 35)): Promise<string> {
  if (!githubConfigured()) return "no GITHUB_TOKEN";
  const runs = await recentRuns(3);
  if (!runs) return "couldn't read runs";
  if (runs.some((r) => r.status === "in_progress" || r.status === "queued")) return "running";
  const last = runs[0] ? Date.parse(runs[0].created_at) : 0;
  if (Date.now() - last < maxGapMinutes * 60_000) return "recent";
  const res = await startFullSync();
  return res.ok ? "started" : `not started: ${res.message}`;
}

export type RunInfo = { status: string; conclusion: string | null; created_at: string; html_url: string; event: string };

export async function recentRuns(limit = 5): Promise<RunInfo[] | null> {
  if (!githubConfigured()) return null;
  const res = await gh(`/actions/workflows/${WORKFLOW}/runs?per_page=${limit}`);
  if (!res.ok) return null;
  const data = await res.json();
  return (data.workflow_runs ?? []).map((r: RunInfo) => ({
    status: r.status, conclusion: r.conclusion, created_at: r.created_at, html_url: r.html_url, event: r.event,
  }));
}
