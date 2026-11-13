#!/usr/bin/env node
// Writes the draft release notes for a Hopper release (Markdown, to stdout).
//
//   node scripts/release-notes.mjs --version 0.3.331 [--previous v0.3.300] [--ipk name.ipk]
//
// The notes list the pull requests merged into main since the previous release tag (or since
// the start of history for the first release). Each pull request's "## Release note" section
// (.github/pull_request_template.md) gives its line and section:
//   New: ... / Changed: ...   -> New and improved
//   Fixed: ...                -> Fixed
//   None                      -> Behind the scenes, under the pull request's title
// A pull request without one (older ones) is sorted by its labels and those of the issues it
// closes or is part of: bug -> Fixed, enhancement or accessibility -> New and improved, a title
// starting "Fix" -> Fixed, anything else -> Behind the scenes.
//
// Needs the GitHub CLI (`gh`), signed in or given GH_TOKEN, and a clone with full history.
import { execFileSync } from "node:child_process";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => {
  if (arg.startsWith("--")) pairs.push([arg.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]);
  return pairs;
}, []));
const version = args.version;
if (!version) { console.error("--version is required"); process.exit(1); }

const run = (cmd, cmdArgs) => execFileSync(cmd, cmdArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const repo = process.env.GITHUB_REPOSITORY || run("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
const api = path => JSON.parse(run("gh", ["api", path]));

// The previous release: the newest v* tag reachable from HEAD, unless given.
let previous = args.previous;
if (!previous) {
  try { previous = run("git", ["describe", "--tags", "--abbrev=0", "--match", "v*", "HEAD"]); } catch { previous = ""; }
}
const range = previous ? `${previous}..HEAD` : "HEAD";

// Pull requests merged on main's first-parent line: merge commits, or squash commits ending "(#n)".
const subjects = run("git", ["log", "--first-parent", "--pretty=%s", range]).split("\n").filter(Boolean);
const numbers = [];
for (const subject of subjects) {
  const match = subject.match(/^Merge pull request #(\d+)/) ?? subject.match(/\(#(\d+)\)$/);
  if (match && !numbers.includes(Number(match[1]))) numbers.push(Number(match[1]));
}

const issueLabels = new Map();
const labelsOfIssue = number => {
  if (!issueLabels.has(number)) {
    try { issueLabels.set(number, api(`repos/${repo}/issues/${number}`).labels.map(label => label.name)); } catch { issueLabels.set(number, []); }
  }
  return issueLabels.get(number);
};

/** The first line of the body's "## Release note" section, without HTML comments. */
function releaseNote(body) {
  const section = body.replace(/<!--[\s\S]*?-->/g, "").match(/^##\s*Release note\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im);
  const line = section?.[1].split("\n").map(text => text.trim()).find(Boolean);
  if (!line) return null;
  if (/^none\.?$/i.test(line)) return { kind: "none" };
  const typed = line.match(/^(new|changed|fixed)\s*:\s*(.+)$/i);
  if (!typed) return { kind: "new", text: line };
  return { kind: typed[1].toLowerCase() === "fixed" ? "fixed" : "new", text: typed[2].trim() };
}

const sections = { new: [], fixed: [], behind: [] };
for (const number of numbers.sort((a, b) => a - b)) {
  let pr;
  try { pr = api(`repos/${repo}/pulls/${number}`); } catch { continue; }
  if (!pr.merged_at) continue;
  const linked = [...(pr.body ?? "").matchAll(/\b(?:Fixes|Closes|Resolves|Part of)\s+#(\d+)/gi)].map(m => Number(m[1]));
  const labels = new Set([...pr.labels.map(label => label.name), ...linked.flatMap(labelsOfIssue)]);
  const title = pr.title.replace(/\s*\(#\d+(?:,\s*#\d+)*\)\s*$/, "").trim();
  const closes = [...new Set(linked)].map(n => `#${n}`).join(", ");
  const refs = `(#${number}${closes ? `; ${closes}` : ""})`;
  const note = releaseNote(pr.body ?? "");
  if (note) {
    if (note.kind === "fixed") sections.fixed.push(`- ${note.text} ${refs}`);
    else if (note.kind === "none") sections.behind.push(`- ${title} ${refs}`);
    else sections.new.push(`- ${note.text} ${refs}`);
    continue;
  }
  const line = `- ${title} ${refs}`;
  if (labels.has("bug")) sections.fixed.push(line);
  else if (labels.has("enhancement") || labels.has("accessibility")) sections.new.push(line);
  else if (/^fix\b/i.test(title)) sections.fixed.push(line);
  else sections.behind.push(line);
}

const ipk = args.ipk || `com.hopperapp.hopper_${version}_all.ipk`;
const out = [];
out.push("## Highlights", "", "<!-- Before publishing: two or three lines on what viewers will notice. Delete this comment. -->", "");
if (sections.new.length) out.push("## New and improved", "", ...sections.new, "");
if (sections.fixed.length) out.push("## Fixed", "", ...sections.fixed, "");
if (sections.behind.length) out.push("<details><summary>Behind the scenes</summary>", "", ...sections.behind, "", "</details>", "");
if (!numbers.length) out.push("No pull requests were merged since the previous release.", "");
out.push(
  "## Install",
  "",
  "Hopper is not in the LG Content Store yet. To sideload it, the TV needs LG's **Developer Mode** app turned on (see [CONTRIBUTING.md](https://github.com/" + repo + "/blob/main/CONTRIBUTING.md) for setting up a TV). Then, from a computer with the [webOS CLI](https://webostv.developer.lge.com/develop/tools/cli-installation):",
  "",
  "```sh",
  `ares-install --device <your TV> ${ipk}`,
  "```",
  "",
  "An install over an earlier sideloaded Hopper keeps the sign-in. Developer Mode switches off after 50 hours unless its session is extended in the Developer Mode app; sideloaded apps stop opening until it is.",
  "",
  `Check the download against \`SHA256SUMS\`: \`sha256sum -c SHA256SUMS\`.`,
  ""
);
if (previous) out.push(`**All changes:** https://github.com/${repo}/compare/${previous}...v${version}`, "");
process.stdout.write(out.join("\n"));
