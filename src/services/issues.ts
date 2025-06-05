import {GitHubIssue, Toolkit} from "../types";
import {getPullRequests} from "../api/github";

/**
 * getDevelopmentIssueForPullRequest fetches the development issue linked to a pull request.
 *
 * @remarks
 * This function searches for pull requests in the Shopware organization that match the given head and assignee.
 * It retrieves the first closing issue reference from the matching pull requests.
 * If a matching development issue is found, it returns the issue details; otherwise, it returns null.
 *
 * @param toolkit - Octokit instance. See: https://octokit.github.io/rest.js
 * @param repo - The repository to search in, formatted as "owner/repo".
 * @param pullRequestNumber - The number of the pull request to search for.
 * @param pullRequestHead - The head branch of the pull request.
 * @param pullRequestAssignee - The assignee of the pull request.
 */
export async function getDevelopmentIssueForPullRequest(toolkit: Toolkit, repo: string, pullRequestNumber: number, pullRequestHead: string, pullRequestAssignee: string): Promise<GitHubIssue | null> {
    const pullRequests = await getPullRequests(
        toolkit,
        `repo:${repo} is:pr assignee:${pullRequestAssignee} head:${pullRequestHead}`
    );

    const matchingPullRequests = pullRequests.filter(pr => pr.number === pullRequestNumber);
    const developmentIssue = matchingPullRequests.length > 0 ? matchingPullRequests[0]?.closingIssuesReferences?.nodes[0] : null;

    if (developmentIssue) {
        return {
            id: developmentIssue.id,
            title: developmentIssue.title,
            number: developmentIssue.number,
            url: developmentIssue.url,
            labels: [],
            owner: developmentIssue.repository.owner.login,
            repository: developmentIssue.repository.name
        };
    } else {
        toolkit.core.info(`No development issue found for PR #${pullRequestNumber}`);
        return null;
    }
}
