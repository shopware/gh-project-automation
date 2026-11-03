import {
    addComment,
    closePullRequest,
    convertPullRequestToDraft,
    getPullRequestComments,
    getPullRequests,
    getVerifiedDomainEmails
} from "../api";
import { Toolkit } from "../types";
import { isDryRun } from "../util/dry_run";
import { isNonHumanLogin, lastBotCommentAt, lastConvertedToDraftAt, lastHumanActivityAt } from "../util/activity";

export const DO_NOT_CLOSE_LABEL = "lifecycle/DoNotClose";
export const CLOSED_DUE_TO_NO_ACTIVITY_LABEL = "lifecycle/ClosedDueToNoActivity";

/** Hidden in the warning comment; the next run reads it back to know the warning was given. */
const STALE_WARNING_MARKER = "<!-- stale-pull-request-warning -->";

const LIFECYCLE_DOCS_URL = "https://github.com/shopware/shopware/blob/trunk/delivery-process/pull-request-lifecycle.md#inactive-pull-requests";

/**
 * manageOldPullRequests retires our own pull requests in two steps once they have been
 * inactive for `days`: first a warning, then, after another `days` without activity, it
 * closes them and labels them {@link CLOSED_DUE_TO_NO_ACTIVITY_LABEL}. Closing without a
 * warning took approved pull requests that only nobody had merged yet.
 *
 * The warning is a comment; a pull request that is not a draft yet is also converted to
 * one. Any human activity after the warning starts the clock over. Pull requests with
 * {@link DO_NOT_CLOSE_LABEL} are left out of both steps.
 *
 * Inactivity is the age of the last human event on the pull request, not GitHub's
 * `updated_at`. Searching on `updated:<` misses exactly the pull requests this is meant to
 * find: any bot touching a label resets that clock, and a milestone rotation in
 * shopware/shopware did so for 71 of 273 open pull requests in one pass, leaving the
 * candidate pool there empty. `created:<` is the prefilter instead — nothing stale for
 * `days` can have been opened more recently than that — and the real measure runs over the
 * result. For a draft the clock starts at its latest conversion to draft at the earliest.
 *
 * Both the author and the assignee have to hold a verified organization email. The
 * assignee check alone does not keep this off community contributions: assigning a
 * maintainer to one is the good practice, and it used to be what made it eligible for
 * closing. Closing someone else's contribution is a decision for a person, not for a cron
 * job.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param organization - The GitHub organization to check for old pull requests.
 * @param days - Length of each step: inactivity before the warning, then before closing.
 * @param close - If false, only reports what would happen.
 */
