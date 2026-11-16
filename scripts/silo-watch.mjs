#!/usr/bin/env node
// Reports what changed upstream in Silo since the last review (Markdown, to stdout).
//
//   node scripts/silo-watch.mjs                 report from the checkpoint to each repo's main
//   node scripts/silo-watch.mjs --advance       move the checkpoint to the heads the last report used
//
// It reads three public repositories in the Silo-Server organisation:
//   silo-server   contracts/api/v2/openapi.json (endpoints and schemas, compared between the two
//                 commits), contracts/api/v2/breaking-approvals.json, and feat commits outside the
//                 web and admin UIs
//   silo-android  commits touching the Android TV app or the modules it shares
//   silo-apple    tvOS commits, and feat commits that aren't iOS- or macOS-only
// Endpoints Hopper probably calls already (matched against the paths written in src/api) are
// marked, so a change to one of them stands out.
//
// The checkpoint (the last reviewed commit in each repository) is scripts/silo-watch.json. The
// repositories are kept as partial bare clones in .cache/silo-watch/ (git-ignored), so only the
// files the report reads are downloaded. The /silo-watch skill (.claude/skills/silo-watch) runs
// this, checks each item against Hopper and files issues for the ones worth doing.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checkpointFile = join(root, "scripts", "silo-watch.json");
const cacheDir = join(root, ".cache", "silo-watch");
const lastRunFile = join(cacheDir, "last-run.json");
const ORG = "Silo-Server";
const REPOS = ["silo-server", "silo-android", "silo-apple"];

const git = (repo, args) => execFileSync("git", ["-C", join(cacheDir, `${repo}.git`), ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024,
});

if (process.argv.includes("--advance")) {
  if (!existsSync(lastRunFile)) { console.error("No complete report to advance from: run the report first, and check it finished without problems."); process.exit(1); }
  const lastRun = JSON.parse(readFileSync(lastRunFile, "utf8"));
  const checkpoint = { reviewed: new Date().toISOString().slice(0, 10), repos: lastRun.heads };
  writeFileSync(checkpointFile, `${JSON.stringify(checkpoint, null, 2)}\n`);
  console.log(`Checkpoint moved to ${Object.entries(lastRun.heads).map(([repo, sha]) => `${repo}@${sha.slice(0, 9)}`).join(", ")}`);
  process.exit(0);
}

const checkpoint = JSON.parse(readFileSync(checkpointFile, "utf8"));

// Fetch (or make) the partial clones. A previous run's heads are dropped first, so --advance only
// ever uses the heads of the latest complete report.
mkdirSync(cacheDir, { recursive: true });
rmSync(lastRunFile, { force: true });
const heads = {};
for (const repo of REPOS) {
  const dir = join(cacheDir, `${repo}.git`);
  if (!existsSync(dir)) {
    execFileSync("git", ["clone", "--quiet", "--bare", "--filter=blob:none", `https://github.com/${ORG}/${repo}.git`, dir], { stdio: "inherit" });
  } else {
    git(repo, ["fetch", "--quiet", "origin", "+refs/heads/main:refs/heads/main"]);
  }
  heads[repo] = git(repo, ["rev-parse", "main"]).trim();
}
// Parts of the report that could not be read. An incomplete report is not saved for --advance.
const problems = [];

// ---------- Commits ----------

