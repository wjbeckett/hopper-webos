# Maintaining Hopper

What the automation does on its own, and what is left for the maintainer. Contributor-facing instructions are in [`CONTRIBUTING.md`](../CONTRIBUTING.md).

```
new branch off main (yours, or a contributor's fork)  ──pull request──►  main
```

There is one long-lived branch, `main`. Every change arrives through a pull request, and nothing is committed to `main` directly.

## At a glance: automatic or manual

| Step | Your own PR | PR from a fork |
| --- | --- | --- |
| Create the branch and make the change | **You** (or `/fix-issue`) | Contributor |
| Open the pull request | **You** | Contributor |
| Build check | Automatic | Automatic. **You** click **Approve and run** for a first-time contributor |
| Size, area and `external` labels | Automatic | Automatic |
| Welcome comment explaining the process | Not posted | Automatic |
| Claude review: summary comment and inline suggestions | Automatic | Automatic for returning contributors. **You** add the `claude-review` label once for a first-time contributor |
| Small fixes pushed to the branch | Automatic (`review: ` commits) | Not possible. The contributor applies suggestions, or **you** push to their branch |
| Re-review after each push | Automatic | Automatic once the first review has run |
| Read the review and decide | **You** | **You** |
| Test on a TV | **You**, when the change affects the app | **You** |
| Merge | **You** | **You** |
| Delete the branch after merging | Automatic if enabled (see Settings) | Not needed |

## Your own change, step by step

1. **You:** branch off `main`: `git fetch origin main && git checkout -b <type>/<slug> origin/main`. For a GitHub issue, run `/fix-issue <number>` in Claude Code and it does steps 1 to 3, including opening the PR. When Claude Code makes any other change for you, it also opens the PR itself (see Development procedure in `CLAUDE.md`).
2. **You:** make the change and run `npm run build`.
3. **You:** commit, push the branch, and open a pull request into `main`. Fill in the template.
4. **Automatic:** **Build** runs, the PR is labelled, and **Claude PR review** starts. It takes a few minutes.
5. **Automatic:** the reviewer posts one **Claude review** comment (verdict, a table of what it checked, what it changed) and inline suggestions. It may push `review: ` commits with small fixes.
6. **You:** pull, so you have any `review: ` commits. Read the summary, then apply or dismiss the inline suggestions. Each push is reviewed again and the same comment is updated.
7. **You:** if the change affects the app, test on a TV from the PR branch: `WEBOS_DEVICE=<name> npm run webos:deploy`.
8. **You:** merge.

Draft pull requests are not reviewed. Marking one ready for review starts the review.

## A pull request from a fork, step by step

1. **Automatic:** the PR is labelled (`external`, size, area) and the contributor gets a comment explaining what happens next.
2. **Automatic, or you:** **Build** runs. For a first-time contributor GitHub holds it until you click **Approve and run** on the PR.
3. **Automatic, or you:**
   - *Returning contributor* (has had a PR merged): the Claude review runs straight away.
   - *First-time contributor:* the PR gets the `awaiting-review-approval` label. Glance at the diff for anything obviously hostile, then add the `claude-review` label. The review runs now and after every later push.
4. **Automatic:** the reviewer posts a **Claude review** comment and inline suggestions. It reads the diff only; it does not build or run the contributor's code, and it cannot push to a fork.
5. **Contributor:** applies the suggestions from the **Files changed** tab. Each push is reviewed again.
   - To fix something yourself: `gh pr checkout <number>`, commit and push. This works when the contributor left **Allow edits by maintainers** ticked.
6. **You:** test on a TV: `gh pr checkout <number>`, then `WEBOS_DEVICE=<name> npm run webos:deploy`.
7. **You:** merge.

To review any pull request on demand through the read-only path: **Actions → PR intake → Run workflow**, and enter the PR number.

## Issues

- **Automatic:** issues opened from the bug or feature form are labelled `bug` or `enhancement`. The bug form requires the TV model, webOS version and steps.
- **Issues are the only work list.** There is no backlog or handoff file. Decisions that are not work (what Hopper does differently on purpose, what is not planned) are in `docs/DECISIONS.md`.
- **Milestones:** *Public repo* (before the repository is made public), *Store submission* (before submitting to the LG Content Store, including features you want in the first store release) and *After store release*. An issue with no milestone has not been triaged; give it one or close it.
- **You:** run `/fix-issue` in Claude Code to triage open issues, or `/fix-issue <number>` to work one. It lists them by milestone, severity and effort, investigates the one you pick, does the work on a branch and opens the PR. It handles features and verification checks as well as bugs. There is no automatic issue bot.
- **Claude Code** opens a new issue, with no milestone, for work it finds but does not do.

## Releases

`main` is always the latest accepted code. To cut a release, tag a commit on `main` that you have tested on a TV, and update the README Availability table.