export async function manageOldPullRequests(toolkit: Toolkit, organization: string = "shopware", days: number = 7, close: boolean = false, excludedRepositories: string[] = []) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const pullRequests = await getPullRequests(
        toolkit,
        `org:${organization} is:pr is:open created:<${cutoff} -label:"${DO_NOT_CLOSE_LABEL}"`,
        true
    );
    const deadline = `It will be closed if there is no further activity within the next ${days} days.\n\n`
        + `To keep it open, add the \`${DO_NOT_CLOSE_LABEL}\` label.`;
    const docs = `\n\n[How this works](${LIFECYCLE_DOCS_URL})`;
    const parkMsg = `${STALE_WARNING_MARKER}\nThis pull request has had no activity for ${days} days and has been converted to a draft. ${deadline} `
        + `Once you continue working on it, mark it as ready for review again.${docs}`;
    const warnMsg = `${STALE_WARNING_MARKER}\nThis draft has had no activity for ${days} days. ${deadline}${docs}`;
    const closeMsg = `This pull request has been closed automatically after ${days} days without activity since the last warning. `
        + `If you would like to continue working on it, please feel free to re-open it!${docs}`;

    toolkit.core.info(`Checking ${pullRequests.length} open pull request(s) opened before ${cutoff}.`);

    const counts = { park: 0, warn: 0, close: 0 };

    for (const pr of pullRequests) {
        const name = `${pr.repository.owner.login}/${pr.repository.name}#${pr.number}`;

        if (excludedRepositories.includes(pr.repository.name)) {
            toolkit.core.debug(`${pr.repository.name} is on the excludedRepositories list. Skipping...`);
            continue;
        }

        const draftedAt = pr.isDraft ? lastConvertedToDraftAt(pr) : undefined;
        const lastActivity = [lastHumanActivityAt(pr), draftedAt].filter((at) => at !== undefined).sort().at(-1);

        // No human event at all means nothing has happened since it was opened, and
        // `created:<` has already established that this was before the cutoff.
        if (lastActivity !== undefined && lastActivity >= cutoff) {
            toolkit.core.debug(`Pull request ${name} saw activity on ${lastActivity}, skipping.`);

            continue;
        }

        const author = pr.author;

        // An app is not a GitHub user, so asking for its verified emails costs a request
        // and a NOT_FOUND to arrive at the same answer.
        if (!author || isNonHumanLogin(author.login)) {
            toolkit.core.debug(`Pull request ${name} has no human author, skipping.`);

            continue;
        }

        if ((await getVerifiedDomainEmails(toolkit, author.login, organization)).length < 1) {
            toolkit.core.debug(`Pull request ${name} was not opened by a member of ${organization}, skipping.`);

            continue;
        }

        const assignee = pr.assignees.nodes[0];

        if (!assignee) {
            toolkit.core.debug(`Pull request ${name} has no assignee, skipping.`);

            continue;
        }

        const emails = await getVerifiedDomainEmails(toolkit, assignee.login, organization);

        if (emails.length < 1) {
            continue; // No verified domain emails found for the assignee, abort.
        }

        // A warning counts until a person reacts; `>=` because converting and commenting
        // can land within the same second.
        const warnedAt = lastBotCommentAt(await getPullRequestComments(toolkit, pr.id), STALE_WARNING_MARKER);
        const warned = warnedAt !== undefined && (lastActivity === undefined || warnedAt >= lastActivity);

        if (warned && warnedAt >= cutoff) {
            toolkit.core.debug(`Pull request ${name} was warned on ${warnedAt}, waiting.`);

            continue;
        }

        const action = warned ? "close" : pr.isDraft ? "warn" : "park";

        toolkit.core.info(`${name} has been inactive since ${lastActivity ?? "it was opened"}.`);

        if (!close) {
            continue;
        }

        ++counts[action];

        if (isDryRun()) {
            toolkit.core.info(`[DRY_RUN]\t${action}\t${pr.url}`);
        } else if (action === "close") {
            await closePullRequest(toolkit, pr.id);
            await labelClosedPullRequest(toolkit, pr.repository.owner.login, pr.repository.name, pr.number);
            await addComment(toolkit, pr.id, closeMsg);
        } else if (action === "warn") {
            await addComment(toolkit, pr.id, warnMsg);
        } else {
            await convertPullRequestToDraft(toolkit, pr.id);
            await addComment(toolkit, pr.id, parkMsg);
        }
    }

    if (close) {
        const verb = isDryRun() ? "Would have" : "Have";
        toolkit.core.info(`${verb} converted ${counts.park} pull request(s) to a draft, warned ${counts.warn} draft(s) and closed ${counts.close}.`);
    }
}

/**
 * The label is a marker for later queries, not part of closing, so a failure to set it is
 * only reported. Adding a label by name creates it in a repository that lacks it.
 */
async function labelClosedPullRequest(toolkit: Toolkit, owner: string, repo: string, issueNumber: number) {
    try {
        await toolkit.github.rest.issues.addLabels({ owner, repo, issue_number: issueNumber, labels: [CLOSED_DUE_TO_NO_ACTIVITY_LABEL] });
    } catch (error) {
        toolkit.core.warning(`Could not label ${owner}/${repo}#${issueNumber} with ${CLOSED_DUE_TO_NO_ACTIVITY_LABEL}: ${error}`);
    }
}