/** Commits in base..main (optionally only those touching paths), newest first. */
function commits(repo, paths = []) {
  const base = checkpoint.repos[repo];
  const out = git(repo, ["log", "--no-merges", "--format=%H%x09%ad%x09%s", "--date=short", `${base}..main`, ...(paths.length ? ["--", ...paths] : [])]);
  return out.split("\n").filter(Boolean).map(line => {
    const [sha, date, subject] = line.split("\t");
    const typed = subject.match(/^([a-z]+)(?:\(([^)]*)\))?(!)?:\s*(.*)$/);
    const pr = subject.match(/\(#(\d+)\)\s*$/)?.[1];
    return {
      sha, date, subject, pr,
      type: typed?.[1] ?? "other",
      scope: typed?.[2] ?? "",
      breaking: Boolean(typed?.[3]),
      title: (typed?.[4] ?? subject).replace(/\s*\(#\d+\)\s*$/, ""),
    };
  });
}

const link = (repo, c) => c.pr ? `[${repo}#${c.pr}](https://github.com/${ORG}/${repo}/pull/${c.pr})` : `[${c.sha.slice(0, 9)}](https://github.com/${ORG}/${repo}/commit/${c.sha})`;
const line = (repo, c) => `- ${c.scope ? `**${c.scope}**: ` : ""}${c.title}${c.breaking ? " **(breaking)**" : ""} (${link(repo, c)}, ${c.date})`;

const NOISE_TYPES = new Set(["test", "chore", "ci", "docs", "build", "style", "wip", "revert"]);
const NOISE_SCOPES = new Set(["i18n", "deps", "ci"]);

/** Splits commits into shown groups and a count of skipped ones by reason. */
function sort(list, { skipScopes = new Set(), keepFixScopes = null } = {}) {
  const groups = { feat: [], fix: [], other: [] };
  const skipped = new Map();
  const skip = reason => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  for (const c of list) {
    if (NOISE_TYPES.has(c.type)) { skip(c.type); continue; }
    if (NOISE_SCOPES.has(c.scope) || skipScopes.has(c.scope)) { skip(`scope ${c.scope}`); continue; }
    if (c.type === "feat") groups.feat.push(c);
    else if (c.type === "fix") {
      if (keepFixScopes && !keepFixScopes.has(c.scope)) { skip("fix outside TV scopes"); continue; }
      groups.fix.push(c);
    } else groups.other.push(c);
  }
  return { groups, skipped };
}

// ---------- API contract ----------

const CONTRACT = "contracts/api/v2/openapi.json";
const exists = (repo, sha, path) => {
  try { git(repo, ["cat-file", "-e", `${sha}:${path}`]); return true; } catch { return false; }
};
/** A JSON file from silo-server at a commit: null when the file isn't there, an error when it can't be read. */
const jsonAt = (sha, path) => exists("silo-server", sha, path) ? JSON.parse(git("silo-server", ["show", `${sha}:${path}`])) : null;
const contractAt = sha => {
  try {
    const spec = jsonAt(sha, CONTRACT);
    if (!spec) problems.push(`\`${CONTRACT}\` is missing at silo-server ${sha.slice(0, 9)}.`);
    return spec;
  } catch (error) {
    problems.push(`\`${CONTRACT}\` at silo-server ${sha.slice(0, 9)} could not be read: ${error.message.split("\n")[0]}`);
    return null;
  }
};
const METHODS = ["get", "put", "post", "delete", "patch", "head", "options"];
/** Each operation with what it inherits: the path's parameters (the operation's own win, by name
 *  and location) and the document's security when the operation sets none. */
const operations = spec => {
  const map = new Map();
  for (const [path, item] of Object.entries(spec?.paths ?? {})) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const own = op.parameters ?? [];
      const inherited = (item.parameters ?? []).filter(p => !own.some(o => o.name === p.name && o.in === p.in));
      map.set(`${method.toUpperCase()} ${path}`, {
        ...op,
        parameters: [...inherited, ...own],
        security: op.security ?? spec.security ?? [],
      });
    }
  }
  return map;
};
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** What differs between two versions of an operation, ignoring prose. */
function operationChanges(before, after) {
  const changes = [];
  const params = op => new Map((op.parameters ?? []).map(p => [`${p.in}:${p.name}`, p]));
  const pb = params(before), pa = params(after);
  const added = [...pa.keys()].filter(k => !pb.has(k));
  const removed = [...pb.keys()].filter(k => !pa.has(k));
  const changed = [...pa.keys()].filter(k => pb.has(k) && !same({ ...pb.get(k), description: 0 }, { ...pa.get(k), description: 0 }));
  if (added.length) changes.push(`parameters added: ${added.join(", ")}`);
  if (removed.length) changes.push(`parameters removed: ${removed.join(", ")}`);
  if (changed.length) changes.push(`parameters changed: ${changed.join(", ")}`);
  if (!same(before.requestBody?.content, after.requestBody?.content) || !same(before.requestBody?.required, after.requestBody?.required)) changes.push("request body changed");
  const codes = op => Object.keys(op.responses ?? {});
  const ra = codes(after).filter(c => !codes(before).includes(c));
  const rr = codes(before).filter(c => !codes(after).includes(c));
  if (ra.length) changes.push(`responses added: ${ra.join(", ")}`);
  if (rr.length) changes.push(`responses removed: ${rr.join(", ")}`);
  const bodyChanged = codes(after).filter(c => codes(before).includes(c) && !same(before.responses[c]?.content, after.responses[c]?.content));
  if (bodyChanged.length) changes.push(`response ${bodyChanged.join(", ")} changed`);
  if (!same(before.security, after.security)) {
    const open = list => !list.length || list.some(requirement => !Object.keys(requirement).length);
    changes.push(open(before.security) === open(after.security)
      ? "authentication changed"
      : open(after.security) ? "no longer needs authentication" : "now needs authentication");
  }
  if (Boolean(before.deprecated) !== Boolean(after.deprecated)) changes.push(after.deprecated ? "now deprecated" : "no longer deprecated");
  return changes;
}

/** Property-level differences between two versions of a schema. */
function schemaChanges(before, after) {
  const changes = [];
  const props = s => s?.properties ?? {};
  const pb = props(before), pa = props(after);
  const added = Object.keys(pa).filter(k => !(k in pb));
  const removed = Object.keys(pb).filter(k => !(k in pa));
  const changed = Object.keys(pa).filter(k => k in pb && !same({ ...pb[k], description: 0, examples: 0 }, { ...pa[k], description: 0, examples: 0 }));
  if (added.length) changes.push(`fields added: ${added.join(", ")}`);
  if (removed.length) changes.push(`fields removed: ${removed.join(", ")}`);
  if (changed.length) changes.push(`fields changed: ${changed.join(", ")}`);
  const rb = before?.required ?? [], ra = after?.required ?? [];
  const nowRequired = ra.filter(k => !rb.includes(k)), noLonger = rb.filter(k => !ra.includes(k));
  if (nowRequired.length) changes.push(`now required: ${nowRequired.join(", ")}`);
  if (noLonger.length) changes.push(`no longer required: ${noLonger.join(", ")}`);
  if (!changes.length && !same({ ...before, description: 0, properties: 0 }, { ...after, description: 0, properties: 0 })) changes.push("type or enum changed");
  return changes;
}

// Paths Hopper calls: the string and template literals in src/api that start with a slash.
function hopperPaths() {
  const found = new Set();
  const dir = join(root, "src", "api");
  for (const file of readdirSync(dir).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const text = readFileSync(join(dir, file), "utf8");
    for (const match of text.matchAll(/["`](\/[a-z][^"`\s]*)["`]?/g)) {
      const path = match[1].replace(/^\/api\/v2/, "").split("?")[0].replace(/\$\{[^}]*\}?/g, "*");
      if (path.length > 1) found.add(path.split("/").filter(Boolean));
    }
  }
  return [...found];
}
const HOPPER = hopperPaths();
const usedByHopper = key => {
  const segments = key.split(" ")[1].replace(/^\/api\/v2/, "").split("/").filter(Boolean);
  return HOPPER.some(h => h.length === segments.length && h.every((s, i) => s === "*" || segments[i].startsWith("{") || s === segments[i]));
};
const ADMIN = /\/(admin|system\/(?!setup)|nodes?\/|plugins?\/|server\/)/;

