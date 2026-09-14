import {
    addComment,
    closePullRequest,
    getPullRequests,
    getVerifiedDomainEmails
} from "../api";
import { Toolkit } from "../types";
import { isDryRun } from "../util/dry_run";
import { isNonHumanLogin, lastHumanActivityAt } from "../util/activity";

/**
 * manageOldPullRequests closes our own pull requests once they have been inactive for a
 * specified number of days.
 *
 * Inactivity is the age of the last human event on the pull request, not GitHub's
 * `updated_at`. Searching on `updated:<` misses exactly the pull requests this is meant to
 * find: any bot touching a label resets that clock, and a milestone rotation in
 * shopware/shopware did so for 71 of 273 open pull requests in one pass, leaving the
 * candidate pool there empty. `created:<` is the prefilter instead — nothing stale for
 * `days` can have been opened more recently than that — and the real measure runs over the
 * result.
 *
 * Both the author and the assignee have to hold a verified organization email. The
 * assignee check alone does not keep this off community contributions: assigning a
 * maintainer to one is the good practice, and it used to be what made it eligible for
 * closing. Closing someone else's contribution is a decision for a person, not for a cron
 * job.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param organization - The GitHub organization to check for old pull requests.
 * @param days - Consider pull requests old after this many days of inactivity.
 * @param close - If true, the pull request will be closed after sending the reminder.
 */
export async function manageOldPullRequests(toolkit: Toolkit, organization: string = "shopware", days: number = 7, close: boolean = false, excludedRepositories: string[] = []) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const pullRequests = await getPullRequests(
        toolkit,
        `org:${organization} is:pr is:open draft:false created:<${cutoff}`,
        true
    );
    const closeMsg = `This pull request has been closed automatically. If you would like to continue working on it, please feel free to re-open it!`;

    toolkit.core.info(`Checking ${pullRequests.length} open pull request(s) opened before ${cutoff}.`);

    let closed = 0;

    for (const pr of pullRequests) {
        const name = `${pr.repository.owner.login}/${pr.repository.name}#${pr.number}`;

        if (excludedRepositories.includes(pr.repository.name)) {
            toolkit.core.debug(`${pr.repository.name} is on the excludedRepositories list. Skipping...`);
            continue;
        }

        const lastActivity = lastHumanActivityAt(pr);

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

        if (close) {
            ++closed;

            if (isDryRun()) {
                toolkit.core.info(`[DRY_RUN]\t${pr.url}`);
            } else {
                await closePullRequest(toolkit, pr.id);
                await addComment(toolkit, pr.id, closeMsg);
            }
        }
    }

    if (close) {
        toolkit.core.info(`${isDryRun() ? "Would have closed" : "Closed"} ${closed} pull request(s).`);
    }
}
