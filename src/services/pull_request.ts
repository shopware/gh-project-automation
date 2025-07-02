import {
    addComment,
    closePullRequest,
    getPullRequests,
    getVerifiedDomainEmails
} from "../api";
import {Toolkit} from "../types";
import {isDryRun} from "../util/dry_run";

/**
 * manageOldPullRequests checks for old pull requests and closes them if they have been inactive for a specified number of days.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param organization - The GitHub organization to check for old pull requests.
 * @param days - Consider pull requests old after this many days of inactivity.
 * @param close - If true, the pull request will be closed after sending the reminder.
 */
export async function manageOldPullRequests(toolkit: Toolkit, organization: string = "shopware", days: number = 7, close: boolean = false) {
    const pullRequests = await getPullRequests(
        toolkit,
        `org:${organization} is:pr is:open draft:false updated:<${new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()}`
    );
    const closeMsg = `This pull request has been closed automatically. If you would like to continue working on it, please feel free to re-open it!`;

    for (const pr of pullRequests) {
        const assignee = pr.assignees.nodes[0];

        if (!assignee) {
            toolkit.core.debug(`Pull request ${pr.repository.owner.login}/${pr.repository.name}#${pr.number} has no assignee, skipping.`);

            continue;
        }

        const emails = await getVerifiedDomainEmails(toolkit, assignee.login, organization);

        if (emails.length < 1) {
            continue; // No verified domain emails found for the assignee, abort.
        }

        if (close) {
            if (isDryRun()) {
                toolkit.core.info(`[DRY_RUN]\t${pr.url}`);
            } else {
                await closePullRequest(toolkit, pr.id);
                await addComment(toolkit, pr.id, closeMsg);
            }
        }
    }
}