// ---------- Report ----------

const out = [];
const write = (...lines) => out.push(...lines);
const shortRange = repo => `${checkpoint.repos[repo].slice(0, 9)}..${heads[repo].slice(0, 9)}`;
const commitCount = repo => Number(git(repo, ["rev-list", "--count", "--no-merges", `${checkpoint.repos[repo]}..main`]).trim());

write(`# Silo watch since ${checkpoint.reviewed}`, "");
write(`Generated ${new Date().toISOString().slice(0, 10)}. Ranges: ${REPOS.map(r => `${r} \`${shortRange(r)}\` (${commitCount(r)} commits)`).join(", ")}.`, "");
write("Items marked **[Hopper uses]** match a path written in Hopper's `src/api` (a heuristic: check the code).", "");

// API contract.
write("## Server API contract", "");
const before = contractAt(checkpoint.repos["silo-server"]);
const after = contractAt(heads["silo-server"]);
if (!before || !after) {
  write(`Could not read \`${CONTRACT}\` at ${before ? "the head" : "the checkpoint"}.`, "");
} else {
  const ob = operations(before), oa = operations(after);
  const tag = key => `${usedByHopper(key) ? "**[Hopper uses]** " : ""}\`${key}\``;
  const summary = op => op.summary || op.operationId || "";
  const added = [...oa.keys()].filter(k => !ob.has(k));
  const removed = [...ob.keys()].filter(k => !oa.has(k));
  const changed = [...oa.keys()].filter(k => ob.has(k)).map(k => [k, operationChanges(ob.get(k), oa.get(k))]).filter(([, c]) => c.length);
  const client = key => !ADMIN.test(key.split(" ")[1]);
  const list = (title, keys, render) => {
    const shown = keys.filter(k => client(Array.isArray(k) ? k[0] : k));
    const admin = keys.length - shown.length;
    write(`### ${title} (${shown.length}${admin ? `, plus ${admin} admin or server-management` : ""})`, "");
    if (!shown.length) write("None.");
    for (const k of shown.sort((a, b) => Number(usedByHopper(Array.isArray(b) ? b[0] : b)) - Number(usedByHopper(Array.isArray(a) ? a[0] : a)))) write(render(k));
    write("");
  };
  list("Endpoints removed", removed, k => `- ${tag(k)}`);
  list("Endpoints changed", changed, ([k, c]) => `- ${tag(k)}: ${c.join("; ")}`);
  list("Endpoints added", added, k => `- ${tag(k)}${summary(oa.get(k)) ? `: ${summary(oa.get(k))}` : ""}`);

  // Schemas reachable from the operations Hopper calls, at the head.
  const sb = before.components?.schemas ?? {}, sa = after.components?.schemas ?? {};
  const reachable = new Set();
  const walk = value => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, inner] of Object.entries(value)) {
      if (key === "$ref" && typeof inner === "string" && inner.startsWith("#/components/schemas/")) {
        const name = inner.slice("#/components/schemas/".length);
        if (!reachable.has(name)) { reachable.add(name); walk(sa[name]); }
      } else walk(inner);
    }
  };
  for (const [key, op] of oa) if (usedByHopper(key)) walk(op);

  const schemaAdded = Object.keys(sa).filter(k => !(k in sb));
  const schemaRemoved = Object.keys(sb).filter(k => !(k in sa));
  const schemaChanged = Object.keys(sa).filter(k => k in sb).map(k => [k, schemaChanges(sb[k], sa[k])]).filter(([, c]) => c.length);
  const hopperChanged = schemaChanged.filter(([k]) => reachable.has(k));
  const otherChanged = schemaChanged.filter(([k]) => !reachable.has(k));
  write(`### Schemas (${schemaAdded.length} added, ${schemaRemoved.length} removed, ${schemaChanged.length} changed)`, "");
  if (schemaRemoved.length) write(`- Removed: ${schemaRemoved.map(s => `\`${s}\``).join(", ")}`);
  for (const [name, c] of hopperChanged) write(`- **[Hopper uses]** \`${name}\`: ${c.join("; ")}`);
  if (otherChanged.length) write(`- Changed, not reached from endpoints Hopper calls: ${otherChanged.map(([s]) => `\`${s}\``).join(", ")}`);
  if (schemaAdded.length) write(`- Added: ${schemaAdded.map(s => `\`${s}\``).join(", ")}`);
  if (!schemaAdded.length && !schemaRemoved.length && !schemaChanged.length) write("None.");
  write("");
}

// A file missing at the checkpoint (added since) counts as no earlier approvals; missing at the
// head or unreadable at either end makes the report incomplete.
const APPROVALS = "contracts/api/v2/breaking-approvals.json";
write("### Approved breaking changes", "");
try {
  const read = sha => {
    const file = jsonAt(sha, APPROVALS);
    if (file && !Array.isArray(file.approvals)) throw new Error("no approvals list");
    return file?.approvals ?? null;
  };
  const old = read(checkpoint.repos["silo-server"]) ?? [];
  const now = read(heads["silo-server"]);
  if (now === null) {
    problems.push(`\`${APPROVALS}\` is missing at the silo-server head.`);
    write("Not compared: the file is missing at the head.", "");
  } else {
    const seen = new Set(old.map(a => JSON.stringify(a)));
    const approvals = now.filter(a => !seen.has(JSON.stringify(a)));
    write(...(approvals.length ? approvals.map(a => `- \`${JSON.stringify(a)}\``) : ["None."]), "");
  }
} catch (error) {
  problems.push(`\`${APPROVALS}\` could not be read: ${error.message.split("\n")[0]}`);
  write("Not compared: the file could not be read.", "");
}