Every build has its own version number: `<major>.<minor>.<commit count>`, for example 0.3.215. The build stamps it into the packaged app, where the TV's app details show it, and into Settings → Server, next to the commit hash. To tell which build a TV is running, look there. To start a new release line, change `<major>.<minor>` in `package.json`; the third number takes care of itself. A hash ending in `+` means the build had uncommitted changes.

## What each workflow does

| Workflow | Runs on | What it does |
| --- | --- | --- |
| **Build** (`ci.yml`) | Every PR, and pushes to `main` | `npm ci` and `npm run build`. No secrets, so it is safe on outside code. |
| **PR intake** (`pr-intake.yml`), `triage` job | Every PR | Adds labels and welcomes outside contributors. Never checks out PR code. |
| **PR intake**, `external-review` job | PRs from forks, and manual runs | Read-only Claude review. Cannot build, run or push. |
| **Claude PR review** (`claude-review.yml`) | PRs from branches in this repository | Full Claude review: runs the build, pushes small `review: ` fixes, comments. If no review is posted (skipped, failed, cancelled), a **Claude review status** comment says why; it is deleted once a review is posted. |

## Labels

| Label | Set by | Meaning |
| --- | --- | --- |
| `external` | Triage | PR from a fork |
| `awaiting-review-approval` | Triage | Fork PR from a first-time contributor; add `claude-review` to start the review |
| `claude-review` | **You** | You approve automated review of this fork PR |
| `size/XS` … `size/XL` | Triage | Changed lines, not counting `package-lock.json` |
| `area: …`, `documentation` | Triage | Which parts of the code the PR touches |
| `bug`, `enhancement` | Issue forms | Set when an issue is opened from a form |
| `maintainer` | **You** or Claude Code | Needs a decision or action only you can take |
| `verification` | **You** or Claude Code | Already built; needs checking against a live server or on a TV |
| `needs: tv`, `needs: live server` | **You** or Claude Code | Cannot be finished without a physical LG TV or a real Silo server |

Triage creates any label that does not exist yet.

## Why fork PRs are reviewed differently

A fork PR is code and text from someone outside the project, and the review runs with this repository's Claude token. So for forks:

- Claude never gets PR code as a checkout. It gets `main` plus the PR as a diff file, and its only tools are reading files. A script posts its result.
- First-time contributors need the `claude-review` label once, so a stranger cannot spend the Claude subscription's usage, or aim crafted text at the reviewer, without a maintainer looking first.
- To review every fork PR with no approval step, set the repository variable `CLAUDE_REVIEW_ALL_FORKS` to `true` (**Settings → Secrets and variables → Actions → Variables**). The read-only limits still apply.

## Settings

Already done:

- Claude GitHub App installed, and the `CLAUDE_CODE_OAUTH_TOKEN` secret added. The token comes from `claude setup-token` and uses the maintainer's Claude subscription.

Recommended now:

- **Settings → General → Pull Requests → Automatically delete head branches:** on. Merged branches are removed for you.

### Branch protection for `main`

GitHub only offers this on public repositories, or private ones on a paid plan. Set it up when the repository goes public.

1. **Settings → Branches → Add branch ruleset** (or **Add classic branch protection rule**).
2. Name it `main`, set enforcement to **Active**, and under target branches choose **Include default branch**.
3. Turn on:
   - **Restrict deletions**
   - **Block force pushes**
   - **Require a pull request before merging**, with required approvals set to **0**. A sole maintainer cannot approve their own pull request, so any higher number blocks every merge.
   - **Require status checks to pass**, then add the check named **`build`**. It only appears in the search box after the Build workflow has run at least once.
4. Leave the bypass list empty so the rule applies to you too, or add the repository admin role if you want an escape hatch.
5. Save.

Do not add the Claude review as a required check. It does not run on PRs that change its own workflow file, and a required check that never reports blocks the merge.

### Fork pull request workflows

This decides whose pull requests need your click before **Build** runs.

1. **Settings → Actions → General**.
2. Under **Approval for running fork pull request workflows from contributors**, choose **Require approval for first-time contributors**. This is GitHub's default: one click per new contributor, none after their first merged PR.
3. Under **Workflow permissions**, keep **Read repository contents and packages permissions**. Each workflow asks for what it needs.
4. Save.

While the repository is private, forks can only be made by people you have given access to, and **Run workflows from fork pull requests** in the same page controls whether their PRs run workflows at all.

## Changing the workflows

- `claude-review.yml` only runs when the copy in the PR is identical to the copy on `main`. So a PR that changes that file is not reviewed by it: the check goes green in seconds and a **Claude review status** comment says it was skipped. That is expected. Reviews resume once the change is merged.
- `pr-intake.yml` always runs the copy on `main`, so a change takes effect after it is merged. To try a change first, use **Run workflow** and pick your branch.
- Issue forms and the PR template take effect from `main`.
