// Exact-SHA gate for the public repository; optional token raises API rate limits.
const sha = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(sha ?? "")) throw new Error("Expected a Git commit SHA");
try {
  const response = await fetch(`https://api.github.com/repos/JOHN-CRM-LTD/duck-fashion-server/actions/workflows/ci.yml/runs?event=push&branch=main&head_sha=${sha}&per_page=10`, {
    headers: { Accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
    signal: AbortSignal.timeout(15000), redirect: "error",
  });
  if (!response.ok) throw new Error(`GitHub CI lookup returned ${response.status}`);
  const data = await response.json();
  const latest = data.workflow_runs.filter(run => run.head_sha === sha && run.event === "push" && run.head_branch === "main")
    .sort((a, b) => b.id - a.id)[0];
  if (!latest || latest.status !== "completed" || latest.conclusion !== "success") throw new Error("The latest CI run for this exact main commit has not succeeded");
  console.log(`CI passed for ${sha.slice(0, 12)}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
