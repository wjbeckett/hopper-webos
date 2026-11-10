# Maintaining Hopper

How changes get from an idea to `main`, what the automation does, and what is left for the maintainer. Contributor-facing instructions are in [`CONTRIBUTING.md`](../CONTRIBUTING.md).

```
branch off dev (yours, or a contributor's fork)  ──PR──►  dev  ──release PR after TV testing──►  main
```

## What runs on a pull request

| Workflow | Runs on | What it does |
| --- | --- | --- |
| **Build** (`ci.yml`) | Every PR, and pushes to `dev` and `main` | `npm ci` and `npm run build`. No secrets, so it is safe on outside code. |
| **PR intake** (`pr-intake.yml`), `triage` job | Every PR | Adds size, area and `external` labels. Moves fork PRs opened against `main` over to `dev`. Welcomes outside contributors. Never checks out PR code. |
| **PR intake**, `external-review` job | PRs from forks | Read-only Claude review: a summary comment with a checks table, plus inline suggestions. Cannot build, run or push. |
| **Claude PR review** (`claude-review.yml`) | PRs from branches in this repository | Full Claude review. Into `dev` it also pushes small `review: ` fix commits. Into `main` it only comments. |

Draft PRs are not reviewed. Marking a PR ready for review starts the review.

## Your own change

1. Branch off `dev`: `git fetch origin dev && git checkout -b <type>/<slug> origin/dev`. For a GitHub issue, run `/fix-issue <number>` in Claude Code and it does this for you.
2. Make the change, run `npm run build`, commit and push the branch.
3. Open a PR into `dev`. The template asks how it was tested.
4. Wait for **Build** and **Claude PR review**. Pull before adding commits, because the reviewer may have pushed `review: ` fixes.
5. Read the review summary. Apply or dismiss any inline suggestions.
6. Test on a TV if the change needs it (`WEBOS_DEVICE=<name> npm run webos:deploy` from the PR branch).
7. Merge.

## A pull request from a fork

What happens without you:

- The PR is labelled, and moved to `dev` if it was opened against `main`.
- The contributor gets a comment explaining the process.
- **Build** runs. For a first-time contributor GitHub may hold it until you click **Approve and run** (see Settings below).
- If the author has had a PR merged before, the Claude review runs on open and on every push.

What you do:

1. **First-time contributor only:** the PR gets the `awaiting-review-approval` label. Glance at the diff for anything obviously hostile, then add the `claude-review` label. The review runs now and on every later push to that PR.
2. Read the **Claude review** comment: the verdict, the checks table, and the "Still needs a TV" steps.
3. The contributor applies the inline suggestions from the **Files changed** tab. The reviewer cannot push to a fork. If you would rather fix it yourself, `gh pr checkout <number>`, commit and push; this works when the contributor left **Allow edits by maintainers** ticked.
4. Test on a TV: `gh pr checkout <number>`, then `WEBOS_DEVICE=<name> npm run webos:deploy`.
5. Merge into `dev`.

To review any PR on demand through the read-only path, open **Actions → PR intake → Run workflow** and enter the PR number.

## Releasing

1. Open a PR from `dev` into `main`.
2. **Claude PR review** runs as a release check, comment only.
3. Merge once everything going out has been tested on a TV. Update the README Availability table for the release.

## Labels

| Label | Set by | Meaning |
| --- | --- | --- |
| `external` | Triage | PR from a fork |
| `awaiting-review-approval` | Triage | Fork PR from a first-time contributor; add `claude-review` to start the review |
| `claude-review` | You | You approve automated review of this fork PR |
| `size/XS` … `size/XL` | Triage | Changed lines, not counting `package-lock.json` |
| `area: …`, `documentation` | Triage | Which parts of the code the PR touches |
| `bug`, `enhancement` | Issue forms | Set when an issue is opened from a template |

Triage creates any label that does not exist yet.

## Issues

Issues come in through the bug and feature forms in `.github/ISSUE_TEMPLATE/`, which collect the TV model, webOS version and steps up front. There is no automatic issue bot. To work through open issues, run `/fix-issue` in Claude Code: it triages them, investigates the one you pick, fixes it on a branch and drafts the PR.

## Why fork PRs are reviewed differently

A fork PR is code and text from someone outside the project, and the review runs with this repository's Claude token. So for forks:

- Claude never sees PR code as a checkout. It gets the base branch plus the PR as a diff file, and its only tools are reading files. A script posts its result.
- First-time contributors need the `claude-review` label once, so a stranger cannot spend the Claude subscription's usage or aim crafted text at the reviewer without a maintainer looking first.
- To review every fork PR with no approval step, set the repository variable `CLAUDE_REVIEW_ALL_FORKS` to `true` (Settings → Secrets and variables → Actions → Variables). The read-only limits still apply.

## Settings

Done:

- Claude GitHub App installed, and the `CLAUDE_CODE_OAUTH_TOKEN` secret added. The token comes from `claude setup-token` and uses the maintainer's Claude subscription.

Before going public:

- **Settings → Actions → General → Fork pull request workflows:** choose who needs approval before **Build** runs on their PR. "Require approval for first-time contributors" is GitHub's default and costs one click per new contributor.
- **Settings → Branches:** protect `dev` and `main`: require a pull request and require the `build` check to pass.
- Leave **Settings → Actions → General → Workflow permissions** on read-only. Each workflow asks for what it needs.

## Changing the workflows

- `claude-review.yml` only runs when the copy in the PR is identical to the copy on `main`, the default branch. A change to it needs two PRs with the same content, into `dev` and into `main`.
- `pr-intake.yml` runs from the base branch of the PR, so a change takes effect for PRs into `dev` once it is on `dev`. "Run workflow" uses the copy on the branch you pick, which is how to test a change before merging it.
- Issue forms and the PR template take effect from `main`.
