import {
    addComment,
    closePullRequest,
    convertPullRequestToDraft,
    getPullRequests,
    getVerifiedDomainEmails
} from "../api";
import { Toolkit } from "../types";
import { isDryRun } from "../util/dry_run";
import { convertedToDraftByBotAt, isNonHumanLogin, lastHumanActivityAt } from "../util/activity";

export const DO_NOT_CLOSE_LABEL = "lifecycle/DoNotClose";
export const CLOSED_DUE_TO_NO_ACTIVITY_LABEL = "lifecycle/ClosedDueToNoActivity";

/**
 * manageOldPullRequests retires our own pull requests in two steps once they have been
 * inactive for `days`: first it converts them to a draft with a comment, then, after
 * another `days` without activity, it closes them and labels them
 * {@link CLOSED_DUE_TO_NO_ACTIVITY_LABEL}. The draft step is the warning; closing without
 * one took approved pull requests that only nobody had merged yet.
 *
 * Only drafts this job made are closed: the latest conversion to draft has to be a bot's.
 * A draft its author opened or parked is work in progress and stays. Pull requests with
 * {@link DO_NOT_CLOSE_LABEL} are left out of both steps.
 *
 * Inactivity is the age of the last human event on the pull request, not GitHub's
 * `updated_at`. Searching on `updated:<` misses exactly the pull requests this is meant to
 * find: any bot touching a label resets that clock, and a milestone rotation in
 * shopware/shopware did so for 71 of 273 open pull requests in one pass, leaving the
 * candidate pool there empty. `created:<` is the prefilter instead — nothing stale for
 * `days` can have been opened more recently than that — and the real measure runs over the
 * result. For a parked draft the clock starts at the conversion at the latest.
 *
 * Both the author and the assignee have to hold a verified organization email. The
 * assignee check alone does not keep this off community contributions: assigning a
 * maintainer to one is the good practice, and it used to be what made it eligible for
 * closing. Closing someone else's contribution is a decision for a person, not for a cron
 * job.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param organization - The GitHub organization to check for old pull requests.
 * @param days - Length of each step: inactivity before parking, then before closing.
 * @param close - If false, only reports what would happen.
 */
export async function manageOldPullRequests(toolkit: Toolkit, organization: string = "shopware", days: number = 7, close: boolean = false, excludedRepositories: string[] = []) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const pullRequests = await getPullRequests(
        toolkit,
        `org:${organization} is:pr is:open created:<${cutoff} -label:"${DO_NOT_CLOSE_LABEL}"`,
        true
    );
    const parkMsg = `This pull request has had no activity for ${days} days and has been converted to a draft. `
        + `It will be closed if there is no further activity within the next ${days} days.\n\n`
        + `To keep it open, add the \`${DO_NOT_CLOSE_LABEL}\` label. `
        + `Once you continue working on it, mark it as ready for review again.`;
    const closeMsg = `This pull request has been closed automatically after ${days} more days without activity as a draft. `
        + `If you would like to continue working on it, please feel free to re-open it!`;

    toolkit.core.info(`Checking ${pullRequests.length} open pull request(s) opened before ${cutoff}.`);

    let parked = 0;
    let closed = 0;

    for (const pr of pullRequests) {
        const name = `${pr.repository.owner.login}/${pr.repository.name}#${pr.number}`;

        if (excludedRepositories.includes(pr.repository.name)) {
            toolkit.core.debug(`${pr.repository.name} is on the excludedRepositories list. Skipping...`);
            continue;
        }

        const parkedAt = pr.isDraft ? convertedToDraftByBotAt(pr) : undefined;

        if (pr.isDraft && parkedAt === undefined) {
            toolkit.core.debug(`Pull request ${name} is a draft no bot made, skipping.`);

            continue;
        }

        const lastActivity = [lastHumanActivityAt(pr), parkedAt].filter((at) => at !== undefined).sort().at(-1);

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

        toolkit.core.info(`${name} has been inactive since ${lastActivity ?? "it was opened"}.`);

        if (!close) {
            continue;
        }

        if (isDryRun()) {
            toolkit.core.info(`[DRY_RUN]\t${pr.isDraft ? "close" : "park"}\t${pr.url}`);
        } else if (pr.isDraft) {
            await closePullRequest(toolkit, pr.id);
            await labelClosedPullRequest(toolkit, pr.repository.owner.login, pr.repository.name, pr.number);
            await addComment(toolkit, pr.id, closeMsg);
        } else {
            await convertPullRequestToDraft(toolkit, pr.id);
            await addComment(toolkit, pr.id, parkMsg);
        }

        if (pr.isDraft) {
            ++closed;
        } else {
            ++parked;
        }
    }

    if (close) {
        const verb = isDryRun() ? "Would have" : "Have";
        toolkit.core.info(`${verb} converted ${parked} pull request(s) to a draft and closed ${closed}.`);
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
