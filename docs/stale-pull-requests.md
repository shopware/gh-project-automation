# Stale pull requests

A daily job warns and then closes inactive pull requests in all repositories of the shopware organization.

## Which pull requests

Only our own pull requests: the author and the first assignee both need a verified Shopware email address.
Community contributions and pull requests without an assignee are never warned or closed.

## What counts as activity

A person has to move the pull request forward.
GitHub's "updated" date is not used, because label, milestone and bot changes move it too.

| Counts | Does not count |
|---|---|
| A commit on the head branch | Label, milestone, assignee and reviewer changes |
| A comment | Base branch changes |
| A submitted review or a reply in a review thread | CI runs |
| | Anything a bot posts |

## Warning and closing

1. **Warning:** after 28 days without activity, the pull request gets the `lifecycle/AboutToClose` label and a comment.
2. **Closing:** with no activity in the 28 days after the label was added, it is closed and gets a comment.
   `lifecycle/AboutToClose` is replaced by `lifecycle/ClosedDueToNoActivity`.

Drafts and ready pull requests are handled the same way.
For a draft, the 28 days start at its latest conversion to draft at the earliest.
The job does not convert pull requests to drafts itself.

The warning is withdrawn, and `lifecycle/AboutToClose` removed, as soon as one of these happens:

- someone is active on the pull request,
- it gets the `lifecycle/DoNotClose` label, which also excludes it from both steps for good, or
- someone removes `lifecycle/AboutToClose` by hand.

If the pull request stays inactive, it is warned again before it can be closed.
A closed pull request can be reopened at any time.

## Labels

| Label | Set by | Meaning |
|---|---|---|
| `lifecycle/DoNotClose` | People | Excludes the issue or pull request from automatic warning and closing. |
| `lifecycle/AboutToClose` | Automation | Warned; will be closed unless there is activity within 28 days. |
| `lifecycle/ClosedDueToNoActivity` | Automation | Closed after a warning and another 28 days without activity. |

The labels are managed in [shopware/organization](https://github.com/shopware/organization) (`labels/labels.tf`).
In a repository not listed there, the job creates missing ones and fixes their color and description before it first warns or closes there.

## Configuration

The job is `manageOldPullRequests` in [`src/services/pull_request.ts`](../src/services/pull_request.ts).
It runs daily at 12:00 UTC from [`manage-stale-prs.yml`](https://github.com/shopware/shopware/blob/trunk/.github/workflows/manage-stale-prs.yml) in shopware/shopware, configured by organization variables:

| Variable | Meaning |
|---|---|
| `STALE_PR_THRESHOLD_DAYS` | Length of each step in days, currently 28. |
| `STALE_PR_CLOSE` | `true` to act, otherwise the job only reports. |
| `STALE_PR_DRY_RUN` | `true` to log what would happen without changing anything. |
| `STALE_PR_EXCLUDED_REPOSITORIES` | JSON list of repository names the job skips. |
