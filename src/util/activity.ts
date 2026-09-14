/**
 * When a human last moved a pull request forward.
 *
 * GitHub's own `updated_at` cannot answer this, because it also moves for label and
 * milestone edits, reviewer changes, base-branch retargeting and bot comments. Automation
 * that measures it measures its own noise: one milestone rotation in shopware/shopware
 * touched 71 of 273 open pull requests in a single pass and reset all of their clocks.
 *
 * Counted: commits, issue comments, submitted reviews and replies inside review threads.
 * Not counted: labels, milestones, assignees, reviewer requests, retargeting, and anything
 * a bot posted.
 */

/**
 * Accounts GitHub does not type as a `Bot`. Service accounts such as CLAassistant post as
 * a plain `User`, and a commit author is typed `User` whoever pushed it, which is how
 * `dependabot[bot]` turns up with its suffix intact.
 */
export const NON_HUMAN_LOGINS = [
    "CLAassistant",
    "renovate",
    "Copilot",
    "codecov",
    "cursoragent",
    "dependabot",
    "explore-openapi",
    "github-actions",
    "octo-sts",
    "shopwareBot",
    "shopware-octo-sts-app",
    "shopware-octo-sts-app-2",
];

export function isNonHumanLogin(login: string): boolean {
    return login.endsWith("[bot]") || NON_HUMAN_LOGINS.includes(login);
}

export type ActivityAuthor = { login: string, __typename?: string } | null;

export type ActivityTimelineNode = {
    createdAt?: string,
    submittedAt?: string,
    author?: ActivityAuthor,
    commit?: { committedDate: string, author?: { user?: { login: string } | null } | null }
};

export type ActivityReviewThreadNode = {
    comments: { nodes: { createdAt: string, author?: ActivityAuthor }[] }
};

export type PullRequestActivity = {
    timelineItems?: { nodes: ActivityTimelineNode[] },
    reviewThreads?: { nodes: ActivityReviewThreadNode[] }
};

function isHumanAuthor(author: ActivityAuthor): boolean {
    return author !== null && author !== undefined && author.__typename !== "Bot" && !isNonHumanLogin(author.login);
}

/**
 * Returns the newest human timestamp as an ISO 8601 string, or `undefined` when the
 * activity fields were not requested or hold nothing but bot noise.
 *
 * A commit counts even when GitHub cannot resolve its committer to an account, which
 * happens for an address with no user attached and would otherwise drop a push silently.
 * `committedDate` is the commit's own date, so replaying untouched history reads as old
 * activity where a rebase reads as new.
 */
export function lastHumanActivityAt(pullRequest: PullRequestActivity): string | undefined {
    const timestamps: string[] = [];

    for (const node of pullRequest.timelineItems?.nodes ?? []) {
        if (node.commit) {
            const login = node.commit.author?.user?.login;
            if (login === undefined || !isNonHumanLogin(login)) {
                timestamps.push(node.commit.committedDate);
            }

            continue;
        }

        const at = node.createdAt ?? node.submittedAt;
        if (at && isHumanAuthor(node.author ?? null)) {
            timestamps.push(at);
        }
    }

    for (const thread of pullRequest.reviewThreads?.nodes ?? []) {
        for (const comment of thread.comments.nodes) {
            if (isHumanAuthor(comment.author ?? null)) {
                timestamps.push(comment.createdAt);
            }
        }
    }

    // All ISO 8601 in UTC, so lexical order is chronological.
    return timestamps.sort().at(-1);
}