const section = (title, repo, { groups, skipped }, fixTitle = "Fixes") => {
  write(`## ${title}`, "");
  write(`### Features (${groups.feat.length})`, "", ...(groups.feat.length ? groups.feat.map(c => line(repo, c)) : ["None."]), "");
  write(`### ${fixTitle} (${groups.fix.length})`, "", ...(groups.fix.length ? groups.fix.map(c => line(repo, c)) : ["None."]), "");
  if (groups.other.length) write(`### Other (${groups.other.length})`, "", ...groups.other.map(c => line(repo, c)), "");
  if (skipped.size) write(`Skipped: ${[...skipped].map(([reason, n]) => `${n} ${reason}`).join(", ")}.`, "");
};

// Server features outside the web and admin UIs.
{
  const all = commits("silo-server");
  const feats = all.filter(c => c.type === "feat" && !["web", "admin", "i18n"].includes(c.scope));
  write("## Server features", "", `Feat commits outside the web and admin UIs (${feats.length} of ${all.length} commits).`, "");
  write(...(feats.length ? feats.map(c => line("silo-server", c)) : ["None."]), "");
}

// Android TV: the TV app and the modules it shares with the phone app.
section("Android TV", "silo-android", sort(commits("silo-android", ["androidTvApp", "shared", "android-shared", "libass-bridge"])));

// tvOS: tvOS-scoped commits and features that aren't iOS- or macOS-only.
{
  const apple = commits("silo-apple").filter(c => c.type !== "fix" || c.scope === "tvos");
  section("tvOS (second reference)", "silo-apple", sort(apple, { skipScopes: new Set(["ios", "macos", "ipados", "watchos"]) }), "tvOS fixes");
}

if (problems.length) write("## Incomplete report", "", ...problems.map(p => `- ${p}`), "", "The checkpoint can't be advanced from this run.");
process.stdout.write(`${out.join("\n").trim()}\n`);
if (problems.length) {
  console.error(`silo-watch: incomplete report (${problems.length} problem${problems.length === 1 ? "" : "s"}); --advance is not available for it.`);
  process.exitCode = 1;
} else {
  writeFileSync(lastRunFile, `${JSON.stringify({ ran: new Date().toISOString(), heads }, null, 2)}\n`);
}
