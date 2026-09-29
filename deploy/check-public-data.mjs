import { execFileSync } from "node:child_process";

// This repository carries source and explicitly fictional Duck fixtures only.
// Inspect the Git index so `git add -f` cannot bypass the CI check.
const paths = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const publicData = /^(?:data\/(?:catalog\.(?:json|html)|availability-matrix\.json|schema\.sql)|data\/images\/[^/]+\.(?:png|jpe?g|webp|svg|gif))$/i;
const privateFiles = paths.filter(path =>
  (path.startsWith("data/") && !publicData.test(path)) ||
  /\.(?:bak|mdf|ldf|dump|sqlite(?:-[^/]*)?|sqlite\.tmp|db|tsv(?:\.gz)?|csv(?:\.gz)?)$/i.test(path) ||
  /(?:^|\/)\.env(?:\.[^/]*)?$/.test(path) ||
  (path.startsWith(".local-duck/") && path !== ".local-duck/live-connection.example.json") ||
  path.startsWith(".local-glacier/") ||
  path === "deploy/private-crm.env"
);

if (privateFiles.length) {
  console.error("Private data must stay outside this public repository:\n" + privateFiles.map(path => `  ${path}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Public data check passed: no tracked customer exports, databases or private connection files.");
}
